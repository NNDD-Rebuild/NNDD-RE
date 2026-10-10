import { randomUUID, createHash } from 'node:crypto';
import { app } from 'electron';
import { GitHubApi } from '@shared/constants';
import type { BackupPayload, BackupResult, DataScope, GistRevision, GistSummary, SyncProfile } from '@shared/types';
import { BACKUP_SCHEMA_VERSION, DEFAULT_DATA_SCOPE } from '@shared/types';
import { LibraryManager } from '../db/LibraryManager';
import { getConfigStore, type NnddConfig } from '../config/ConfigStore';
import { GitHubAuthManager } from '../github/GitHubAuthManager';
import { GistClient } from '../github/GistClient';
import { createLogger } from '../util/Logger';

const log = createLogger('BackupManager');

/**
 * バックアップに含める設定キーのホワイトリスト。
 * 機微情報 (auth.*, developer.*, githubSync.*) と端末固有パス (libraryRoot 等)、
 * モニタ構成依存 (ui.window) は意図的に除外する。
 */
const SYNCABLE_CONFIG_KEYS: (keyof NnddConfig)[] = [
  'maxConcurrentDownloads',
  'downloadRetryCount',
  'downloadCooldownMs',
  'downloadEasyComments',
  'downloadAllComments',
  'downloadLiveToSubfolder',
  'comment429RetryWaitSec',
  'hideWatchHistory',
  'player',
  'httpServer',
  'remoteNndd',
  'tray',
  'imageCache',
  'logLevel'
];

/**
 * GitHub Gist を使ったバックアップ・同期の中核ロジック。
 * プロファイル管理 + バックアップペイロードの構築・適用 + アップロード/ダウンロード実行。
 */
export class BackupManager {
  constructor(private readonly library: LibraryManager) {}

  // --- プロファイル CRUD ---

  listProfiles(): SyncProfile[] {
    return getConfigStore().get('githubSync').profiles;
  }

  getActiveProfileId(): string | null {
    return getConfigStore().get('githubSync').activeProfileId;
  }

  addProfile(name: string): SyncProfile {
    const profile: SyncProfile = {
      id: randomUUID(),
      name,
      gistId: null,
      dataScope: { ...DEFAULT_DATA_SCOPE },
      lastSyncedAt: null,
      lastSyncDirection: null,
      autoUploadEnabled: false
    };
    const cfg = getConfigStore().get('githubSync');
    getConfigStore().set('githubSync', { ...cfg, profiles: [...cfg.profiles, profile] });
    return profile;
  }

  updateProfile(id: string, patch: Partial<SyncProfile>): SyncProfile {
    const cfg = getConfigStore().get('githubSync');
    let updated: SyncProfile | undefined;
    const profiles = cfg.profiles.map((p) => {
      if (p.id !== id) return p;
      updated = { ...p, ...patch, id: p.id };
      return updated;
    });
    if (!updated) throw new Error('プロファイルが見つかりません');
    getConfigStore().set('githubSync', { ...cfg, profiles });
    return updated;
  }

  removeProfile(id: string): void {
    const cfg = getConfigStore().get('githubSync');
    const profiles = cfg.profiles.filter((p) => p.id !== id);
    const activeProfileId = cfg.activeProfileId === id ? null : cfg.activeProfileId;
    getConfigStore().set('githubSync', { ...cfg, profiles, activeProfileId });
  }

  setActiveProfile(id: string | null): void {
    const cfg = getConfigStore().get('githubSync');
    getConfigStore().set('githubSync', { ...cfg, activeProfileId: id });
  }

  linkExistingGist(profileId: string, gistId: string): SyncProfile {
    return this.updateProfile(profileId, { gistId });
  }

  /**
   * GitHubログイン直後などに呼び、GitHub上にある自アプリ作成のGistのうち
   * まだどのローカルプロファイルにも紐付いていないものを新規プロファイルとして取り込む。
   * 別端末で作成したバックアップを、ログインしただけで一覧に反映させるための補助。
   */
  async importProfilesFromGitHub(): Promise<SyncProfile[]> {
    const token = GitHubAuthManager.getToken();
    if (!token) return [];

    let candidates: GistSummary[];
    try {
      candidates = await new GistClient(token).listCandidates();
    } catch (e) {
      log.warn('import profiles from github failed:', e);
      return [];
    }

    const cfg = getConfigStore().get('githubSync');
    const linkedGistIds = new Set(
      cfg.profiles.map((p) => p.gistId).filter((id): id is string => !!id)
    );
    const unlinked = candidates.filter((g) => !linkedGistIds.has(g.id));
    if (unlinked.length === 0) return [];

    const imported: SyncProfile[] = unlinked.map((g) => ({
      id: randomUUID(),
      name: this.profileNameFromGistDescription(g.description),
      gistId: g.id,
      dataScope: { ...DEFAULT_DATA_SCOPE },
      lastSyncedAt: null,
      lastSyncDirection: null,
      autoUploadEnabled: false
    }));

    getConfigStore().set('githubSync', { ...cfg, profiles: [...cfg.profiles, ...imported] });
    log.info(`imported ${imported.length} profile(s) from GitHub Gist`);
    return imported;
  }

  private profileNameFromGistDescription(description: string): string {
    const prefix = `${GitHubApi.BACKUP_DESCRIPTION_PREFIX}: `;
    const name = description.startsWith(prefix) ? description.slice(prefix.length).trim() : '';
    return name || 'インポート済みプロファイル';
  }

  private getProfile(profileId: string): SyncProfile {
    const profile = this.listProfiles().find((p) => p.id === profileId);
    if (!profile) throw new Error('プロファイルが見つかりません');
    return profile;
  }

  // --- ペイロード構築・適用 ---

  buildPayload(scope: DataScope): BackupPayload {
    const payload: BackupPayload = {
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      appVersion: app.getVersion(),
      scope
    };

    if (scope.config) {
      const store = getConfigStore();
      const config: Record<string, unknown> = {};
      for (const key of SYNCABLE_CONFIG_KEYS) {
        config[key] = store.get(key);
      }
      // 公開範囲に関わる設定は端末固有。他端末へ同期しない
      const { allowedHosts: _ah, bindMode: _bm, ...httpSync } = store.get('httpServer');
      config['httpServer'] = httpSync;
      payload.config = config;
    }

    if (scope.ngList) {
      payload.ngList = {
        comments: this.library.ngListDao.listComment(),
        tags: this.library.ngListDao.listTags(),
        ups: this.library.ngListDao.listUps()
      };
    }

    if (scope.myList) {
      payload.myList = this.library.myListDao.list().map((m) => ({
        url: m.myListUrl,
        name: m.myListName,
        type: m.type,
        isDir: m.isDir,
        parentUrl: m.parentUrl ?? null
      }));
    }

    if (scope.schedule) {
      payload.schedule = this.library.scheduleDao.list().map((s) => ({
        id: s.id,
        name: s.name,
        targetType: s.targetType,
        targetMyListUrl: s.targetMyListUrl,
        targetId: s.targetId,
        daysOfWeek: s.daysOfWeek,
        time: s.time,
        enabled: s.enabled
      }));
    }

    if (scope.savedSearch) {
      payload.savedSearch = this.library.searchDao.list();
    }

    if (scope.playlist) {
      payload.playlist = this.library.playlistDao.list().map((p) => ({
        name: p.name,
        items: this.library.playlistDao.getItems(p.id).map((it) => ({
          videoId: it.videoId,
          title: it.title,
          thumbnailUrl: it.thumbnailUrl,
          lengthSec: it.lengthSec
        }))
      }));
    }

    if (scope.history) {
      payload.history = this.library.historyDao.listAll().map((h) => ({
        videoId: h.videoId,
        title: h.title,
        thumbnailUrl: h.thumbnailUrl,
        watchedAt: h.watchedAt.toISOString(),
        isLocal: h.isLocal,
        watchSeconds: h.watchSeconds
      }));
    }

    return payload;
  }

  /** ローカルデータへ全置換 (ミラー) 適用。呼び出し前に破壊的操作であることをUI側で確認済みとする。 */
  applyPayload(payload: BackupPayload, scope: DataScope): DataScope {
    const applied: DataScope = {
      config: false,
      ngList: false,
      myList: false,
      schedule: false,
      savedSearch: false,
      playlist: false,
      history: false
    };

    if (scope.config && payload.config) {
      const store = getConfigStore();
      for (const key of SYNCABLE_CONFIG_KEYS) {
        if (key in payload.config) {
          if (key === 'httpServer') {
            // 復元で公開範囲の設定が黙って変わらないよう、ローカルの値を保持する
            const local = store.get('httpServer');
            const incoming = payload.config[key] as Record<string, unknown>;
            store.set('httpServer', {
              ...incoming,
              allowedHosts: local.allowedHosts,
              bindMode: local.bindMode
            } as never);
          } else {
            store.set(key, payload.config[key] as never);
          }
        }
      }
      applied.config = true;
    }

    if (scope.ngList && payload.ngList) {
      const ngList = payload.ngList;
      this.library.db.transaction(() => {
        this.library.ngListDao.clearAll();
        for (const c of ngList.comments) this.library.ngListDao.addComment(c);
        for (const t of ngList.tags) this.library.ngListDao.addTag(t);
        for (const u of ngList.ups) this.library.ngListDao.addUp(u);
      });
      applied.ngList = true;
    }

    if (scope.myList && payload.myList) {
      const myList = payload.myList;
      this.library.db.transaction(() => {
        this.library.myListDao.clearAll();
        for (const m of myList) {
          this.library.myListDao.upsert({
            myListUrl: m.url,
            myListName: m.name,
            type: m.type,
            isDir: m.isDir,
            parentUrl: m.parentUrl ?? null,
            unPlayVideoCount: 0,
            myListVideoIds: {}
          });
        }
      });
      applied.myList = true;
    }

    if (scope.schedule && payload.schedule) {
      const schedule = payload.schedule;
      this.library.db.transaction(() => {
        this.library.scheduleDao.clearAll();
        for (const s of schedule) {
          this.library.scheduleDao.upsert({
            id: s.id,
            name: s.name,
            targetType: s.targetType || 'mylist',
            targetMyListUrl: s.targetMyListUrl,
            targetId: s.targetId || '',
            daysOfWeek: s.daysOfWeek,
            time: s.time,
            enabled: s.enabled,
            lastRun: null
          });
        }
      });
      applied.schedule = true;
    }

    if (scope.savedSearch && payload.savedSearch) {
      const savedSearch = payload.savedSearch;
      this.library.db.transaction(() => {
        this.library.searchDao.clearAll();
        for (const s of savedSearch) this.library.searchDao.upsert(s);
      });
      applied.savedSearch = true;
    }

    if (scope.playlist && payload.playlist) {
      const playlists = payload.playlist;
      this.library.db.transaction(() => {
        this.library.playlistDao.clearAll();
        for (const p of playlists) {
          const created = this.library.playlistDao.create(p.name);
          for (const item of p.items) {
            this.library.playlistDao.addVideo(created.id, item);
          }
        }
      });
      applied.playlist = true;
    }

    if (scope.history && payload.history) {
      const history = payload.history;
      this.library.db.transaction(() => {
        this.library.historyDao.clear();
        for (const h of history) {
          this.library.historyDao.add({
            videoId: h.videoId,
            title: h.title,
            thumbnailUrl: h.thumbnailUrl,
            watchedAt: new Date(h.watchedAt),
            isLocal: h.isLocal,
            watchSeconds: h.watchSeconds ?? 0
          });
        }
      });
      applied.history = true;
    }

    return applied;
  }

  // --- 同期実行 ---

  /** buildPayload() の出力からメタデータ(schemaVersion/exportedAt/appVersion)を除いた本体のみをハッシュ化 (変更検知用) */
  private computeContentHash(payload: BackupPayload): string {
    const { config, ngList, myList, schedule, savedSearch, playlist, history } = payload;
    const body = { config, ngList, myList, schedule, savedSearch, playlist, history };
    return createHash('sha256').update(JSON.stringify(body)).digest('hex');
  }

  private async uploadPayload(
    token: string,
    profile: SyncProfile,
    payload: BackupPayload,
    hash: string
  ): Promise<BackupResult> {
    const content = JSON.stringify(payload, null, 2);
    const client = new GistClient(token);

    try {
      const gist = profile.gistId
        ? await client.update(profile.gistId, content)
        : await client.create(content, `${GitHubApi.BACKUP_DESCRIPTION_PREFIX}: ${profile.name}`);
      this.updateProfile(profile.id, {
        gistId: gist.id,
        lastSyncedAt: new Date().toISOString(),
        lastSyncDirection: 'upload',
        lastUploadedContentHash: hash
      });
      return { ok: true, gistUrl: gist.htmlUrl };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log.warn('upload failed:', message);
      return { ok: false, error: message };
    }
  }

  /** 手動アップロード。変更の有無に関わらず常に実行する。 */
  async upload(profileId: string): Promise<BackupResult> {
    const token = GitHubAuthManager.getToken();
    if (!token) return { ok: false, error: 'GitHubにログインしていません' };

    const profile = this.getProfile(profileId);
    const payload = this.buildPayload(profile.dataScope);
    const hash = this.computeContentHash(payload);
    return this.uploadPayload(token, profile, payload, hash);
  }

  async download(profileId: string): Promise<BackupResult> {
    const token = GitHubAuthManager.getToken();
    if (!token) return { ok: false, error: 'GitHubにログインしていません' };

    const profile = this.getProfile(profileId);
    if (!profile.gistId) {
      return { ok: false, error: 'このプロファイルはまだGistと紐付いていません' };
    }

    const client = new GistClient(token);
    try {
      const gist = await client.get(profile.gistId);
      const raw = gist.files[GitHubApi.BACKUP_FILE_NAME]?.content;
      if (!raw) return { ok: false, error: 'Gist内にバックアップファイルが見つかりません' };
      const payload = parseBackupPayload(raw);
      const applied = this.applyPayload(payload, profile.dataScope);
      this.updateProfile(profileId, {
        lastSyncedAt: new Date().toISOString(),
        lastSyncDirection: 'download'
      });
      return { ok: true, applied };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log.warn('download failed:', message);
      return { ok: false, error: message };
    }
  }

  /**
   * アクティブプロファイルへの自動アップロード (アプリ起動時・終了時に呼ばれる想定)。
   * 未ログイン/アクティブプロファイル未設定/該当プロファイルで無効化されている場合は
   * 何もせずログのみ出力する (エラー扱いしない)。呼び出し元の起動・終了処理を
   * 絶対にブロックしないよう、例外は全て内部で握りつぶす。
   * 前回アップロード時からデータが変わっていなければスキップする (手動アップロードは対象外)。
   */
  async autoUploadActiveProfile(): Promise<void> {
    try {
      const token = GitHubAuthManager.getToken();
      if (!token) {
        log.info('auto upload skipped: not logged in');
        return;
      }
      const cfg = getConfigStore().get('githubSync');
      if (!cfg.activeProfileId) {
        log.info('auto upload skipped: no active profile');
        return;
      }
      const profile = cfg.profiles.find((p) => p.id === cfg.activeProfileId);
      if (!profile || profile.autoUploadEnabled !== true) {
        log.info('auto upload skipped: disabled for active profile');
        return;
      }

      const payload = this.buildPayload(profile.dataScope);
      const hash = this.computeContentHash(payload);
      if (profile.gistId && profile.lastUploadedContentHash === hash) {
        log.info(`auto upload skipped: no changes since last upload (${profile.name})`);
        return;
      }

      const result = await this.uploadPayload(token, profile, payload, hash);
      if (result.ok) {
        log.info(`auto upload succeeded: ${profile.name}`);
      } else {
        log.warn(`auto upload failed: ${result.error}`);
      }
    } catch (e) {
      log.warn('auto upload threw an error:', e);
    }
  }

  async preview(profileId: string): Promise<BackupPayload | null> {
    const token = GitHubAuthManager.getToken();
    if (!token) return null;
    const profile = this.getProfile(profileId);
    if (!profile.gistId) return null;
    const client = new GistClient(token);
    const gist = await client.get(profile.gistId);
    const raw = gist.files[GitHubApi.BACKUP_FILE_NAME]?.content;
    if (!raw) return null;
    return parseBackupPayload(raw);
  }

  /** プロファイルに紐づく Gist の世代 (リビジョン) 一覧を新しい順で返す */
  async listRevisions(profileId: string): Promise<GistRevision[]> {
    const token = GitHubAuthManager.getToken();
    if (!token) throw new Error('GitHubにログインしていません');
    const profile = this.getProfile(profileId);
    if (!profile.gistId) throw new Error('このプロファイルはまだGistと紐付いていません');
    return new GistClient(token).listRevisions(profile.gistId);
  }

  /**
   * 指定リビジョン時点の内容をローカルへ復元する (ダウンロードの世代指定版)。
   * Gist自体 (リモート) は変更しない — あくまでローカルへの反映のみ。
   */
  async restoreRevision(profileId: string, sha: string): Promise<BackupResult> {
    const token = GitHubAuthManager.getToken();
    if (!token) return { ok: false, error: 'GitHubにログインしていません' };
    const profile = this.getProfile(profileId);
    if (!profile.gistId) {
      return { ok: false, error: 'このプロファイルはまだGistと紐付いていません' };
    }

    const client = new GistClient(token);
    try {
      const gist = await client.get(profile.gistId, sha);
      const raw = gist.files[GitHubApi.BACKUP_FILE_NAME]?.content;
      if (!raw) return { ok: false, error: '指定バージョンにバックアップファイルが見つかりません' };
      const payload = parseBackupPayload(raw);
      const applied = this.applyPayload(payload, profile.dataScope);
      this.updateProfile(profileId, {
        lastSyncedAt: new Date().toISOString(),
        lastSyncDirection: 'download'
      });
      return { ok: true, applied };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log.warn('restore revision failed:', message);
      return { ok: false, error: message };
    }
  }
}

// --- バックアップ JSON の検証 ---
// 復元は項目ごとに別トランザクションで全置換するため、途中の項目で例外が出ると一部だけ置き換わった状態になる。
// ローカルデータに触れる前に形を確かめて、不正なら丸ごと中断する。

type JsonObject = Record<string, unknown>;

function invalid(where: string, expected: string): never {
  throw new Error(`バックアップの形式が不正です: ${where} が${expected}ではありません`);
}

function expectObject(v: unknown, where: string): JsonObject {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) invalid(where, 'オブジェクト');
  return v as JsonObject;
}

function expectArray(v: unknown, where: string): unknown[] {
  if (!Array.isArray(v)) invalid(where, '配列');
  return v;
}

function expectString(v: unknown, where: string): void {
  if (typeof v !== 'string') invalid(where, '文字列');
}

/** DB 上 NULL を許す列。バックアップ作成時に null がそのまま書き出されることがある */
function expectNullableString(v: unknown, where: string): void {
  if (v !== null && typeof v !== 'string') invalid(where, '文字列');
}

function expectBoolean(v: unknown, where: string): void {
  if (typeof v !== 'boolean') invalid(where, '真偽値');
}

function expectNumber(v: unknown, where: string): void {
  if (typeof v !== 'number' || !Number.isFinite(v)) invalid(where, '数値');
}

/** 項目があれば配列であることと、各要素を check で確かめる */
function checkOptionalList(root: JsonObject, key: string, check: (item: unknown, where: string) => void): void {
  if (root[key] === undefined) return;
  expectArray(root[key], key).forEach((item, i) => check(item, `${key}[${i}]`));
}

function parseBackupPayload(raw: string): BackupPayload {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error('バックアップファイルを JSON として読み取れません');
  }
  const root = expectObject(data, 'バックアップ全体');

  const version = root.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) invalid('schemaVersion', '1以上の整数');
  if (version > BACKUP_SCHEMA_VERSION) {
    throw new Error(
      `新しいバージョンのアプリで作成されたバックアップです (形式 ${version}、対応 ${BACKUP_SCHEMA_VERSION} まで)。アプリを更新してから復元してください`
    );
  }
  expectString(root.exportedAt, 'exportedAt');
  expectString(root.appVersion, 'appVersion');
  expectObject(root.scope, 'scope');

  if (root.config !== undefined) expectObject(root.config, 'config');

  if (root.ngList !== undefined) {
    const ngList = expectObject(root.ngList, 'ngList');
    expectArray(ngList.comments, 'ngList.comments').forEach((c, i) => {
      const o = expectObject(c, `ngList.comments[${i}]`);
      expectString(o.type, `ngList.comments[${i}].type`);
      expectString(o.value, `ngList.comments[${i}].value`);
    });
    expectArray(ngList.tags, 'ngList.tags').forEach((t, i) => expectString(t, `ngList.tags[${i}]`));
    expectArray(ngList.ups, 'ngList.ups').forEach((u, i) => expectString(u, `ngList.ups[${i}]`));
  }

  checkOptionalList(root, 'myList', (item, where) => {
    const o = expectObject(item, where);
    expectString(o.url, `${where}.url`);
    expectNullableString(o.name, `${where}.name`);
    expectNullableString(o.type, `${where}.type`);
    expectBoolean(o.isDir, `${where}.isDir`);
    if (o.parentUrl !== undefined) expectNullableString(o.parentUrl, `${where}.parentUrl`);
  });

  checkOptionalList(root, 'schedule', (item, where) => {
    const o = expectObject(item, where);
    expectString(o.id, `${where}.id`);
    expectNullableString(o.name, `${where}.name`);
    if (o.targetType !== undefined) expectNullableString(o.targetType, `${where}.targetType`);
    expectNullableString(o.targetMyListUrl, `${where}.targetMyListUrl`);
    if (o.targetId !== undefined) expectNullableString(o.targetId, `${where}.targetId`);
    expectArray(o.daysOfWeek, `${where}.daysOfWeek`).forEach((d, i) => expectNumber(d, `${where}.daysOfWeek[${i}]`));
    expectNullableString(o.time, `${where}.time`);
    expectBoolean(o.enabled, `${where}.enabled`);
  });

  checkOptionalList(root, 'savedSearch', (item, where) => {
    const o = expectObject(item, where);
    expectString(o.id, `${where}.id`);
    expectNullableString(o.name, `${where}.name`);
    expectNullableString(o.word, `${where}.word`);
    expectNullableString(o.type, `${where}.type`);
    expectNullableString(o.sortType, `${where}.sortType`);
  });

  checkOptionalList(root, 'playlist', (item, where) => {
    const o = expectObject(item, where);
    expectString(o.name, `${where}.name`);
    expectArray(o.items, `${where}.items`).forEach((it, i) => {
      const itemWhere = `${where}.items[${i}]`;
      const v = expectObject(it, itemWhere);
      expectString(v.videoId, `${itemWhere}.videoId`);
      expectNullableString(v.title, `${itemWhere}.title`);
      expectNullableString(v.thumbnailUrl, `${itemWhere}.thumbnailUrl`);
      expectNumber(v.lengthSec, `${itemWhere}.lengthSec`);
    });
  });

  checkOptionalList(root, 'history', (item, where) => {
    const o = expectObject(item, where);
    expectString(o.videoId, `${where}.videoId`);
    expectNullableString(o.title, `${where}.title`);
    expectNullableString(o.thumbnailUrl, `${where}.thumbnailUrl`);
    if (typeof o.watchedAt !== 'string' || Number.isNaN(Date.parse(o.watchedAt))) invalid(`${where}.watchedAt`, '日時の文字列');
    expectBoolean(o.isLocal, `${where}.isLocal`);
    if (o.watchSeconds !== undefined && o.watchSeconds !== null) expectNumber(o.watchSeconds, `${where}.watchSeconds`);
  });

  return root as unknown as BackupPayload;
}
