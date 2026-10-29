import type { MyList, RssTypeValue } from '@shared/types';
import { NnddDatabase } from '../Database';
import { Q } from '../schema';

interface MyListRow {
  id: number;
  url: string;
  name: string;
  type: string;
  isDir: number;
  unPlayCount: number;
  lastRenewed: number | null;
  icon: string | null;
  parentUrl: string | null;
}

/**
 * マイリスト永続化 DAO
 * 元: src/org/mineap/nndd/myList/MyListManager.as (XMLファイル管理だったが、DB化)
 *
 * マイリスト登録はニコニコのアカウントごとに持つ。account は AccountManager.key (未ログインは空文字)。
 * 非同期の処理 (スケジュール実行など) は、開始時点の account を控えて渡すこと。
 */
export class MyListDao {
  constructor(private readonly db: NnddDatabase) {}

  list(account: string): MyList[] {
    const rows = this.db.prepare(Q.SELECT_MYLISTS).all(account) as MyListRow[];
    return rows.map((r) => ({
      myListUrl: r.url,
      myListName: r.name,
      type: r.type as RssTypeValue,
      isDir: r.isDir === 1,
      unPlayVideoCount: r.unPlayCount,
      myListVideoIds: {},
      icon: r.icon,
      parentUrl: r.parentUrl
    }));
  }

  /** parentUrl が undefined なら既存の所属フォルダを維持する */
  upsert(account: string, myList: MyList): void {
    const parentUrl =
      myList.parentUrl !== undefined
        ? myList.parentUrl
        : ((this.db.prepare(Q.SELECT_MYLIST_PARENT).get(account, myList.myListUrl) as
            | { parentUrl: string | null }
            | undefined)?.parentUrl ?? null);
    this.db
      .prepare(Q.INSERT_MYLIST)
      .run(
        account,
        myList.myListUrl,
        myList.myListName,
        myList.type,
        myList.isDir ? 1 : 0,
        myList.unPlayVideoCount,
        Date.now() / 1000,
        myList.icon ?? null,
        parentUrl
      );
  }

  updateName(account: string, url: string, name: string): void {
    this.db.prepare(Q.UPDATE_MYLIST_NAME).run(name, account, url);
  }

  updateIcon(account: string, url: string, icon: string | null): void {
    this.db.prepare(Q.UPDATE_MYLIST_ICON).run(icon, account, url);
  }

  /** 削除。フォルダの場合、中身はルートへ移す */
  remove(account: string, url: string): void {
    this.db.transaction(() => {
      this.db.prepare(Q.RELEASE_MYLIST_CHILDREN).run(account, url);
      this.db.prepare(Q.DELETE_MYLIST).run(account, url);
    });
  }

  /** 所属フォルダを変更 (null でルート) */
  move(account: string, url: string, parentUrl: string | null): void {
    this.db.prepare(Q.UPDATE_MYLIST_PARENT).run(parentUrl, account, url);
  }

  /** そのアカウントの全マイリスト登録を削除 */
  clearAll(account: string): void {
    this.db.prepare(Q.DELETE_ALL_MYLIST).run(account);
  }
}
