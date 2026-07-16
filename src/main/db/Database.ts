import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { CREATE_TABLES, DB_SCHEMA_VERSION, Q } from './schema';

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
    })();
  }

  private migrate(from: string, _to: string): void {
    console.log(`[DB] migrating from ${from}`);
    // v4 → v5: isEconomy カラム削除 (SQLite 3.35+)
    if (from === '4') {
      try {
        this.db.exec(`ALTER TABLE NNDDREVideo DROP COLUMN isEconomy;`);
        console.log('[DB] dropped isEconomy column');
      } catch {
        // 古い SQLite か既にカラムなし — 無視
      }
    }
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
