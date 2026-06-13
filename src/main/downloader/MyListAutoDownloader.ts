import type { MyList, MyListItem, NNDDREVideo } from '@shared/types';
import { LibraryManager } from '../db/LibraryManager';
import { DownloadManager } from './DownloadManager';
import { MyListClient } from '../nicovideo/mylist/MyListClient';
import { createLogger } from '../util/Logger';

const log = createLogger('MyListAutoDL');

/**
 * マイリスト自動ダウンロード。
 * 元: src/org/mineap/nndd/myList/MyListRenewScheduler.as
 *     + RenewDownloadManager.as
 *
 *  - 指定マイリストの動画一覧を取得
 *  - ライブラリにまだ存在しない動画を抽出
 *  - DownloadManager にエンキュー
 */
export class MyListAutoDownloader {
  constructor(
    private readonly library: LibraryManager,
    private readonly downloader: DownloadManager
  ) {}

  /**
   * 1つのマイリストを更新し、新規動画があれば DL キューに追加する。
   * @returns { fetched: 取得した動画数, queued: DLキューに追加した数 }
   */
  async renew(myList: MyList): Promise<{ fetched: number; queued: number }> {
    const id = this.extractMylistId(myList.myListUrl);
    if (!id) throw new Error(`invalid mylist url: ${myList.myListUrl}`);
    const items = await MyListClient.fetchPublicMylist(id);
    let queued = 0;

    // ライブラリ内に既にある動画はスキップ
    const knownKeys = new Set(
      this.library.videoDao
        .list()
        .map((v: NNDDREVideo) => this.extractVideoId(v.uri))
        .filter(Boolean)
    );

    for (const item of items) {
      if (knownKeys.has(item.videoId)) continue;
      this.downloader.enqueue({ videoId: item.videoId });
      queued++;
    }

    // 未再生数を再計算 (ライブラリにあるが未再生のもの)
    this.library.myListDao.upsert({
      ...myList,
      unPlayVideoCount: this.countUnplayed(items)
    });

    log.info(
      `mylist renew: ${myList.myListName} fetched=${items.length} queued=${queued}`
    );
    return { fetched: items.length, queued };
  }

  /**
   * 全マイリストを順次更新。
   */
  async renewAll(): Promise<
    Record<string, { fetched: number; queued: number; error?: string }>
  > {
    const out: Record<
      string,
      { fetched: number; queued: number; error?: string }
    > = {};
    const mylists = this.library.myListDao.list();
    for (const ml of mylists) {
      try {
        const r = await this.renew(ml);
        out[ml.myListUrl] = r;
      } catch (e) {
        log.warn(`renew failed: ${ml.myListUrl}`, e);
        out[ml.myListUrl] = {
          fetched: 0,
          queued: 0,
          error: e instanceof Error ? e.message : String(e)
        };
      }
    }
    return out;
  }

  private extractMylistId(url: string): string | null {
    const m = url.match(/(?:mylist\/|^)(\d+)/);
    return m ? m[1] : null;
  }

  private extractVideoId(uri: string): string | null {
    const m = uri.match(/\[((?:sm|nm|so|ax|sd|ca|cd|cw|zb|ze|yo)\d+)\]/);
    return m ? m[1] : null;
  }

  private countUnplayed(items: MyListItem[]): number {
    // この時点では実際の再生状況は分からないため、ライブラリ未登録のものを未再生とみなす
    const knownKeys = new Set(
      this.library.videoDao
        .list()
        .map((v: NNDDREVideo) => this.extractVideoId(v.uri))
        .filter(Boolean)
    );
    return items.filter((it) => !knownKeys.has(it.videoId)).length;
  }
}
