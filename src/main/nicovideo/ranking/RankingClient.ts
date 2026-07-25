import type { RankingItem, RankingTermValue, RankingFetchResult, RankingGenreInfo } from '@shared/types';
import { NicoApi } from '@shared/constants';
import { NicoContext } from '../NicoContext';
import { XMLParser } from 'fast-xml-parser';
import { createLogger } from '../../util/Logger';
import { ImageCache } from '../../util/ImageCache';

const log = createLogger('RankingClient');

/**
 * ランキング取得 (BFF版)。
 *
 * ニコニコ動画本体(www.nicovideo.jp)のランキングページが内部で使う
 * BFF(SSRデータローダー)を `?responseType=json` 付きで直接叩く。
 * 1リクエストでランキング本体・ジャンル一覧・タグ(サブカテゴリ)一覧が
 * まとめて返る。nvapi専用ジャンルAPI(旧英語スラッグ, entertainment等)は
 * 現行フロントから非参照となり、ジャンル構成も新23ジャンル体系に変わっている
 * ため、ジャンルIDは新体系の featuredKey (英数字8桁の opaque ID) を使う。
 *
 * URL例:
 *   https://www.nicovideo.jp/ranking/genre/{featuredKey}?term={term}&tag={tag}&responseType=json
 */
interface BffRankingItem {
  id: string;
  title: string;
  registeredAt?: string;
  duration?: number;
  thumbnail?: { url?: string; middleUrl?: string; largeUrl?: string };
  count?: { view?: number; comment?: number; mylist?: number; like?: number };
  shortDescription?: string;
  owner?: { name?: string; ownerType?: string };
  isChannelVideo?: boolean;
  requireSensitiveMasking?: boolean;
}

interface BffFeaturedKeyItem {
  featuredKey: string;
  label: string;
  isEnabledTrendTag?: boolean;
  isTopLevel?: boolean;
  isImmoral?: boolean;
  isEnabled?: boolean;
}

interface BffRankingResponse {
  data?: {
    response?: {
      $getTeibanRanking?: {
        data?: {
          items?: BffRankingItem[];
          hasNext?: boolean;
        };
      };
      $getTeibanRankingFeaturedKeyAndTrendTags?: {
        data?: {
          trendTags?: string[];
        };
      };
      $getTeibanRankingFeaturedKeys?: {
        data?: {
          items?: BffFeaturedKeyItem[];
        };
      };
    };
  };
}

export class RankingClient {
  static async fetch(
    featuredKey: string,
    term: RankingTermValue,
    tag?: string,
    hideSensitiveContents = true
  ): Promise<RankingFetchResult> {
    const params = new URLSearchParams({ term, responseType: 'json' });
    if (tag) params.set('tag', tag);
    const url = `https://www.nicovideo.jp/ranking/genre/${encodeURIComponent(featuredKey)}?${params.toString()}`;
    log.debug('fetch ranking (bff):', url);
    const res = await NicoContext.get().http.getJson<BffRankingResponse>(url);
    const rankingData = res?.data?.response?.$getTeibanRanking?.data;
    const rawItems = rankingData?.items ?? [];
    const visibleItems = hideSensitiveContents
      ? rawItems.filter((v) => v.requireSensitiveMasking !== true)
      : rawItems;

    const items: RankingItem[] = visibleItems.map((v, idx) => ({
      rank: idx + 1,
      videoId: v.id,
      title: v.title,
      description: v.shortDescription ?? '',
      thumbnailUrl: v.thumbnail?.middleUrl ?? v.thumbnail?.url ?? '',
      length: Number(v.duration ?? 0),
      viewCount: Number(v.count?.view ?? 0),
      commentCount: Number(v.count?.comment ?? 0),
      mylistCount: Number(v.count?.mylist ?? 0),
      likeCount: Number(v.count?.like ?? 0),
      registeredAt: v.registeredAt ? new Date(v.registeredAt) : new Date(),
      isChannelVideo: v.isChannelVideo === true || v.owner?.ownerType === 'channel'
    }));

    const trendTags = res?.data?.response?.$getTeibanRankingFeaturedKeyAndTrendTags?.data?.trendTags ?? [];
    const hasNext = rankingData?.hasNext ?? false;

    return { items: this.applyCachedThumbs(items), trendTags, hasNext };
  }

  /**
   * ジャンル(featuredKey)一覧を取得する。
   * 任意のジャンルページのBFFレスポンスに全ジャンル一覧が含まれるため、
   * 総合ランキング(featuredKey=e9uj2uks)のページを流用して取得する。
   */
  static async fetchGenres(): Promise<RankingGenreInfo[]> {
    const url = 'https://www.nicovideo.jp/ranking/genre/e9uj2uks?responseType=json';
    log.debug('fetch ranking genres (bff):', url);
    const res = await NicoContext.get().http.getJson<BffRankingResponse>(url);
    const items = res?.data?.response?.$getTeibanRankingFeaturedKeys?.data?.items ?? [];
    return items
      .filter((g) => g.isEnabled !== false)
      .map((g) => ({
        id: g.featuredKey,
        name: g.label,
        hasTags: g.isEnabledTrendTag === true
      }));
  }

  private static applyCachedThumbs(items: RankingItem[]): RankingItem[] {
    if (!ImageCache.isEnabled()) return items;
    const http = NicoContext.get().http;
    const urls = ImageCache.cacheUrlList(items.map(i => i.thumbnailUrl), http);
    return items.map((item, idx) => ({ ...item, thumbnailUrl: urls[idx] }));
  }

  static async fetchHot(genre: string): Promise<RankingItem[]> {
    let items: RankingItem[];
    try {
      const url = `https://nvapi.nicovideo.jp/v1/ranking/hot-topic?genre=${encodeURIComponent(genre)}&pageSize=100`;
      const res = await NicoContext.get().http.getJson<{ data?: { items?: BffRankingItem[] } }>(url);
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
        registeredAt: v.registeredAt ? new Date(v.registeredAt) : new Date(),
        isChannelVideo: v.isChannelVideo === true || v.owner?.ownerType === 'channel'
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
