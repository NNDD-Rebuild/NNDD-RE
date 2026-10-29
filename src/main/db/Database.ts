import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { CREATE_TABLES, DB_SCHEMA_VERSION, Q } from './schema';
import { createLogger } from '../util/Logger';

const log = createLogger('DB');

/**
 * better-sqlite3 ラッパー。
 * 元: src/org/mineap/nndd/library/sqlite/DbAccessHelper.as
 *
 * - 起動時にスキーマを生成 (CREATE TABLE IF NOT EXISTS)
 * - バージョン差分を検出した場合にマイグレーション (今後拡張)
 */
export class NnddDatabase {
  private db: Database.Database;

  constructor(private readonly dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initialize();
  }

  private initialize(): void {
    this.db.transaction(() => {
      for (const sql of CREATE_TABLES) {
        this.db.exec(sql);
      }
      const current = this.db.prepare(Q.SELECT_VERSION).get() as
        | { version: string }
        | undefined;
      if (!current) {
        this.db.prepare(Q.INSERT_VERSION).run(DB_SCHEMA_VERSION);
      } else if (current.version !== DB_SCHEMA_VERSION) {
        this.migrate(current.version, DB_SCHEMA_VERSION);
        this.db.prepare(Q.INSERT_VERSION).run(DB_SCHEMA_VERSION);
      }
      // 登録キーの一意制約。カラムの追加 (migrate) の後でないと既存 DB で失敗するので、ここで作る
      this.db.exec(
        `CREATE UNIQUE INDEX IF NOT EXISTS playlist_sync_key_idx ON playlist (syncKey) WHERE syncKey IS NOT NULL;`
      );
    })();
  }

  private migrate(from: string, _to: string): void {
    log.info(`migrating from ${from}`);
    // v4 → v5: isEconomy カラム削除 (SQLite 3.35+)
    if (from === '4') {
      try {
        this.db.exec(`ALTER TABLE NNDDREVideo DROP COLUMN isEconomy;`);
        log.info('dropped isEconomy column');
      } catch {
        // 古い SQLite か既にカラムなし — 無視
      }
    }
    // v5 → v6: mylist / playlist に icon カラム追加
    if (from === '4' || from === '5' || from === '6') {
      try {
        this.db.exec(`ALTER TABLE mylist ADD COLUMN icon TEXT;`);
        log.info('added mylist.icon column');
      } catch {
        // 既にカラムあり — 無視
      }
      try {
        this.db.exec(`ALTER TABLE playlist ADD COLUMN icon TEXT;`);
        log.info('added playlist.icon column');
      } catch {
        // 既にカラムあり — 無視
      }
      try {
        this.db.exec(`ALTER TABLE NNDDREVideo ADD COLUMN isFavorite INTEGER DEFAULT 0;`);
        log.info('added NNDDREVideo.isFavorite column');
      } catch {
        // 既にカラムあり — 無視
      }
    }
    // v6 → v7: NNDDREVideo に description カラム追加 (オフライン全文検索用)
    if (from === '4' || from === '5' || from === '6') {
      try {
        this.db.exec(`ALTER TABLE NNDDREVideo ADD COLUMN description TEXT;`);
        log.info('added NNDDREVideo.description column');
      } catch {
        // 既にカラムあり — 無視
      }
    }
    // v7 → v8: history に watchSeconds カラム追加 (実測視聴時間)
    if (from === '4' || from === '5' || from === '6' || from === '7') {
      try {
        this.db.exec(`ALTER TABLE history ADD COLUMN watchSeconds REAL DEFAULT 0;`);
        log.info('added history.watchSeconds column');
      } catch {
        // 既にカラムあり — 無視
      }
    }
    // v9 → v10: schedule に targetType / targetId カラム追加 (シリーズ/フォロー投稿者自動DL対応)
    if (
      from === '4' || from === '5' || from === '6' || from === '7' ||
      from === '8' || from === '9'
    ) {
      try {
        this.db.exec(`ALTER TABLE schedule ADD COLUMN targetType TEXT DEFAULT 'mylist';`);
        log.info('added schedule.targetType column');
      } catch {
        // 既にカラムあり — 無視
      }
      try {
        this.db.exec(`ALTER TABLE schedule ADD COLUMN targetId TEXT;`);
        log.info('added schedule.targetId column');
      } catch {
        // 既にカラムあり — 無視
      }
    }
    // v10 → v11: mylist に parentUrl カラム追加 (フォルダ階層)
    if (Number(from) <= 10) {
      try {
        this.db.exec(`ALTER TABLE mylist ADD COLUMN parentUrl TEXT;`);
        log.info('added mylist.parentUrl column');
      } catch {
        // 既にカラムあり — 無視
      }
    }
    // v11 → v12: 欠番 (マイリストの同期フラグは廃止。自分のマイリストは所有確認だけで書き込めるため)
    // v12 → v13: playlist に serverMylistId カラム追加 (ニコニコ側マイリストとの同期)
    if (Number(from) <= 12) {
      try {
        this.db.exec(`ALTER TABLE playlist ADD COLUMN serverMylistId TEXT;`);
        log.info('added playlist.serverMylistId column');
      } catch {
        // 既にカラムあり — 無視
      }
    }
    // v13 → v14: playlist に syncKey カラム追加 (別の PC でも同じプレイリストだと見分ける登録キー)
    if (Number(from) <= 13) {
      try {
        this.db.exec(`ALTER TABLE playlist ADD COLUMN syncKey TEXT;`);
        log.info('added playlist.syncKey column');
      } catch {
        // 既にカラムあり — 無視
      }
    }
    // v14 → v15: nico_watch_history を (videoId, watchedAt) 単位に変更 (同じ動画を複数回見た履歴を本家と同じく別項目で持つ)。
    // 本家は保存期間 (一般30日 / プレミアム180日) を過ぎた履歴を消すので、ローカルにしか無い古い履歴を失わないよう既存行は引き継ぐ
    if (Number(from) <= 14) {
      const cols = this.db.prepare(`PRAGMA table_info(nico_watch_history);`).all() as { name: string }[];
      if (cols.length > 0 && !cols.some((c) => c.name === 'id')) {
        this.db.exec(`ALTER TABLE nico_watch_history RENAME TO nico_watch_history_old;`);
        const create = CREATE_TABLES.find((sql) => sql.includes('CREATE TABLE IF NOT EXISTS nico_watch_history'));
        if (create) this.db.exec(create);
        this.db.exec(
          `INSERT OR IGNORE INTO nico_watch_history (videoId, title, thumbnailUrl, watchedAt, fetchedAt)
           SELECT videoId, title, thumbnailUrl, COALESCE(watchedAt, 0), fetchedAt FROM nico_watch_history_old;`
        );
        this.db.exec(`DROP TABLE nico_watch_history_old;`);
        log.info('migrated nico_watch_history to (videoId, watchedAt) key');
      }
    }
    // v15 → v16: schedule に makeSubfolder カラム追加 (自動DLで対象名のサブフォルダを作る)
    if (Number(from) <= 15) {
      try {
        this.db.exec(`ALTER TABLE schedule ADD COLUMN makeSubfolder INTEGER DEFAULT 0;`);
        log.info('added schedule.makeSubfolder column');
      } catch {
        // 既にカラムあり — 無視
      }
    }
    // v16 → v17: saved_search に parentId / isDir カラム追加 (保存検索のフォルダ分け)
    if (Number(from) <= 16) {
      for (const sql of [
        `ALTER TABLE saved_search ADD COLUMN parentId TEXT;`,
        `ALTER TABLE saved_search ADD COLUMN isDir INTEGER DEFAULT 0;`
      ]) {
        try {
          this.db.exec(sql);
        } catch {
          // 既にカラムあり — 無視
        }
      }
      log.info('added saved_search.parentId / isDir columns');
    }
    // v17 → v18: マルチアカウント対応。マイリスト・マイリスト履歴・プレイリスト・スケジュールをアカウントごとに持つ。
    // 既存の行は account='' (未割り当て) にして、最初にログインしたアカウントへ後で引き継ぐ (LibraryManager.adoptUnscopedData)
    if (Number(from) <= 17) {
      // url / id の一意制約を account 付きにするため、SQLite では表を作り直すしかない
      for (const table of ['mylist', 'mylist_history', 'playlist_sync_dismissed', 'schedule']) {
        this.rebuildWithAccount(table);
      }
      // playlist は playlist_item などが id で参照するので、表は作り直さず列だけ足す
      const playlistCols = this.db.prepare(`PRAGMA table_info(playlist);`).all() as { name: string }[];
      if (!playlistCols.some((c) => c.name === 'account')) {
        this.db.exec(`ALTER TABLE playlist ADD COLUMN account TEXT NOT NULL DEFAULT '';`);
      }
      log.info('added account scope to mylist / mylist_history / playlist / playlist_sync_dismissed / schedule');
    }
  }

  /** account カラムを持つ定義で表を作り直し、既存の行は account='' で引き継ぐ (既に account があれば何もしない) */
  private rebuildWithAccount(table: string): void {
    const oldCols = this.db.prepare(`PRAGMA table_info(${table});`).all() as { name: string }[];
    if (oldCols.length === 0 || oldCols.some((c) => c.name === 'account')) return;
    const create = CREATE_TABLES.find((sql) => sql.includes(`CREATE TABLE IF NOT EXISTS ${table} (`));
    if (!create) throw new Error(`CREATE TABLE definition not found: ${table}`);
    this.db.exec(`ALTER TABLE ${table} RENAME TO ${table}_old;`);
    this.db.exec(create);
    const newCols = new Set((this.db.prepare(`PRAGMA table_info(${table});`).all() as { name: string }[]).map((c) => c.name));
    const common = oldCols.map((c) => c.name).filter((n) => newCols.has(n));
    const list = common.join(', ');
    this.db.exec(`INSERT OR IGNORE INTO ${table} (${list}) SELECT ${list} FROM ${table}_old;`);
    this.db.exec(`DROP TABLE ${table}_old;`);
  }

  /** プリペアドステートメントの取得 */
  prepare(sql: string): Database.Statement {
    return this.db.prepare(sql);
  }

  /** トランザクション実行 */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  /** 接続を閉じる */
  close(): void {
    this.db.close();
  }

  /** 内部の better-sqlite3 インスタンス (上級者用) */
  get raw(): Database.Database {
    return this.db;
  }
}
