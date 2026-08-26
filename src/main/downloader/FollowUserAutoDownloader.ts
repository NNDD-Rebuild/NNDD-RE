import type { NNDDREVideo } from '@shared/types';
import { LibraryManager } from '../db/LibraryManager';
import { DownloadManager } from './DownloadManager';
import { FollowFeedClient, type FollowingUser } from '../nicovideo/follow/FollowFeedClient';
import { createLogger } from '../util/Logger';

const log = createLogger('FollowUserAutoDL');

/**
 * フォロー中投稿者の新着自動ダウンロード。
 * 指定ユーザーIDの最新投稿一覧を取得し、ライブラリ未登録のものを DL キューに追加する。
 */
export class FollowUserAutoDownloader {
  constructor(
    private readonly library: LibraryManager,
    private readonly downloader: DownloadManager
  ) {}

  /**
   * @param userId ニコニコユーザーID
   * @param limit 取得件数 (新着上位N件を確認)
   * @param saveDir DL完了後の保存先サブディレクトリ (省略時はデフォルト)
   */
  async renew(
    userId: string,
    limit = 20,
    saveDir?: string
  ): Promise<{ fetched: number; queued: number }> {
    const user: FollowingUser = { id: userId, nickname: userId, iconUrl: '' };
    const { items } = await FollowFeedClient.fetchFeed(limit, undefined, user, 1);
    let queued = 0;

    const knownKeys = new Set(
      this.library.videoDao
        .list()
        .map((v: NNDDREVideo) => this.extractVideoId(v.uri))
        .filter(Boolean)
    );

    for (const item of items) {
      if (knownKeys.has(item.videoId)) continue;
      this.downloader.enqueue({ videoId: item.videoId, saveDir });
      queued++;
    }

    log.info(`follow user renew: ${userId} fetched=${items.length} queued=${queued}`);
    return { fetched: items.length, queued };
  }

  private extractVideoId(uri: string): string | null {
    const m = uri.match(/\[((?:sm|nm|so|ax|sd|ca|cd|cw|zb|ze|yo)\d+)\]/);
    return m ? m[1] : null;
  }
}
