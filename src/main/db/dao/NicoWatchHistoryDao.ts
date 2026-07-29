import type { NicoWatchHistoryItem } from '@shared/types';
import { NnddDatabase } from '../Database';
import { Q } from '../schema';

interface NicoWatchHistoryRow {
  videoId: string;
  title: string;
  thumbnailUrl: string;
  watchedAt: number | null;
  fetchedAt: number;
}

/**
 * ニコニコ動画本家 (公式サイト) 側の視聴履歴 DAO。
 * アプリ内の視聴履歴 (HistoryDao) とは出所が異なるため別テーブル・別DAOで管理する。
 */
export class NicoWatchHistoryDao {
  constructor(private readonly db: NnddDatabase) {}

  list(limit = 1000): NicoWatchHistoryItem[] {
    const rows = this.db.prepare(Q.SELECT_NICO_WATCH_HISTORY).all(limit) as NicoWatchHistoryRow[];
    return rows.map((r) => this.rowToItem(r));
  }

  /** 差分取得の打ち切り判定用に既知videoId一覧を取得 */
  listVideoIds(): Set<string> {
    const rows = this.db.prepare(Q.SELECT_NICO_WATCH_HISTORY_VIDEO_IDS).all() as { videoId: string }[];
    return new Set(rows.map((r) => r.videoId));
  }

  upsertBatch(items: NicoWatchHistoryItem[]): void {
    const stmt = this.db.prepare(Q.UPSERT_NICO_WATCH_HISTORY);
    this.db.transaction(() => {
      for (const item of items) {
        stmt.run(
          item.videoId,
          item.title,
          item.thumbnailUrl,
          item.watchedAt ? item.watchedAt.getTime() / 1000 : null,
          item.fetchedAt.getTime() / 1000
        );
      }
    });
  }

  /** VideoCard等でのバッジ表示用バッチ判定 */
  existsBatch(videoIds: string[]): Set<string> {
    const result = new Set<string>();
    const stmt = this.db.prepare(Q.SELECT_NICO_WATCH_HISTORY_EXISTS);
    for (const id of videoIds) {
      if (stmt.get(id)) result.add(id);
    }
    return result;
  }

  clear(): void {
    this.db.prepare(Q.DELETE_NICO_WATCH_HISTORY).run();
  }

  private rowToItem(r: NicoWatchHistoryRow): NicoWatchHistoryItem {
    return {
      videoId: r.videoId,
      title: r.title,
      thumbnailUrl: r.thumbnailUrl,
      watchedAt: r.watchedAt ? new Date(r.watchedAt * 1000) : null,
      fetchedAt: new Date(r.fetchedAt * 1000)
    };
  }
}
