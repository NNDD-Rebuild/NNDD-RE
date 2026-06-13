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
      myListVideoIds: {}
    }));
  }

  upsert(myList: MyList): void {
    this.db
      .prepare(Q.INSERT_MYLIST)
      .run(
        myList.myListUrl,
        myList.myListName,
        myList.type,
        myList.isDir ? 1 : 0,
        myList.unPlayVideoCount,
        Date.now() / 1000
      );
  }

  remove(url: string): void {
    this.db.prepare(Q.DELETE_MYLIST).run(url);
  }
}
