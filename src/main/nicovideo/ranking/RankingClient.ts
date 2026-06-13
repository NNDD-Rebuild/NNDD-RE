import type { RankingItem, RankingTermValue } from '@shared/types';
import { NicoApi } from '@shared/constants';
import { NicoContext } from '../NicoContext';
import { XMLParser } from 'fast-xml-parser';
import { createLogger } from '../../util/Logger';
import { ImageCache } from '../../util/ImageCache';

const log = createLogger('RankingClient');

/**
 * ランキング取得 (RSS版)。
 *
 * ニコニコ動画のランキングRSSフィードを取得・パースする。
 * 元: src/org/mineap/nndd/ranking/RankingListBuilder.as
 *      / nicovideo4as/RankingLoader.as
 *
 * URL例:
 *   https://www.nicovideo.jp/ranking/genre/{genre}?term={term}&rss=2.0&lang=ja-jp
 *
 *  genre: "all" / "anime" / "game" / "vocaloid" / ...
 *  term:  "hour" / "24h" / "week" / "month" / "total"
 */
interface NvApiRankingResponse {
  data?: {
    items?: Array<{
      id: string;
      title: string;
      registeredAt?: string;
      duration?: number;
      thumbnail?: { url?: string; middleUrl?: string; largeUrl?: string };
      count?: { view?: number; comment?: number; mylist?: number; like?: number };
      shortDescription?: string;
      owner?: { name?: string };
    }>;
    hasNext?: boolean;
  };
}

export class RankingClient {
  static async fetch(
    genre: string,
    term: RankingTermValue
  ): Promise<RankingItem[]> {
    let items: RankingItem[];
    try {
      items = await this.fetchViaNvapi(genre, term);
    } catch (e) {
      log.warn('nvapi ranking failed, falling back to RSS:', e);
      const url = `${NicoApi.RANKING_RSS}genre/${encodeURIComponent(genre)}?term=${encodeURIComponent(term)}&rss=2.0&lang=ja-jp`;
      log.debug('fetch ranking (RSS fallback):', url);
      const xml = await NicoContext.get().http.getText(url);
      items = this.parseRss(xml);
    }
    return this.applyCachedThumbs(items);
  }

  private static applyCachedThumbs(items: RankingItem[]): RankingItem[] {
    if (!ImageCache.isEnabled()) return items;
    const http = NicoContext.get().http;
    const urls = ImageCache.cacheUrlList(items.map(i => i.thumbnailUrl), http);
    return items.map((item, idx) => ({ ...item, thumbnailUrl: urls[idx] }));
  }

  private static async fetchViaNvapi(
    genre: string,
    term: RankingTermValue
  ): Promise<RankingItem[]> {
    const url = `https://nvapi.nicovideo.jp/v1/ranking/genre/${encodeURIComponent(genre)}?term=${encodeURIComponent(term)}&pageSize=100&page=1`;
    log.debug('fetch ranking (nvapi):', url);
    const res = await NicoContext.get().http.getJson<NvApiRankingResponse>(url);
    const items = res?.data?.items ?? [];
    return items.map((v, idx) => ({
      rank: idx + 1,
      videoId: v.id,
      title: v.title,
      description: v.shortDescription ?? '',
      thumbnailUrl:
        v.thumbnail?.middleUrl ?? v.thumbnail?.url ?? '',
      length: Number(v.duration ?? 0),
      viewCount: Number(v.count?.view ?? 0),
      commentCount: Number(v.count?.comment ?? 0),
      mylistCount: Number(v.count?.mylist ?? 0),
      likeCount: Number(v.count?.like ?? 0),
      registeredAt: v.registeredAt ? new Date(v.registeredAt) : new Date()
    }));
  }

  static async fetchHot(genre: string): Promise<RankingItem[]> {
    let items: RankingItem[];
    try {
      const url = `https://nvapi.nicovideo.jp/v1/ranking/hot-topic?genre=${encodeURIComponent(genre)}&pageSize=100`;
      const res = await NicoContext.get().http.getJson<NvApiRankingResponse>(url);
      items = (res?.data?.items ?? []).map((v, idx) => ({
        rank: idx + 1,
        videoId: v.id,
        title: v.title,
        description: v.shortDescription ?? '',
        thumbnailUrl:
          v.thumbnail?.middleUrl ?? v.thumbnail?.url ?? '',
        length: Number(v.duration ?? 0),
        viewCount: Number(v.count?.view ?? 0),
        commentCount: Number(v.count?.comment ?? 0),
        mylistCount: Number(v.count?.mylist ?? 0),
        likeCount: Number(v.count?.like ?? 0),
        registeredAt: v.registeredAt ? new Date(v.registeredAt) : new Date()
      }));
    } catch (e) {
      log.warn('nvapi hot-topic failed, falling back to RSS:', e);
      const url = `${NicoApi.RANKING_RSS}hot-topic?genre=${encodeURIComponent(genre)}&rss=2.0&lang=ja-jp`;
      const xml = await NicoContext.get().http.getText(url);
      items = this.parseRss(xml);
    }
    return this.applyCachedThumbs(items);
  }

  private static parseRss(xml: string): RankingItem[] {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      cdataPropName: '__cdata',
      processEntities: false
    });
    const doc = parser.parse(xml);
    const items = doc?.rss?.channel?.item ?? [];
    const itemsArr = Array.isArray(items) ? items : [items];

    const out: RankingItem[] = [];
    itemsArr.forEach((item: Record<string, unknown>, idx: number) => {
      const title = String(item['title'] ?? '');
      const link = String(item['link'] ?? '');
      const pubDate = String(item['pubDate'] ?? '');
      const description = String(item['description'] ?? '');

      const videoId = this.extractVideoId(link);
      if (!videoId) return;

      // description は HTML 内に再生数等が埋め込まれている (旧版互換)
      // 例: <p class="nico-info-total-view"><strong>1,234</strong></p>
      const stats = this.parseStats(description);
      const titleClean = title.replace(/^第\d+位[：:]\s*/, '');

      out.push({
        rank: idx + 1,
        videoId,
        title: titleClean,
        description: stats.description,
        thumbnailUrl: stats.thumb,
        length: stats.length,
        viewCount: stats.view,
        commentCount: stats.comment,
        mylistCount: stats.mylist,
        likeCount: stats.like,
        registeredAt: pubDate ? new Date(pubDate) : new Date()
      });
    });

    return out;
  }

  private static extractVideoId(link: string): string | null {
    const m = link.match(/\/watch\/((?:sm|nm|so|ax|sd|ca|cd|cw|zb|ze|yo)\d+)/);
    return m ? m[1] : null;
  }

  private static parseStats(html: string): {
    description: string;
    thumb: string;
    length: number;
    view: number;
    comment: number;
    mylist: number;
    like: number;
  } {
    const thumbMatch = html.match(/<img[^>]*src=["']([^"']+)["']/);
    const lengthMatch = html.match(/(\d{1,2}:)?(\d{1,2}):(\d{2})/);
    const viewMatch = html.match(/nico-info-total-view[^<]*<strong>([\d,]+)/);
    const commentMatch = html.match(
      /nico-info-total-res[^<]*<strong>([\d,]+)/
    );
    const mylistMatch = html.match(
      /nico-info-total-mylist[^<]*<strong>([\d,]+)/
    );
    const likeMatch = html.match(/nico-info-total-like[^<]*<strong>([\d,]+)/);
    const descMatch = html.match(/nico-description[^>]*>([\s\S]*?)<\//);

    let length = 0;
    if (lengthMatch) {
      const h = lengthMatch[1] ? parseInt(lengthMatch[1], 10) : 0;
      const m = parseInt(lengthMatch[2], 10);
      const s = parseInt(lengthMatch[3], 10);
      length = h * 3600 + m * 60 + s;
    }

    return {
      description: descMatch
        ? descMatch[1].replace(/<[^>]+>/g, '').trim()
        : '',
      thumb: thumbMatch?.[1] ?? '',
      length,
      view: viewMatch ? parseInt(viewMatch[1].replace(/,/g, ''), 10) : 0,
      comment: commentMatch
        ? parseInt(commentMatch[1].replace(/,/g, ''), 10)
        : 0,
      mylist: mylistMatch ? parseInt(mylistMatch[1].replace(/,/g, ''), 10) : 0,
      like: likeMatch ? parseInt(likeMatch[1].replace(/,/g, ''), 10) : 0
    };
  }
}
