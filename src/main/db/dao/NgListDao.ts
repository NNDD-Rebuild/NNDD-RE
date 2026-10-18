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

  /** 追加できたら true。既に登録済み (INSERT OR IGNORE で無視された) なら false */
  addComment(item: NgListItem): boolean {
    return this.db.prepare(Q.INSERT_NG_LIST).run(item.type, item.value).changes > 0;
  }

  removeComment(item: NgListItem): void {
    this.db.prepare(Q.DELETE_NG_LIST).run(item.type, item.value);
  }

  /** サーバー側NGと前回同期した時点の一覧 (アカウントごと)。未同期なら空配列 */
  getSyncBase(account: string): NgListItem[] {
    const rows = this.db.prepare(Q.SELECT_NG_SYNC_BASE).all(account) as { type: string; value: string }[];
    return rows.map((r) => ({ type: r.type as NgListItemTypeValue, value: r.value }));
  }

  /** 同期基準を丸ごと置き換える */
  setSyncBase(account: string, items: NgListItem[]): void {
    this.db.transaction(() => {
      this.db.prepare(Q.DELETE_NG_SYNC_BASE_BY_ACCOUNT).run(account);
      const insert = this.db.prepare(Q.INSERT_NG_SYNC_BASE);
      for (const item of items) insert.run(account, item.type, item.value);
    });
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
    // 全消去は「削除」ではなく入れ替え (インポート・復元) の可能性が高い。基準も消して次回同期を初回扱いにし、
    // サーバー側の NG を巻き込んで消さないようにする
    this.db.prepare(Q.DELETE_ALL_NG_SYNC_BASE).run();
  }
}
