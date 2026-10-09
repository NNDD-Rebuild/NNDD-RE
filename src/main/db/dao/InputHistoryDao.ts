import { INPUT_HISTORY_MAX, type MyListHistoryEntry } from '@shared/utils/inputHistory';
import { NnddDatabase } from '../Database';
import { Q } from '../schema';

interface UsedRange {
  minUsedAt: number | null;
  maxUsedAt: number | null;
}

/**
 * 入力欄の履歴 (検索ワード・マイリストURL) DAO。
 * 元: NNDD.as の searchHistoryProvider / MyListHistoryManager
 *
 * usedAt の新しい順に最大 INPUT_HISTORY_MAX 件を保持する。同じ項目は usedAt を更新して先頭へ繰り上げる。
 */
export class InputHistoryDao {
  constructor(private readonly db: NnddDatabase) {}

  /** 既存のどれよりも新しい usedAt (同一ミリ秒でも順序が崩れないよう単調増加させる) */
  private nextUsedAt(rangeSql: string): number {
    const r = this.db.prepare(rangeSql).get() as UsedRange;
    return Math.max(Date.now(), (r.maxUsedAt ?? 0) + 1);
  }

  /** 既存のどれよりも古い usedAt の基準 (履歴が空なら現在時刻) */
  private olderBase(rangeSql: string): number {
    const r = this.db.prepare(rangeSql).get() as UsedRange;
    return (r.minUsedAt ?? Date.now() + 1) - 1;
  }

  // ---- 検索ワード ----

  listSearch(): string[] {
    const rows = this.db.prepare(Q.SELECT_SEARCH_HISTORY).all(INPUT_HISTORY_MAX) as { word: string }[];
    return rows.map((r) => r.word);
  }

  addSearch(word: string): void {
    this.db.transaction(() => {
      const usedAt = this.nextUsedAt(Q.SELECT_SEARCH_HISTORY_USED_RANGE);
      this.db.prepare(Q.UPSERT_SEARCH_HISTORY).run(word, usedAt);
      this.db.prepare(Q.TRIM_SEARCH_HISTORY).run(INPUT_HISTORY_MAX);
    });
  }

  /** 既存の履歴より古いものとして追加 (新しい順の配列)。既にある項目は触らない */
  appendOlderSearch(words: string[]): void {
    this.db.transaction(() => {
      const base = this.olderBase(Q.SELECT_SEARCH_HISTORY_USED_RANGE);
      words.forEach((w, i) => this.db.prepare(Q.INSERT_SEARCH_HISTORY_IGNORE).run(w, base - i));
      this.db.prepare(Q.TRIM_SEARCH_HISTORY).run(INPUT_HISTORY_MAX);
    });
  }

  clearSearch(): void {
    this.db.prepare(Q.DELETE_ALL_SEARCH_HISTORY).run();
  }

  // ---- マイリストURL ----

  listMyList(): MyListHistoryEntry[] {
    return this.db.prepare(Q.SELECT_MYLIST_HISTORY).all(INPUT_HISTORY_MAX) as MyListHistoryEntry[];
  }

  addMyList(entry: MyListHistoryEntry): void {
    this.db.transaction(() => {
      const usedAt = this.nextUsedAt(Q.SELECT_MYLIST_HISTORY_USED_RANGE);
      this.db.prepare(Q.UPSERT_MYLIST_HISTORY).run(entry.url, entry.name, usedAt);
      this.db.prepare(Q.TRIM_MYLIST_HISTORY).run(INPUT_HISTORY_MAX);
    });
  }

  /** 既存の履歴より古いものとして追加 (新しい順の配列)。既にある項目は触らない */
  appendOlderMyList(entries: MyListHistoryEntry[]): void {
    this.db.transaction(() => {
      const base = this.olderBase(Q.SELECT_MYLIST_HISTORY_USED_RANGE);
      entries.forEach((e, i) => this.db.prepare(Q.INSERT_MYLIST_HISTORY_IGNORE).run(e.url, e.name, base - i));
      this.db.prepare(Q.TRIM_MYLIST_HISTORY).run(INPUT_HISTORY_MAX);
    });
  }

  clearMyList(): void {
    this.db.prepare(Q.DELETE_ALL_MYLIST_HISTORY).run();
  }
}
