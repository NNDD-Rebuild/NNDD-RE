import type { MyListItem } from '@shared/types';
import { NicoContext } from '../NicoContext';
import { createLogger } from '../../util/Logger';
import { ImageCache } from '../../util/ImageCache';

const log = createLogger('ChannelClient');

/**
 * チャンネル動画一覧クライアント。
 * 専用JSON APIが存在しないため ch.nicovideo.jp の動画一覧ページをスクレイピングする。
 * ニコニコ側のHTML構造変更で壊れる可能性がある。
 */
export class ChannelClient {
  static async fetchChannelVideos(
    channelId: string,
    page = 1,
    cacheImages = true
  ): Promise<{ items: MyListItem[]; total: number; name?: string }> {
    const url = `https://ch.nicovideo.jp/${encodeURIComponent(channelId)}/video?sort=f&order=d&page=${page}`;
    log.debug('fetch channel videos:', url);
    const res = await NicoContext.get().http.fetch(url, { timeoutMs: 10000 });
    if (!res.ok) {
      throw new Error(`チャンネル動画の取得に失敗: status=${res.status}`);
    }
    const html = await res.text();

    const totalMatch = html.match(/<var>([\d,]+)<\/var>\s*件/);
    const total = totalMatch ? Number(totalMatch[1].replace(/,/g, '')) : 0;

    const nameMatch = html.match(/<meta property="og:site_name" content="([^"]*)"/);
    const name = nameMatch ? nameMatch[1].trim() : undefined;

    const items: MyListItem[] = [];
    const entryRegex = /<a[^>]+class="[^"]*watchLink[^"]*"[^>]+href="https:\/\/www\.nicovideo\.jp\/watch\/([a-z]{2}\d+)"[^>]*>([\s\S]*?)<\/a>/g;
    let m: RegExpExecArray | null;
    while ((m = entryRegex.exec(html)) !== null) {
      const videoId = m[1];
      const block = m[2];
      const titleBlockMatch = block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/);
      const title = titleBlockMatch
        ? titleBlockMatch[1].replace(/<[^>]+>/g, '').trim()
        : videoId;
      const thumbMatch = block.match(/<img[^>]+src="([^"]+)"/);
      items.push({
        videoId,
        title,
        description: '',
        thumbnailUrl: thumbMatch?.[1] ?? '',
        length: '',
        pubDate: new Date(0),
        viewCount: 0,
        commentCount: 0,
        mylistCount: 0
      });
    }

    let mapped = items;
    if (cacheImages && ImageCache.isEnabled()) {
      const http = NicoContext.get().http;
      const urls = ImageCache.cacheUrlList(mapped.map(i => i.thumbnailUrl), http);
      mapped = mapped.map((i, idx) => ({ ...i, thumbnailUrl: urls[idx] }));
    }
    log.debug(`channel ${channelId} page=${page} items=${mapped.length} total=${total}`);
    return { items: mapped, total, name };
  }
}
