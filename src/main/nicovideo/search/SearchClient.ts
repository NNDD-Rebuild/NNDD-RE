import type {
  SearchResultItem,
  NNDDRESearchTypeValue,
  NNDDRESearchSortTypeValue
} from '@shared/types';
import { NNDDRESearchType } from '@shared/types';
import { NicoApi } from '@shared/constants';
import { NicoContext } from '../NicoContext';
import { ThumbInfoXmlReader } from '../video/ThumbInfoXmlReader';
import { createLogger } from '../../util/Logger';
import { ImageCache } from '../../util/ImageCache';

const log = createLogger('SearchClient');

interface SnapshotV2Response {
  meta: { status: number; totalCount: number; id: string };
  data: SnapshotV2Item[];
}

interface SnapshotV2Item {
  contentId: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  lengthSeconds: number;
  viewCounter: number;
  commentCounter: number;
  mylistCounter: number;
  likeCounter: number;
  startTime: string;
  tags: string;
  channelId?: number | string | null;
  userId?: number | string | null;
}

interface NvapiSearchResponse {
  meta: { status: number };
  data: {
    totalCount: number;
    items: NvapiSearchItem[];
  };
}

interface NvapiSearchItem {
  id: string;
  title: string;
  shortDescription?: string;
  thumbnail: { url: string; middleUrl?: string };
  duration: number;
  registeredAt: string;
  count: { view: number; comment: number; mylist: number; like: number };
  isChannelVideo?: boolean;
  owner?: {
    ownerType?: 'user' | 'channel' | string;
    id: string;
    name: string;
    iconUrl: string;
  } | null;
}

export type SearchApiMode = 'snapshot' | 'nvapi';

export interface SearchOptions {
  word: string;
  type: NNDDRESearchTypeValue;
  sortType: NNDDRESearchSortTypeValue;
  offset?: number;
  limit?: number;
}

/**
 * ニコニコ動画検索クライアント。
 *
 * 設定 `searchApi` により2つのAPIを切り替える。
 *   - 'snapshot': スナップショット検索API v2 (日次更新、タグ完全一致検索に対応)
 *     エンドポイント: https://snapshot.search.nicovideo.jp/api/v2/snapshot/video/contents/search
 *     元: Niconicome の Remote/V2/Search/Search.cs / SearchUrlConstructor.cs
 *   - 'nvapi': https://nvapi.nicovideo.jp/v2/search/video (ほぼリアルタイム、タグ情報を含まない)
 */
export class SearchClient {
  static async search(
    opts: SearchOptions,
    apiMode: SearchApiMode = 'snapshot'
  ): Promise<{
    items: SearchResultItem[];
    totalCount: number;
  }> {
    const trimmed = opts.word.trim();
    if (/^(sm|nm|so)\d+$/i.test(trimmed)) {
      const item = await this.fetchByVideoId(trimmed.toLowerCase());
      if (item) return { items: [item], totalCount: 1 };
    }
    if (apiMode === 'nvapi') return this.searchNvapi(opts);
    const url = this.buildUrl(opts);
    log.debug('search:', url);
    const res = await NicoContext.get().http.getJson<SnapshotV2Response>(url);
    const items = (res.data ?? []).map(this.toItem);
    return {
      items: this.applyCachedThumbs(items),
      totalCount: res.meta?.totalCount ?? 0
    };
  }

  private static async searchNvapi(opts: SearchOptions): Promise<{
    items: SearchResultItem[];
    totalCount: number;
  }> {
    const url = this.buildNvapiUrl(opts);
    log.debug('searchNvapi:', url);
    const res = await NicoContext.get().http.getJson<NvapiSearchResponse>(url);
    const items = (res.data?.items ?? []).map(this.toItemFromNvapi);
    return {
      items: this.applyCachedThumbs(items),
      totalCount: res.data?.totalCount ?? 0
    };
  }

  private static applyCachedThumbs(items: SearchResultItem[]): SearchResultItem[] {
    if (!ImageCache.isEnabled()) return items;
    const http = NicoContext.get().http;
    const urls = ImageCache.cacheUrlList(items.map(i => i.thumbnailUrl), http);
    return items.map((item, idx) => ({ ...item, thumbnailUrl: urls[idx] }));
  }

  private static async fetchByVideoId(videoId: string): Promise<SearchResultItem | null> {
    try {
      const xml = await NicoContext.get().http.getText(`${NicoApi.THUMB_INFO}${videoId}`);
      const parsed = ThumbInfoXmlReader.parse(xml);
      if (!parsed) return null;
      const http = NicoContext.get().http;
      const [thumbUrl, iconUrl] = ImageCache.cacheUrlList(
        [parsed.thumbnailUrl, parsed.ownerIconUrl ?? ''],
        http
      );
      return {
        videoId: parsed.videoId,
        title: parsed.title,
        description: parsed.description,
        thumbnailUrl: thumbUrl,
        length: parsed.length,
        viewCount: parsed.viewCount,
        commentCount: parsed.commentCount,
        mylistCount: parsed.mylistCount,
        likeCount: 0,
        registeredAt: new Date(parsed.registeredAt),
        tags: parsed.tags,
        author: parsed.ownerId
          ? { id: parsed.ownerId, nickname: parsed.ownerNickname, iconUrl }
          : undefined,
        isChannelVideo: !!parsed.chId
      };
    } catch (e) {
      log.warn('fetchByVideoId failed:', videoId, e);
      return null;
    }
  }

  private static buildUrl(opts: SearchOptions): string {
    const params = new URLSearchParams();
    params.set('q', opts.word);
    params.set(
      'targets',
      opts.type === NNDDRESearchType.TAG ? 'tagsExact' : 'title,description,tags'
    );
    params.set(
      'fields',
      'contentId,title,description,thumbnailUrl,lengthSeconds,viewCounter,commentCounter,mylistCounter,likeCounter,startTime,tags,channelId,userId'
    );
    const [sortKey, sortDir] = this.toSortParam(opts.sortType);
    params.set('_sort', `${sortDir === 'asc' ? '+' : '-'}${sortKey}`);
    params.set('_offset', String(opts.offset ?? 0));
    params.set('_limit', String(opts.limit ?? 32));
    params.set('_context', 'nndd-electron');
    return `${NicoApi.SEARCH_API}?${params.toString()}`;
  }

  private static toSortParam(
    sort: NNDDRESearchSortTypeValue
  ): [string, 'asc' | 'desc'] {
    switch (sort) {
      case 'registeredAt_desc':
        return ['startTime', 'desc'];
      case 'registeredAt_asc':
        return ['startTime', 'asc'];
      case 'viewCount_desc':
        return ['viewCounter', 'desc'];
      case 'viewCount_asc':
        return ['viewCounter', 'asc'];
      case 'commentCount_desc':
        return ['commentCounter', 'desc'];
      case 'commentCount_asc':
        return ['commentCounter', 'asc'];
      case 'mylistCount_desc':
        return ['mylistCounter', 'desc'];
      case 'mylistCount_asc':
        return ['mylistCounter', 'asc'];
      case 'likeCount_desc':
        return ['likeCounter', 'desc'];
      case 'length_asc':
        return ['lengthSeconds', 'asc'];
      case 'length_desc':
        return ['lengthSeconds', 'desc'];
      default:
        return ['startTime', 'desc'];
    }
  }

  private static buildNvapiUrl(opts: SearchOptions): string {
    const params = new URLSearchParams();
    if (opts.type === NNDDRESearchType.TAG) {
      params.set('tag', opts.word);
    } else {
      params.set('keyword', opts.word);
    }
    const [sortKey, sortOrder] = this.toNvapiSortParam(opts.sortType);
    params.set('sortKey', sortKey);
    params.set('sortOrder', sortOrder);
    params.set('page', String(Math.floor((opts.offset ?? 0) / (opts.limit ?? 32)) + 1));
    params.set('pageSize', String(Math.min(opts.limit ?? 32, 100)));
    return `${NicoApi.SEARCH_API_NVAPI}?${params.toString()}`;
  }

  private static toNvapiSortParam(
    sort: NNDDRESearchSortTypeValue
  ): [string, 'asc' | 'desc'] {
    switch (sort) {
      case 'registeredAt_desc':
        return ['registeredAt', 'desc'];
      case 'registeredAt_asc':
        return ['registeredAt', 'asc'];
      case 'viewCount_desc':
        return ['viewCount', 'desc'];
      case 'viewCount_asc':
        return ['viewCount', 'asc'];
      case 'commentCount_desc':
        return ['commentCount', 'desc'];
      case 'commentCount_asc':
        return ['commentCount', 'asc'];
      case 'mylistCount_desc':
        return ['mylistCount', 'desc'];
      case 'mylistCount_asc':
        return ['mylistCount', 'asc'];
      case 'likeCount_desc':
        return ['likeCount', 'desc'];
      case 'length_asc':
        return ['duration', 'asc'];
      case 'length_desc':
        return ['duration', 'desc'];
      default:
        return ['registeredAt', 'desc'];
    }
  }

  private static toItemFromNvapi(d: NvapiSearchItem): SearchResultItem {
    const isChannelVideo = !!d.isChannelVideo || d.owner?.ownerType === 'channel';
    return {
      videoId: d.id,
      title: d.title,
      description: d.shortDescription ?? '',
      thumbnailUrl: d.thumbnail?.middleUrl ?? d.thumbnail?.url ?? '',
      length: d.duration,
      viewCount: d.count?.view ?? 0,
      commentCount: d.count?.comment ?? 0,
      mylistCount: d.count?.mylist ?? 0,
      likeCount: d.count?.like ?? 0,
      registeredAt: new Date(d.registeredAt),
      // nvapiの検索結果にはタグ情報が含まれない (タグ表示・タグクリック検索は非対応)
      tags: [],
      author: d.owner
        ? { id: d.owner.id, nickname: d.owner.name, iconUrl: d.owner.iconUrl }
        : undefined,
      isChannelVideo
    };
  }

  private static toItem(d: SnapshotV2Item): SearchResultItem {
    const isChannelVideo = d.channelId !== null && d.channelId !== undefined;
    return {
      videoId: d.contentId,
      title: d.title,
      description: d.description ?? '',
      thumbnailUrl: d.thumbnailUrl,
      length: d.lengthSeconds,
      viewCount: d.viewCounter,
      commentCount: d.commentCounter,
      mylistCount: d.mylistCounter,
      likeCount: d.likeCounter,
      registeredAt: new Date(d.startTime),
      tags: (d.tags ?? '').split(/\s+/).filter(Boolean),
      author: isChannelVideo
        ? { id: `ch${d.channelId}`, nickname: '', iconUrl: `https://secure-dcdn.cdn.nimg.jp/comch/channel-icon/128x128/ch${d.channelId}.jpg` }
        : d.userId != null
        ? { id: String(d.userId), nickname: '', iconUrl: '' }
        : undefined,
      isChannelVideo
    };
  }
}
