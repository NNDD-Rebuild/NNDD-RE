import type { NicoWatchHistoryItem } from '@shared/types';
import { NnddDatabase } from '../Database';
import { Q } from '../schema';

/** 履歴1件の識別キー。本家は同じ動画の複数回視聴を別項目で返すため、videoId + 視聴日時 (秒、無ければ0) で区別する */
export function nicoHistoryKey(videoId: string, watchedAt: Date | null): string {
  return `${videoId}@${watchedAt ? watchedAt.getTime() / 1000 : 0}`;
}

interface NicoWatchHistoryRow {
  videoId: string;
  title: string;
  thumbnailUrl: string;
  watchedAt: number;
  fetchedAt: number;
}

interface KeyRow {
  id: number;
  videoId: string;
  watchedAt: number;
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

  /** 差分取得の打ち切り判定用に既知の履歴キー (nicoHistoryKey) 一覧を取得 */
  listKeys(): Set<string> {
    const rows = this.db.prepare(Q.SELECT_NICO_WATCH_HISTORY_KEYS).all() as KeyRow[];
    return new Set(rows.map((r) => `${r.videoId}@${r.watchedAt}`));
  }

  upsertBatch(items: NicoWatchHistoryItem[]): void {
    const stmt = this.db.prepare(Q.UPSERT_NICO_WATCH_HISTORY);
    this.db.transaction(() => {
      for (const item of items) {
        stmt.run(
          item.videoId,
          item.title,
          item.thumbnailUrl,
          item.watchedAt ? item.watchedAt.getTime() / 1000 : 0,
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

  /** 1件削除 (ローカルキャッシュのみ) */
  remove(videoId: string): void {
    this.db.prepare(Q.DELETE_NICO_WATCH_HISTORY_BY_VIDEO_ID).run(videoId);
  }

  /**
   * keepKeys (nicoHistoryKey) に含まれず、かつ視聴日時が newerThanSec (秒) より新しい項目を削除し、削除件数を返す。
   * 本家側で消された履歴のローカル反映用。本家は保存期間 (一般30日 / プレミアム180日) を過ぎた履歴を消すので、
   * 本家に残っている最古の視聴日時より古い項目は「期限切れ」と区別できないため消さない。
   * 視聴日時が不明 (0) の項目も消さない。
   */
  removeNotIn(keepKeys: Set<string>, newerThanSec: number): number {
    const stmt = this.db.prepare(Q.DELETE_NICO_WATCH_HISTORY_BY_ID);
    let removed = 0;
    this.db.transaction(() => {
      const rows = this.db.prepare(Q.SELECT_NICO_WATCH_HISTORY_KEYS).all() as KeyRow[];
      for (const r of rows) {
        if (r.watchedAt > newerThanSec && !keepKeys.has(`${r.videoId}@${r.watchedAt}`)) {
          stmt.run(r.id);
          removed++;
        }
      }
    });
    return removed;
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
