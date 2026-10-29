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
  parentId: string | null;
  isDir: number | null;
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
      sortType: r.sortType as NNDDRESearchSortTypeValue,
      parentId: r.parentId ?? null,
      isDir: !!r.isDir
    }));
  }

  upsert(s: SearchItem): void {
    this.db
      .prepare(Q.INSERT_SAVED_SEARCH)
      .run(s.id, s.name, s.word ?? '', s.type ?? '', s.sortType ?? '', s.parentId ?? null, s.isDir ? 1 : 0);
  }

  /** 別のフォルダ (null でルート) へ移動。自分自身や子孫フォルダへは移動しない */
  move(id: string, parentId: string | null): void {
    if (id === parentId) return;
    const parentOf = new Map(this.list().map((s) => [s.id, s.parentId ?? null]));
    for (let cur = parentId; cur; cur = parentOf.get(cur) ?? null) {
      if (cur === id) return;
    }
    this.db.prepare(Q.UPDATE_SAVED_SEARCH_PARENT).run(parentId, id);
  }

  /** 削除。フォルダのときは中身 (子孫) もまとめて削除する */
  remove(id: string): void {
    const all = this.list();
    const ids = new Set<string>([id]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const s of all) {
        if (s.parentId && ids.has(s.parentId) && !ids.has(s.id)) {
          ids.add(s.id);
          grew = true;
        }
      }
    }
    this.db.transaction(() => {
      for (const x of ids) this.db.prepare(Q.DELETE_SAVED_SEARCH).run(x);
    });
  }

  /** 全保存検索を削除 */
  clearAll(): void {
    this.db.prepare(Q.DELETE_ALL_SAVED_SEARCH).run();
  }
}
