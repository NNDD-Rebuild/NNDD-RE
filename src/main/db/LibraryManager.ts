import path from 'node:path';
import os from 'node:os';
import { app } from 'electron';
import { NnddDatabase } from './Database';
import {
  VideoDao,
  MyListDao,
  HistoryDao,
  ScheduleDao,
  SearchDao,
  InputHistoryDao,
  NgListDao,
  PlaylistDao,
  ResumeDao,
  NicoWatchHistoryDao
} from './dao';
import { randomUUID } from 'node:crypto';
import { NnddPaths } from '@shared/constants';
import type { AccountDataCounts } from '@shared/types';

/**
 * NNDDライブラリ全体の管理。
 * 元: src/org/mineap/nndd/library/sqlite/SQLiteLibraryManager.as
 *
 * - 各DAOを生成して提供
 * - パス管理 (Documents/NNDD-RE/...)
 */
export class LibraryManager {
  readonly db: NnddDatabase;
  readonly videoDao: VideoDao;
  readonly myListDao: MyListDao;
  readonly historyDao: HistoryDao;
  readonly scheduleDao: ScheduleDao;
  readonly searchDao: SearchDao;
  readonly inputHistoryDao: InputHistoryDao;
  readonly ngListDao: NgListDao;
  readonly playlistDao: PlaylistDao;
  readonly resumeDao: ResumeDao;
  readonly nicoWatchHistoryDao: NicoWatchHistoryDao;

  readonly rootDir: string;
  readonly libraryDir: string;
  readonly systemDir: string;
  readonly tempDir: string;
  /** 旧AIR版のファイルベース・プレイリスト実装の名残 (現在未使用、DBベースの playlistDao とは無関係) */
  readonly playlistDir: string;
  /** 動画の保存・スキャン対象ディレクトリ。設定で変更可能。 */
  videoDir: string;

  /** libraryRoot 未設定時のデフォルト動画保存先 */
  get defaultVideoDir(): string {
    return path.join(this.rootDir, NnddPaths.LIBRARY_DIR_NAME, NnddPaths.DOWNLOADS_DIR_NAME);
  }

  private constructor(rootDir: string) {
    this.rootDir = rootDir;
    this.libraryDir = path.join(rootDir, NnddPaths.LIBRARY_DIR_NAME);
    this.systemDir = path.join(rootDir, NnddPaths.SYSTEM_DIR_NAME);
    this.tempDir = path.join(rootDir, NnddPaths.TEMP_DIR_NAME);
    this.playlistDir = path.join(rootDir, NnddPaths.PLAYLIST_DIR_NAME);
    this.videoDir = this.defaultVideoDir;

    const dbPath = path.join(this.systemDir, NnddPaths.DB_FILE_NAME);
    this.db = new NnddDatabase(dbPath);

    this.videoDao = new VideoDao(this.db);
    this.myListDao = new MyListDao(this.db);
    this.historyDao = new HistoryDao(this.db);
    this.scheduleDao = new ScheduleDao(this.db);
    this.searchDao = new SearchDao(this.db);
    this.inputHistoryDao = new InputHistoryDao(this.db);
    this.ngListDao = new NgListDao(this.db);
    this.playlistDao = new PlaylistDao(this.db);
    this.resumeDao = new ResumeDao(this.db);
    this.nicoWatchHistoryDao = new NicoWatchHistoryDao(this.db);
  }

  /**
   * デフォルトのライブラリディレクトリでマネージャーを生成。
   * ~/Documents/NNDD-RE/ がベース。
   */
  static createDefault(): LibraryManager {
    const documentsDir = app
      ? app.getPath('documents')
      : path.join(os.homedir(), 'Documents');
    const root = path.join(documentsDir, NnddPaths.ROOT_DIR_NAME);
    return new LibraryManager(root);
  }

  static createAt(rootDir: string): LibraryManager {
    return new LibraryManager(rootDir);
  }

  /** マイリスト・スケジュール・プレイリストのいずれかを持っているアカウント (未ログイン分は空文字) */
  listAccountsWithData(): string[] {
    return this.db
      .prepare(
        `SELECT account FROM mylist UNION SELECT account FROM schedule UNION SELECT account FROM playlist ORDER BY account;`
      )
      .pluck()
      .all() as string[];
  }

  /** そのアカウントのローカルデータの件数 (録画予約は config にあるので含まない) */
  countAccountData(account: string): Pick<AccountDataCounts, 'mylist' | 'playlist' | 'schedule'> {
    const n = (sql: string): number => (this.db.prepare(sql).pluck().get(account) as number) ?? 0;
    return {
      mylist: n(`SELECT COUNT(*) FROM mylist WHERE account = ? AND isDir = 0;`),
      playlist: n(`SELECT COUNT(*) FROM playlist WHERE account = ?;`),
      schedule: n(`SELECT COUNT(*) FROM schedule WHERE account = ?;`)
    };
  }

  /**
   * あるアカウントのデータを別のアカウントへ移動・コピーする (録画予約は config なので呼び出し側で扱う)。
   * - 移動先に同じ URL / 同じ ID があるものは、移動先の行を優先する (上書きしない)
   * - プレイリストのニコニコ側マイリストとの同期は、移動・コピーで解除する (同期先のマイリストは元のアカウントのものなので)
   * @returns 対象にした件数 (移動先に同じものがあって動かさなかった分を含む)
   */
  transferAccountData(
    from: string,
    to: string,
    kinds: { mylist: boolean; playlist: boolean; schedule: boolean },
    mode: 'move' | 'copy'
  ): Pick<AccountDataCounts, 'mylist' | 'playlist' | 'schedule'> {
    const done = { mylist: 0, playlist: 0, schedule: 0 };
    if (from === to) return done;
    const before = this.countAccountData(from);
    this.db.transaction(() => {
      if (kinds.mylist) {
        const cols = 'url, name, type, isDir, unPlayCount, lastRenewed, icon, parentUrl';
        if (mode === 'copy') {
          this.db
            .prepare(`INSERT OR IGNORE INTO mylist (account, ${cols}) SELECT ?, ${cols} FROM mylist WHERE account = ?;`)
            .run(to, from);
          this.db
            .prepare(
              `INSERT OR IGNORE INTO mylist_history (account, url, name, usedAt) SELECT ?, url, name, usedAt FROM mylist_history WHERE account = ?;`
            )
            .run(to, from);
        } else {
          this.db.prepare(`UPDATE OR IGNORE mylist SET account = ? WHERE account = ?;`).run(to, from);
          this.db.prepare(`UPDATE OR IGNORE mylist_history SET account = ? WHERE account = ?;`).run(to, from);
          // 移動先に同じ URL があって動かせなかった行は、移動先のものと重複なので消す
          this.db.prepare(`DELETE FROM mylist WHERE account = ?;`).run(from);
          this.db.prepare(`DELETE FROM mylist_history WHERE account = ?;`).run(from);
        }
        done.mylist = before.mylist;
      }
      if (kinds.playlist) {
        const ids = this.db.prepare(`SELECT id FROM playlist WHERE account = ?;`).pluck().all(from) as number[];
        if (mode === 'copy') {
          const insertPlaylist = this.db.prepare(
            `INSERT INTO playlist (account, name, createdAt, updatedAt, icon) SELECT ?, name, createdAt, updatedAt, icon FROM playlist WHERE id = ?;`
          );
          const copyItems = this.db.prepare(
            `INSERT INTO playlist_item (playlist_id, videoId, title, thumbnailUrl, lengthSec, sortOrder, addedAt)
             SELECT ?, videoId, title, thumbnailUrl, lengthSec, sortOrder, addedAt FROM playlist_item WHERE playlist_id = ?;`
          );
          for (const id of ids) {
            const created = Number(insertPlaylist.run(to, id).lastInsertRowid);
            copyItems.run(created, id);
          }
        } else {
          const removeBase = this.db.prepare(`DELETE FROM playlist_sync_base WHERE playlist_id = ?;`);
          for (const id of ids) removeBase.run(id);
          // 元のアカウントのニコニコ側マイリストには登録キーが残るので、取り込み除外にして復活 (重複) させない
          this.db
            .prepare(
              `INSERT OR IGNORE INTO playlist_sync_dismissed (account, syncKey)
               SELECT account, syncKey FROM playlist WHERE account = ? AND syncKey IS NOT NULL;`
            )
            .run(from);
          this.db
            .prepare(`UPDATE playlist SET account = ?, serverMylistId = NULL, syncKey = NULL WHERE account = ?;`)
            .run(to, from);
        }
        done.playlist = ids.length;
      }
      if (kinds.schedule) {
        if (mode === 'copy') {
          const list = this.scheduleDao.list(from);
          for (const s of list) this.scheduleDao.upsert(to, { ...s, id: randomUUID(), lastRun: null });
          done.schedule = list.length;
        } else {
          this.db.prepare(`UPDATE OR IGNORE schedule SET account = ? WHERE account = ?;`).run(to, from);
          // 移動先に同じ ID があって動かせなかった行は重複なので消す (マイリストと同じ扱い)
          this.db.prepare(`DELETE FROM schedule WHERE account = ?;`).run(from);
          done.schedule = before.schedule;
        }
      }
    });
    return done;
  }

  /**
   * アカウント導入前に作ったデータ (account='') を、最初にログインしたアカウントへ引き継ぐ。
   * マイリスト・マイリスト履歴・プレイリスト・スケジュールが対象。既に同じ URL がある行は引き継がず残す。
   * 録画予約 (config) は呼び出し側で扱う。
   * @param scope 'core': マイリスト等 / 'ngHistory': 後からアカウント別になったコメントNG・ニコ動視聴履歴
   */
  adoptUnscopedData(account: string, scope: 'core' | 'ngHistory' = 'core'): void {
    if (!account) return;
    const tables =
      scope === 'core'
        ? ['mylist', 'mylist_history', 'playlist', 'playlist_sync_dismissed', 'schedule']
        : ['ng_list', 'nico_watch_history'];
    this.db.transaction(() => {
      for (const table of tables) {
        this.db.prepare(`UPDATE OR IGNORE ${table} SET account = ? WHERE account = '';`).run(account);
      }
    });
  }

  close(): void {
    this.db.close();
  }
}
