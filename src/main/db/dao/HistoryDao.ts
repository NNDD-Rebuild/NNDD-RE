import type { HistoryItem } from '@shared/types';
import { NnddDatabase } from '../Database';
import { Q } from '../schema';

interface HistoryRow {
  id: number;
  videoId: string;
  title: string;
  thumbnailUrl: string;
  watchedAt: number;
  isLocal: number;
  watchSeconds: number | null;
}

/**
 * 視聴履歴 DAO
 * 元: src/org/mineap/nndd/history/HistoryManager.as
 */
export class HistoryDao {
  constructor(private readonly db: NnddDatabase) {}

  list(limit = 1000): HistoryItem[] {
    const rows = this.db.prepare(Q.SELECT_HISTORY).all(limit) as HistoryRow[];
    return rows.map((r) => ({
      videoId: r.videoId,
      title: r.title,
      thumbnailUrl: r.thumbnailUrl,
      watchedAt: new Date(r.watchedAt * 1000),
      isLocal: r.isLocal === 1,
      watchSeconds: r.watchSeconds ?? 0
    }));
  }

  /** バックアップ用: 上限付きで全件相当を取得 (既定5000件、Gistサイズ超過を避ける安全弁) */
  listAll(limit = 5000): HistoryItem[] {
    const rows = this.db.prepare(Q.SELECT_HISTORY_ALL).all(limit) as HistoryRow[];
    return rows.map((r) => ({
      videoId: r.videoId,
      title: r.title,
      thumbnailUrl: r.thumbnailUrl,
      watchedAt: new Date(r.watchedAt * 1000),
      isLocal: r.isLocal === 1,
      watchSeconds: r.watchSeconds ?? 0
    }));
  }

  add(item: HistoryItem): void {
    this.db
      .prepare(Q.INSERT_HISTORY)
      .run(
        item.videoId,
        item.title,
        item.thumbnailUrl,
        item.watchedAt.getTime() / 1000,
        item.isLocal ? 1 : 0,
        item.watchSeconds ?? 0
      );
  }

  clear(): void {
    this.db.prepare(Q.DELETE_HISTORY).run();
  }

  /** 再生済みバッジ表示用バッチ判定 */
  existsBatch(videoIds: string[]): Set<string> {
    const result = new Set<string>();
    const stmt = this.db.prepare(Q.SELECT_HISTORY_EXISTS);
    for (const id of videoIds) {
      if (stmt.get(id)) result.add(id);
    }
    return result;
  }
}
