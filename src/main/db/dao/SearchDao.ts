import type {
  SearchItem,
  NNDDRESearchTypeValue,
  NNDDRESearchSortTypeValue
} from '@shared/types';
import { NnddDatabase } from '../Database';
import { Q } from '../schema';

interface SearchRow {
  id: string;
  name: string;
  word: string;
  type: string;
  sortType: string;
}

/**
 * 保存検索 DAO
 * 元: src/org/mineap/nndd/search/SearchItemManager.as
 */
export class SearchDao {
  constructor(private readonly db: NnddDatabase) {}

  list(): SearchItem[] {
    const rows = this.db.prepare(Q.SELECT_SAVED_SEARCHES).all() as SearchRow[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      word: r.word,
      type: r.type as NNDDRESearchTypeValue,
      sortType: r.sortType as NNDDRESearchSortTypeValue
    }));
  }

  upsert(s: SearchItem): void {
    this.db
      .prepare(Q.INSERT_SAVED_SEARCH)
      .run(s.id, s.name, s.word, s.type, s.sortType);
  }

  remove(id: string): void {
    this.db.prepare(Q.DELETE_SAVED_SEARCH).run(id);
  }

  /** 全保存検索を削除 */
  clearAll(): void {
    this.db.prepare(Q.DELETE_ALL_SAVED_SEARCH).run();
  }
}
