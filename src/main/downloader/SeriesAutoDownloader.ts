import type { NNDDREVideo } from '@shared/types';
import { LibraryManager } from '../db/LibraryManager';
import { DownloadManager } from './DownloadManager';
import { SeriesClient } from '../nicovideo/series/SeriesClient';
import { createLogger } from '../util/Logger';

const log = createLogger('SeriesAutoDL');

/**
 * シリーズ自動ダウンロード。
 * MyListAutoDownloader と同じ方針で、指定シリーズの全動画のうち
 * ライブラリ未登録のものを DL キューに追加する。
 */
export class SeriesAutoDownloader {
  constructor(
    private readonly library: LibraryManager,
    private readonly downloader: DownloadManager
  ) {}

  /**
   * 指定シリーズを更新し、新規動画があれば DL キューに追加する。
   * @param seriesId シリーズID (数字文字列またはURL)
   * @param saveDir DL完了後の保存先サブディレクトリ (省略時はデフォルト)
   */
  async renew(
    seriesId: string,
    saveDir?: string
  ): Promise<{ fetched: number; queued: number }> {
    const { items, name } = await SeriesClient.fetchAllVideos(seriesId);
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

    log.info(`series renew: ${name} fetched=${items.length} queued=${queued}`);
    return { fetched: items.length, queued };
  }

  private extractVideoId(uri: string): string | null {
    const m = uri.match(/\[((?:sm|nm|so|ax|sd|ca|cd|cw|zb|ze|yo)\d+)\]/);
    return m ? m[1] : null;
  }
}
