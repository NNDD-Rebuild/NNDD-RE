import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { app } from 'electron';
import Database from 'better-sqlite3';
import {
  HonkeImportCategory,
  RssType,
  type HonkeImportCategoryPreview,
  type HonkeImportCategoryResult,
  type HonkeImportCategoryValue,
  type HonkeImportPolicy,
  type HonkeImportPreview,
  type HonkeImportProgress,
  type HonkeImportReport,
  type HonkeImportSelection,
  type HonkeImportSource,
  type HistoryItem,
  type NgListItem,
  type NNDDREVideo,
  type NNDDRESearchSortTypeValue,
  type NNDDRESearchTypeValue,
  type RssTypeValue
} from '@shared/types';
import { extractBracketedVideoId } from '@shared/utils/videoId';
import { parseMylistSource } from '@shared/utils/parseMylistUrl';
import type { LibraryManager } from '../db/LibraryManager';
import { getConfigStore } from '../config/ConfigStore';
import { createLogger } from '../util/Logger';
import {
  parseConfigXml,
  parseDownloadListXml,
  parseHistoryXml,
  parseM3u,
  parseMyListsXml,
  parseNgListXml,
  parseNgTagsXml,
  parseSearchItemsXml
} from './honkeParsers';
import {
  HONKE_CONFIG_MAP,
  HONKE_CONFIG_NEVER_IMPORT,
  mapMyListType,
  mapNgKind,
  mapSearchType,
  mapSortType
} from './honkeMapping';

const log = createLogger('HonkeImport');

const VIDEO_ID_IN_TEXT = /((?:sm|nm|so|ax|sd|ca|cd|cw|zb|ze|yo)\d+)/;

interface Collected<T> {
  total: number;
  items: T[];
  duplicate: number;
  skipped: string[];
  error?: string;
}

interface ConfigItem { reKey: string; value: unknown; honkeKey: string }
/** isDir のとき url は空 (適用時に採番)。parent は items 内のインデックスで、ルートは -1 */
interface MyListCandidate { name: string; url: string; type: RssTypeValue; isDir: boolean; parent: number }
interface SearchCandidate { name: string; word: string; type: NNDDRESearchTypeValue; sortType: NNDDRESearchSortTypeValue }
interface PlaylistCandidate { name: string; entries: { videoId: string; title: string; lengthSec: number }[] }
interface LibraryCandidate {
  key: string;
  uri: string;
  videoName: string;
  modificationDate: Date;
  creationDate: Date;
  thumbUrl: string;
  playCount: number;
  time: number;
  lastPlayDate: Date | null;
  pubDate: Date | null;
  yetReading: boolean;
  tags: string[];
}

interface ConfigAccess {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

export interface HonkeImporterDeps {
  library: LibraryManager;
  enqueueDownload: (videoId: string) => unknown;
  onProgress?: (p: HonkeImportProgress) => void;
  /** NG リスト変更を全ウィンドウへ通知 */
  onNgChanged?: () => void;
}

function readTextIfExists(p: string | null): string | null {
  if (!p) return null;
  try {
    return fs.readFileSync(p, 'utf-8');
  } catch {
    return null;
  }
}

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function fileUrlToPath(u: string): string | null {
  if (!u) return null;
  if (!u.startsWith('file:')) return u;
  try {
    return fileURLToPath(u);
  } catch {
    return null;
  }
}

function applyPathReplace(p: string, from?: string, to?: string): string {
  if (!from || to === undefined) return p;
  const norm = (s: string): string => path.normalize(s);
  const ci = process.platform === 'win32';
  const a = norm(p);
  const f = norm(from);
  const head = a.slice(0, f.length);
  if ((ci ? head.toLowerCase() === f.toLowerCase() : head === f) && (a.length === f.length || /[\\/]/.test(a[f.length] ?? '') || /[\\/]$/.test(f))) {
    return path.join(to, a.slice(f.length));
  }
  return p;
}

/** 本家設定の system フォルダ解決 (config.xml の libraryURL / useAppDirSystemFile を考慮) */
function systemDirFromConfig(configPath: string, config: Record<string, string>): string | null {
  const storeDir = path.dirname(configPath);
  const candidates: string[] = [];
  if (config.useAppDirSystemFile === 'true') {
    candidates.push(path.join(storeDir, 'system'));
  } else {
    const lib = fileUrlToPath(config.libraryURL ?? '');
    if (lib) candidates.push(path.join(lib, 'system'));
    candidates.push(path.join(storeDir, 'system'));
  }
  return candidates.find(isDirectory) ?? null;
}

export class HonkeImporter {
  constructor(private readonly deps: HonkeImporterDeps) {}

  // ---- ソース検出 ----

  /** %APPDATA% 配下の AIR Local Store から本家NNDDの config.xml を探す */
  static detect(): HonkeImportSource[] {
    const out: HonkeImportSource[] = [];
    let appData: string;
    try {
      appData = app.getPath('appData');
    } catch {
      return out;
    }
    let names: string[] = [];
    try {
      names = fs.readdirSync(appData);
    } catch {
      return out;
    }
    for (const name of names) {
      if (!name.toLowerCase().includes('nndd')) continue;
      const configPath = path.join(appData, name, 'Local Store', 'config.xml');
      if (!fs.existsSync(configPath)) continue;
      const resolved = HonkeImporter.resolve(path.dirname(configPath));
      if (resolved) out.push({ ...resolved, label: `${name} (${resolved.systemDir ?? 'system フォルダ未検出'})` });
    }
    return out;
  }

  /** 手動選択されたフォルダ (Local Store / system / ライブラリルート) から本家データを解決 */
  static resolve(picked: string): HonkeImportSource | null {
    const configPath = path.join(picked, 'config.xml');
    if (fs.existsSync(configPath)) {
      const text = readTextIfExists(configPath);
      let systemDir: string | null = null;
      if (text) {
        try {
          systemDir = systemDirFromConfig(configPath, parseConfigXml(text));
        } catch (e) {
          log.warn('config.xml のパースに失敗:', e);
        }
      }
      return { systemDir, configPath, label: picked };
    }
    const localStore = path.join(picked, 'Local Store');
    if (fs.existsSync(path.join(localStore, 'config.xml'))) return HonkeImporter.resolve(localStore);
    const looksLikeSystem =
      path.basename(picked).toLowerCase() === 'system' ||
      ['library.db', 'ngList.xml', 'myLists.xml', 'searchItems.xml', 'history.xml'].some((f) =>
        fs.existsSync(path.join(picked, f))
      );
    if (looksLikeSystem) return { systemDir: picked, configPath: null, label: picked };
    const sub = path.join(picked, 'system');
    if (isDirectory(sub)) return { systemDir: sub, configPath: null, label: picked };
    return null;
  }

  // ---- プレビュー ----

  async preview(source: HonkeImportSource): Promise<HonkeImportPreview> {
    const categories: HonkeImportCategoryPreview[] = [];
    const toPreview = (category: HonkeImportCategoryValue, c: Collected<unknown>): HonkeImportCategoryPreview => ({
      category,
      total: c.total,
      importable: c.items.length,
      duplicate: c.duplicate,
      skipped: c.skipped,
      ...(c.error ? { error: c.error } : {})
    });
    categories.push(toPreview(HonkeImportCategory.CONFIG, this.collectConfig(source)));
    categories.push(toPreview(HonkeImportCategory.NG, this.collectNg(source)));
    categories.push(toPreview(HonkeImportCategory.MYLIST, this.collectMyLists(source)));
    categories.push(toPreview(HonkeImportCategory.SEARCH, this.collectSearch(source)));
    categories.push(toPreview(HonkeImportCategory.HISTORY, this.collectHistory(source)));
    categories.push(toPreview(HonkeImportCategory.PLAYLIST, this.collectPlaylists(source)));
    categories.push(toPreview(HonkeImportCategory.LIBRARY, this.collectLibrary(source)));
    categories.push(toPreview(HonkeImportCategory.DOWNLOAD_QUEUE, this.collectDownloadQueue(source)));
    return { source, categories };
  }

  // ---- 適用 ----

  async apply(sel: HonkeImportSelection): Promise<HonkeImportReport> {
    const active = (Object.entries(sel.policies) as [HonkeImportCategoryValue, HonkeImportPolicy][]).filter(
      ([, p]) => p && p !== 'skip'
    );
    const backupDir = active.length > 0 ? await this.backupBeforeApply() : null;
    const results: HonkeImportCategoryResult[] = [];

    for (const [category, policy] of active) {
      this.progress(category, '取り込み中...');
      try {
        results.push(await this.applyCategory(category, policy, sel));
      } catch (e) {
        log.error(`${category} の取り込みに失敗:`, e);
        results.push({
          category,
          added: 0,
          updated: 0,
          skipped: 0,
          notes: [],
          error: e instanceof Error ? e.message : String(e)
        });
      }
    }
    return { results, backupDir };
  }

  private progress(category: HonkeImportCategoryValue, message: string): void {
    this.deps.onProgress?.({ category, message });
  }

  private async applyCategory(
    category: HonkeImportCategoryValue,
    policy: HonkeImportPolicy,
    sel: HonkeImportSelection
  ): Promise<HonkeImportCategoryResult> {
    const { source } = sel;
    switch (category) {
      case HonkeImportCategory.CONFIG:
        return this.applyConfig(this.collectConfig(source), policy);
      case HonkeImportCategory.NG:
        return this.applyNg(source, policy);
      case HonkeImportCategory.MYLIST:
        return this.applyMyLists(this.collectMyLists(source), policy);
      case HonkeImportCategory.SEARCH:
        return this.applySearch(this.collectSearch(source), policy);
      case HonkeImportCategory.HISTORY:
        return this.applyHistory(source, policy);
      case HonkeImportCategory.PLAYLIST:
        return this.applyPlaylists(this.collectPlaylists(source), policy);
      case HonkeImportCategory.LIBRARY:
        return this.applyLibrary(this.collectLibrary(source, sel.libraryPathFrom, sel.libraryPathTo), policy);
      case HonkeImportCategory.DOWNLOAD_QUEUE:
        return this.applyDownloadQueue(this.collectDownloadQueue(source));
    }
  }

  /** DB と設定を userData/import-backup/<日時>/ に退避。失敗しても取り込みは止めず null を返す */
  private async backupBeforeApply(): Promise<string | null> {
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const dir = path.join(app.getPath('userData'), 'import-backup', stamp);
      fs.mkdirSync(dir, { recursive: true });
      await this.deps.library.db.raw.backup(path.join(dir, 'library.db'));
      fs.writeFileSync(path.join(dir, 'nndd-config.json'), JSON.stringify(getConfigStore().store, null, 2), 'utf-8');
      return dir;
    } catch (e) {
      log.warn('インポート前バックアップに失敗:', e);
      return null;
    }
  }

  private sysFile(source: HonkeImportSource, name: string): string | null {
    return source.systemDir ? path.join(source.systemDir, name) : null;
  }

  private missing<T>(name: string): Collected<T> {
    return { total: 0, items: [], duplicate: 0, skipped: [], error: `${name} が見つかりません` };
  }

  // ---- config ----

  private get configStore(): ConfigAccess {
    return getConfigStore() as unknown as ConfigAccess;
  }

  private collectConfig(source: HonkeImportSource): Collected<ConfigItem> {
    const text = readTextIfExists(source.configPath);
    if (text === null) return this.missing('config.xml');
    let cfg: Record<string, string>;
    try {
      cfg = parseConfigXml(text);
    } catch (e) {
      return { total: 0, items: [], duplicate: 0, skipped: [], error: `config.xml の解析に失敗: ${String(e)}` };
    }
    const items: ConfigItem[] = [];
    const skipped: string[] = [];
    let duplicate = 0;
    let unsupported = 0;
    for (const [k, raw] of Object.entries(cfg)) {
      if (HONKE_CONFIG_NEVER_IMPORT.has(k)) {
        skipped.push(`${k}: 認証情報は取り込めません`);
        continue;
      }
      const map = HONKE_CONFIG_MAP[k];
      if (!map) {
        unsupported++;
        continue;
      }
      const value = map.convert(raw);
      if (value === null) {
        skipped.push(`${k}=${raw}: RE の設定へ変換できません`);
        continue;
      }
      if (this.configStore.get(map.reKey) === value) duplicate++;
      items.push({ reKey: map.reKey, value, honkeKey: k });
    }
    return { total: Object.keys(cfg).length - unsupported, items, duplicate, skipped };
  }

  private applyConfig(c: Collected<ConfigItem>, policy: HonkeImportPolicy): HonkeImportCategoryResult {
    if (c.error) throw new Error(c.error);
    let updated = 0;
    let unchanged = 0;
    for (const it of c.items) {
      if (this.configStore.get(it.reKey) === it.value) {
        unchanged++;
        continue;
      }
      this.configStore.set(it.reKey, it.value);
      updated++;
    }
    void policy;
    return {
      category: HonkeImportCategory.CONFIG,
      added: 0,
      updated,
      skipped: c.skipped.length + unchanged,
      notes: ['設定は再表示/再起動後に画面へ反映されます', ...c.skipped]
    };
  }

  // ---- NG ----

  private collectNg(source: HonkeImportSource): Collected<{ comment?: NgListItem; tag?: string }> {
    const ngText = readTextIfExists(this.sysFile(source, 'ngList.xml'));
    const tagText = readTextIfExists(this.sysFile(source, 'ngTags.xml'));
    if (ngText === null && tagText === null) return this.missing('ngList.xml / ngTags.xml');

    const comment: NgListItem[] = [];
    const tags: string[] = [];
    const skipped: string[] = [];
    let total = 0;
    try {
      for (const it of ngText ? parseNgListXml(ngText) : []) {
        total++;
        const type = mapNgKind(it.kind);
        if (!type) {
          skipped.push(`${it.kind}: ${it.value} (RE に対応する種別がありません)`);
          continue;
        }
        if (!it.value) continue;
        comment.push({ type, value: it.value });
      }
      for (const t of tagText ? parseNgTagsXml(tagText) : []) {
        total++;
        if (t) tags.push(t);
      }
    } catch (e) {
      return { total, items: [], duplicate: 0, skipped, error: `NGリストの解析に失敗: ${String(e)}` };
    }

    const dao = this.deps.library.ngListDao;
    const existing = new Set(dao.listComment().map((x) => `${x.type}\0${x.value}`));
    const existingTags = new Set(dao.listTags());
    const duplicate =
      comment.filter((x) => existing.has(`${x.type}\0${x.value}`)).length +
      tags.filter((t) => existingTags.has(t)).length;
    return { total, items: [...comment.map((c) => ({ comment: c })), ...tags.map((t) => ({ tag: t }))], duplicate, skipped };
  }

  private applyNg(source: HonkeImportSource, policy: HonkeImportPolicy): HonkeImportCategoryResult {
    const c = this.collectNg(source);
    if (c.error) throw new Error(c.error);
    const dao = this.deps.library.ngListDao;
    const data = {
      comment: c.items.flatMap((x) => (x.comment ? [x.comment] : [])),
      tags: c.items.flatMap((x) => (x.tag !== undefined ? [x.tag] : []))
    };
    let added = 0;
    this.deps.library.db.transaction(() => {
      if (policy === 'replace') {
        for (const x of dao.listComment()) dao.removeComment(x);
        for (const t of dao.listTags()) dao.removeTag(t);
      }
      const existing = new Set(dao.listComment().map((x) => `${x.type}\0${x.value}`));
      const existingTags = new Set(dao.listTags());
      for (const x of data.comment) {
        if (existing.has(`${x.type}\0${x.value}`)) continue;
        dao.addComment(x);
        existing.add(`${x.type}\0${x.value}`);
        added++;
      }
      for (const t of data.tags) {
        if (existingTags.has(t)) continue;
        dao.addTag(t);
        existingTags.add(t);
        added++;
      }
    });
    this.deps.onNgChanged?.();
    return {
      category: HonkeImportCategory.NG,
      added,
      updated: 0,
      skipped: c.skipped.length + c.duplicate,
      notes: c.skipped
    };
  }

  // ---- マイリスト ----

  private collectMyLists(source: HonkeImportSource): Collected<MyListCandidate> {
    const text = readTextIfExists(this.sysFile(source, 'myLists.xml'));
    if (text === null) return this.missing('myLists.xml');
    let list;
    try {
      list = parseMyListsXml(text);
    } catch (e) {
      return { total: 0, items: [], duplicate: 0, skipped: [], error: `myLists.xml の解析に失敗: ${String(e)}` };
    }
    const items: MyListCandidate[] = [];
    const skipped: string[] = [];
    const seen = new Set<string>();
    const existing = new Set(this.deps.library.myListDao.list().map((m) => m.myListUrl));
    const candidateIndex = new Map<number, number>();
    let duplicate = 0;
    list.forEach((m, i) => {
      const parent = candidateIndex.get(m.parent) ?? -1;
      if (m.isDir) {
        candidateIndex.set(i, items.length);
        items.push({ name: m.name, url: '', type: RssType.MY_LIST, isDir: true, parent });
        return;
      }
      const type = mapMyListType(m.type);
      let url: string;
      let finalType: RssTypeValue = type;
      if (type === RssType.COMMUNITY) {
        url = m.url.replace(/\?.*$/, '');
      } else {
        const parsed = parseMylistSource(m.url.replace('/channel/', '/').replace(/myListId\//i, 'mylist/'));
        if (!parsed) {
          skipped.push(`${m.name}: URL を認識できません (${m.url})`);
          return;
        }
        url = parsed.normalizedUrl;
        finalType = parsed.type;
      }
      if (!url || seen.has(url)) return;
      seen.add(url);
      if (existing.has(url)) duplicate++;
      candidateIndex.set(i, items.length);
      items.push({ name: m.name || url, url, type: finalType, isDir: false, parent });
    });
    return { total: list.length, items, duplicate, skipped };
  }

  private applyMyLists(c: Collected<MyListCandidate>, policy: HonkeImportPolicy): HonkeImportCategoryResult {
    if (c.error) throw new Error(c.error);
    const dao = this.deps.library.myListDao;
    let added = 0;
    let skipped = 0;
    let folders = 0;
    this.deps.library.db.transaction(() => {
      if (policy === 'replace') dao.clearAll();
      const current = dao.list();
      const existing = new Set(current.map((m) => m.myListUrl));
      const folderKey = (parentUrl: string | null, name: string): string => `${parentUrl ?? ''}\0${name}`;
      const folderUrls = new Map<string, string>();
      for (const m of current) if (m.isDir) folderUrls.set(folderKey(m.parentUrl ?? null, m.myListName), m.myListUrl);
      const urlOf: string[] = [];
      c.items.forEach((m, i) => {
        const parentUrl = m.parent >= 0 ? urlOf[m.parent] : null;
        if (m.isDir) {
          const key = folderKey(parentUrl, m.name);
          let url = folderUrls.get(key);
          if (!url) {
            url = `folder:${crypto.randomUUID()}`;
            folderUrls.set(key, url);
            dao.upsert({
              myListUrl: url,
              myListName: m.name,
              type: RssType.MY_LIST,
              isDir: true,
              unPlayVideoCount: 0,
              myListVideoIds: {},
              parentUrl
            });
            folders++;
          }
          urlOf[i] = url;
          return;
        }
        if (existing.has(m.url)) {
          skipped++;
          return;
        }
        dao.upsert({
          myListUrl: m.url,
          myListName: m.name,
          type: m.type,
          isDir: false,
          unPlayVideoCount: 0,
          myListVideoIds: {},
          parentUrl
        });
        added++;
      });
    });
    const notes = folders > 0 ? [`フォルダ ${folders} 個を作成しました`, ...c.skipped] : c.skipped;
    return { category: HonkeImportCategory.MYLIST, added, updated: 0, skipped, notes };
  }

  // ---- 保存検索 ----

  private collectSearch(source: HonkeImportSource): Collected<SearchCandidate> {
    const text = readTextIfExists(this.sysFile(source, 'searchItems.xml'));
    if (text === null) return this.missing('searchItems.xml');
    let list;
    try {
      list = parseSearchItemsXml(text);
    } catch (e) {
      return { total: 0, items: [], duplicate: 0, skipped: [], error: `searchItems.xml の解析に失敗: ${String(e)}` };
    }
    const items: SearchCandidate[] = [];
    const skipped: string[] = [];
    const existing = new Set(this.deps.library.searchDao.list().map((s) => `${s.type}\0${s.word}`));
    const seen = new Set<string>();
    let duplicate = 0;
    for (const s of list) {
      if (s.isDir || !s.word) {
        if (s.isDir) skipped.push(`${s.name}: フォルダは取り込まず、中身を平坦に取り込みます`);
        continue;
      }
      const type = mapSearchType(s.searchType);
      const key = `${type}\0${s.word}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const sort = mapSortType(s.sortType);
      if (sort.fallback) skipped.push(`${s.name}: コメント日時順は未対応のため投稿日時の新しい順にしました`);
      if (existing.has(key)) duplicate++;
      items.push({ name: s.name || s.word, word: s.word, type, sortType: sort.value });
    }
    return { total: list.length, items, duplicate, skipped };
  }

  private applySearch(c: Collected<SearchCandidate>, policy: HonkeImportPolicy): HonkeImportCategoryResult {
    if (c.error) throw new Error(c.error);
    const dao = this.deps.library.searchDao;
    let added = 0;
    let skipped = 0;
    this.deps.library.db.transaction(() => {
      if (policy === 'replace') dao.clearAll();
      const existing = new Set(dao.list().map((s) => `${s.type}\0${s.word}`));
      for (const s of c.items) {
        if (existing.has(`${s.type}\0${s.word}`)) {
          skipped++;
          continue;
        }
        dao.upsert({ id: crypto.randomUUID(), ...s });
        added++;
      }
    });
    return { category: HonkeImportCategory.SEARCH, added, updated: 0, skipped, notes: c.skipped };
  }

  // ---- 履歴 ----

  private collectHistory(source: HonkeImportSource): Collected<HistoryItem> {
    const text = readTextIfExists(this.sysFile(source, 'history.xml'));
    if (text === null) return this.missing('history.xml');
    let list;
    try {
      list = parseHistoryXml(text);
    } catch (e) {
      return { total: 0, items: [], duplicate: 0, skipped: [], error: `history.xml の解析に失敗: ${String(e)}` };
    }
    const items: HistoryItem[] = [];
    let noId = 0;
    for (const h of list) {
      const videoId = h.url.match(VIDEO_ID_IN_TEXT)?.[1];
      if (!videoId) {
        noId++;
        continue;
      }
      items.push({
        videoId,
        title: h.videoName,
        thumbnailUrl: /^https?:/.test(h.thumbUrl) ? h.thumbUrl : '',
        watchedAt: new Date(h.playDate),
        isLocal: h.url.startsWith('file:'),
        watchSeconds: 0
      });
    }
    const existing = new Set(
      this.deps.library.historyDao.listAll(100000).map((x) => `${x.videoId}@${Math.floor(x.watchedAt.getTime() / 1000)}`)
    );
    const duplicate = items.filter((x) => existing.has(`${x.videoId}@${Math.floor(x.watchedAt.getTime() / 1000)}`)).length;
    return {
      total: list.length,
      items,
      duplicate,
      skipped: noId > 0 ? [`動画IDを取り出せない履歴 ${noId} 件`] : []
    };
  }

  private applyHistory(source: HonkeImportSource, policy: HonkeImportPolicy): HonkeImportCategoryResult {
    const c = this.collectHistory(source);
    if (c.error) throw new Error(c.error);
    const dao = this.deps.library.historyDao;
    let added = 0;
    let skipped = 0;
    this.deps.library.db.transaction(() => {
      if (policy === 'replace') dao.clear();
      const existing = new Set(
        dao.listAll(100000).map((x) => `${x.videoId}@${Math.floor(x.watchedAt.getTime() / 1000)}`)
      );
      for (const h of c.items) {
        const key = `${h.videoId}@${Math.floor(h.watchedAt.getTime() / 1000)}`;
        if (existing.has(key)) {
          skipped++;
          continue;
        }
        dao.add(h);
        existing.add(key);
        added++;
      }
    });
    return { category: HonkeImportCategory.HISTORY, added, updated: 0, skipped, notes: c.skipped };
  }

  // ---- プレイリスト ----

  private collectPlaylists(source: HonkeImportSource): Collected<PlaylistCandidate> {
    const dir = this.sysFile(source, 'playList');
    if (!dir || !isDirectory(dir)) return this.missing('playList フォルダ');
    const items: PlaylistCandidate[] = [];
    const skipped: string[] = [];
    const existing = new Set(this.deps.library.playlistDao.list().map((p) => p.name));
    let duplicate = 0;
    let files: string[];
    try {
      files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.m3u'));
    } catch (e) {
      return { total: 0, items: [], duplicate: 0, skipped: [], error: `playList の読み込みに失敗: ${String(e)}` };
    }
    for (const f of files) {
      const name = f.replace(/\.m3u$/i, '');
      const text = readTextIfExists(path.join(dir, f));
      if (text === null) {
        skipped.push(`${f}: 読み込めません`);
        continue;
      }
      const entries: PlaylistCandidate['entries'] = [];
      let noId = 0;
      for (const e of parseM3u(text)) {
        const base = path.basename(e.path.replace(/\\/g, '/'));
        const videoId =
          extractBracketedVideoId(base) ?? extractBracketedVideoId(e.title) ?? base.match(VIDEO_ID_IN_TEXT)?.[1];
        if (!videoId) {
          noId++;
          continue;
        }
        entries.push({ videoId, title: e.title || base.replace(/\.[^.]+$/, ''), lengthSec: e.lengthSec });
      }
      if (noId > 0) skipped.push(`${name}: 動画IDを取り出せない ${noId} 件`);
      if (existing.has(name)) duplicate++;
      items.push({ name, entries });
    }
    return { total: files.length, items, duplicate, skipped };
  }

  private applyPlaylists(c: Collected<PlaylistCandidate>, policy: HonkeImportPolicy): HonkeImportCategoryResult {
    if (c.error) throw new Error(c.error);
    const dao = this.deps.library.playlistDao;
    let added = 0;
    let updated = 0;
    this.deps.library.db.transaction(() => {
      if (policy === 'replace') dao.clearAll();
      const byName = new Map(dao.list().map((p) => [p.name, p.id]));
      for (const p of c.items) {
        let id = byName.get(p.name);
        let isNew = false;
        if (id === undefined) {
          id = dao.create(p.name).id;
          byName.set(p.name, id);
          isNew = true;
        }
        const have = new Set(dao.getItems(id).map((i) => i.videoId));
        let appended = 0;
        for (const e of p.entries) {
          if (have.has(e.videoId)) continue;
          dao.addVideo(id, { videoId: e.videoId, title: e.title, thumbnailUrl: '', lengthSec: e.lengthSec });
          have.add(e.videoId);
          appended++;
        }
        if (isNew) added++;
        else if (appended > 0) updated++;
      }
    });
    return { category: HonkeImportCategory.PLAYLIST, added, updated, skipped: 0, notes: c.skipped };
  }

  // ---- ライブラリ DB ----

  private collectLibrary(
    source: HonkeImportSource,
    pathFrom?: string,
    pathTo?: string
  ): Collected<LibraryCandidate> {
    const dbPath = this.sysFile(source, 'library.db');
    if (!dbPath || !fs.existsSync(dbPath)) return this.missing('library.db');
    let honke: Database.Database | null = null;
    try {
      honke = new Database(dbPath, { readonly: true, fileMustExist: true });
      const rows = honke.prepare('SELECT * FROM nnddvideo;').all() as Record<string, unknown>[];
      const tagMap = new Map<number, string[]>();
      for (const r of honke
        .prepare(
          'SELECT vt.nnddvideo_id AS vid, t.tag AS tag FROM nnddvideo_tag vt JOIN tagstring t ON t.id = vt.tag_id;'
        )
        .all() as { vid: number; tag: string }[]) {
        const arr = tagMap.get(r.vid);
        if (arr) arr.push(r.tag);
        else tagMap.set(r.vid, [r.tag]);
      }

      const toDate = (v: unknown): Date | null => {
        const n = Number(v);
        return v === null || v === undefined || !Number.isFinite(n) || n < 0 ? null : new Date(n);
      };
      const items: LibraryCandidate[] = [];
      let missingFile = 0;
      let badPath = 0;
      let duplicate = 0;
      for (const r of rows) {
        const rawPath = fileUrlToPath(String(r.uri ?? ''));
        if (!rawPath) {
          badPath++;
          continue;
        }
        const uri = applyPathReplace(rawPath, pathFrom, pathTo);
        if (!fs.existsSync(uri)) {
          missingFile++;
          continue;
        }
        const key = extractBracketedVideoId(uri) ?? uri;
        const thumbRaw = String(r.thumbUrl ?? '');
        const thumbPath = thumbRaw.startsWith('file:') ? fileUrlToPath(thumbRaw) : null;
        const thumbUrl = thumbPath ? applyPathReplace(thumbPath, pathFrom, pathTo) : thumbRaw;
        const now = new Date();
        items.push({
          key,
          uri,
          videoName: String(r.videoName ?? path.basename(uri)),
          modificationDate: toDate(r.modificationDate) ?? now,
          creationDate: toDate(r.creationDate) ?? now,
          thumbUrl: thumbUrl && (/^https?:/.test(thumbUrl) || fs.existsSync(thumbUrl)) ? thumbUrl : '',
          playCount: Number(r.playCount) || 0,
          time: Number(r.time) || 0,
          lastPlayDate: toDate(r.lastPlayDate),
          pubDate: toDate(r.pubDate),
          yetReading: Number(r.yetReading) === 1,
          tags: tagMap.get(Number(r.id)) ?? []
        });
      }
      const dao = this.deps.library.videoDao;
      for (const it of items) if (dao.getByKey(it.key)) duplicate++;
      const skipped: string[] = [];
      if (missingFile > 0) {
        skipped.push(
          `動画ファイルが見つからない ${missingFile} 件 (別ドライブ/別PCの場合は「旧ルート→新ルート」を指定してください)`
        );
      }
      if (badPath > 0) skipped.push(`パスを解釈できない ${badPath} 件`);
      return { total: rows.length, items, duplicate, skipped };
    } catch (e) {
      return { total: 0, items: [], duplicate: 0, skipped: [], error: `library.db の読み取りに失敗: ${String(e)}` };
    } finally {
      honke?.close();
    }
  }

  private applyLibrary(c: Collected<LibraryCandidate>, policy: HonkeImportPolicy): HonkeImportCategoryResult {
    if (c.error) throw new Error(c.error);
    const dao = this.deps.library.videoDao;
    let added = 0;
    let updated = 0;
    this.deps.library.db.transaction(() => {
      for (const it of c.items) {
        const existing = dao.getByKey(it.key);
        if (existing) {
          const merged: NNDDREVideo = { ...existing };
          if (policy === 'replace') {
            merged.playCount = it.playCount;
            merged.lastPlayDate = it.lastPlayDate;
            merged.tagStrings = it.tags;
          } else {
            merged.playCount = Math.max(existing.playCount, it.playCount);
            const a = existing.lastPlayDate?.getTime() ?? 0;
            const b = it.lastPlayDate?.getTime() ?? 0;
            merged.lastPlayDate = b > a ? it.lastPlayDate : existing.lastPlayDate;
            merged.tagStrings = Array.from(new Set([...existing.tagStrings, ...it.tags]));
          }
          const dirId = dao.ensureFileDir(path.dirname(existing.uri));
          dao.insertOrUpdate(merged, dirId);
          updated++;
        } else {
          const dirId = dao.ensureFileDir(path.dirname(it.uri));
          dao.insertOrUpdate(
            {
              id: 0,
              uri: it.uri,
              videoName: it.videoName,
              tagStrings: it.tags,
              modificationDate: it.modificationDate,
              creationDate: it.creationDate,
              thumbUrl: it.thumbUrl,
              playCount: it.playCount,
              time: it.time,
              lastPlayDate: it.lastPlayDate,
              yetReading: it.yetReading,
              pubDate: it.pubDate,
              isFavorite: false,
              description: ''
            },
            dirId
          );
          added++;
        }
      }
    });
    return {
      category: HonkeImportCategory.LIBRARY,
      added,
      updated,
      skipped: 0,
      notes: [...c.skipped, '取り込み後に「ライブラリ」でスキャンを実行すると、サムネイルや説明文などが補完されます']
    };
  }

  // ---- DLキュー ----

  private collectDownloadQueue(source: HonkeImportSource): Collected<string> {
    const text = readTextIfExists(this.sysFile(source, 'downloadList.xml'));
    if (text === null) return this.missing('downloadList.xml');
    let list;
    try {
      list = parseDownloadListXml(text);
    } catch (e) {
      return { total: 0, items: [], duplicate: 0, skipped: [], error: `downloadList.xml の解析に失敗: ${String(e)}` };
    }
    const ids = new Set<string>();
    let noId = 0;
    for (const d of list) {
      const id = d.videoUrl.match(VIDEO_ID_IN_TEXT)?.[1];
      if (id) ids.add(id);
      else noId++;
    }
    return {
      total: list.length,
      items: [...ids],
      duplicate: 0,
      skipped: noId > 0 ? [`動画IDを取り出せない ${noId} 件`] : []
    };
  }

  private async applyDownloadQueue(c: Collected<string>): Promise<HonkeImportCategoryResult> {
    if (c.error) throw new Error(c.error);
    let added = 0;
    let skipped = 0;
    for (const id of c.items) {
      try {
        await this.deps.enqueueDownload(id);
        added++;
      } catch (e) {
        log.warn(`DLキュー追加に失敗: ${id}`, e);
        skipped++;
      }
    }
    return { category: HonkeImportCategory.DOWNLOAD_QUEUE, added, updated: 0, skipped, notes: c.skipped };
  }
}
