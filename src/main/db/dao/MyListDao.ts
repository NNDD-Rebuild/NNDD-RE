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
 */
export class MyListDao {
  constructor(private readonly db: NnddDatabase) {}

  list(): MyList[] {
    const rows = this.db.prepare(Q.SELECT_MYLISTS).all() as MyListRow[];
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
  upsert(myList: MyList): void {
    const parentUrl =
      myList.parentUrl !== undefined
        ? myList.parentUrl
        : ((this.db.prepare('SELECT parentUrl FROM mylist WHERE url = ?').get(myList.myListUrl) as
            | { parentUrl: string | null }
            | undefined)?.parentUrl ?? null);
    this.db
      .prepare(Q.INSERT_MYLIST)
      .run(
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

  updateName(url: string, name: string): void {
    this.db.prepare('UPDATE mylist SET name = ? WHERE url = ?').run(name, url);
  }

  updateIcon(url: string, icon: string | null): void {
    this.db.prepare(Q.UPDATE_MYLIST_ICON).run(icon, url);
  }

  /** 削除。フォルダの場合、中身はルートへ移す */
  remove(url: string): void {
    this.db.transaction(() => {
      this.db.prepare(Q.RELEASE_MYLIST_CHILDREN).run(url);
      this.db.prepare(Q.DELETE_MYLIST).run(url);
    });
  }

  /** 所属フォルダを変更 (null でルート) */
  move(url: string, parentUrl: string | null): void {
    this.db.prepare(Q.UPDATE_MYLIST_PARENT).run(parentUrl, url);
  }

  /** 全マイリスト登録を削除 */
  clearAll(): void {
    this.db.prepare(Q.DELETE_ALL_MYLIST).run();
  }
}
