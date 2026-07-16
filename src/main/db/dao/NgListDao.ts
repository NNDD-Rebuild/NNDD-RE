import type { NgListItem, NgListItemTypeValue } from '@shared/types';
import { NnddDatabase } from '../Database';
import { Q } from '../schema';

interface NgRow {
  id: number;
  type: string;
  value: string;
}

/**
 * NGリスト DAO
 * 元: src/org/mineap/nndd/player/NGListManager.as / NgTagManager.as
 */
export class NgListDao {
  constructor(private readonly db: NnddDatabase) {}

  // コメントNG
  listComment(): NgListItem[] {
    const rows = this.db.prepare(Q.SELECT_NG_LIST).all() as NgRow[];
    return rows.map((r) => ({
      type: r.type as NgListItemTypeValue,
      value: r.value
    }));
  }

  addComment(item: NgListItem): void {
    this.db.prepare(Q.INSERT_NG_LIST).run(item.type, item.value);
  }

  removeComment(item: NgListItem): void {
    this.db.prepare(Q.DELETE_NG_LIST).run(item.type, item.value);
  }

  // NGタグ (動画用)
  listTags(): string[] {
    const rows = this.db.prepare(Q.SELECT_NG_TAGS).all() as { tag: string }[];
    return rows.map((r) => r.tag);
  }

  addTag(tag: string): void {
    this.db.prepare(Q.INSERT_NG_TAG).run(tag);
  }

  removeTag(tag: string): void {
    this.db.prepare(Q.DELETE_NG_TAG).run(tag);
  }

  // NGユーザー (動画投稿者)
  listUps(): string[] {
    const rows = this.db.prepare(Q.SELECT_NG_UPS).all() as { userId: string }[];
    return rows.map((r) => r.userId);
  }

  addUp(userId: string): void {
    this.db.prepare(Q.INSERT_NG_UP).run(userId);
  }

  removeUp(userId: string): void {
    this.db.prepare(Q.DELETE_NG_UP).run(userId);
  }

  /** 全NGリスト (コメント/タグ/ユーザー) を削除 */
  clearAll(): void {
    this.db.prepare(Q.DELETE_ALL_NG_LIST).run();
    this.db.prepare(Q.DELETE_ALL_NG_TAG).run();
    this.db.prepare(Q.DELETE_ALL_NG_UP).run();
  }
}
