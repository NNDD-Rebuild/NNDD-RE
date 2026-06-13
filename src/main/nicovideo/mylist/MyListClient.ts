import type { MyListItem, MyList } from '@shared/types';
import { RssType } from '@shared/types';
import { NicoApi } from '@shared/constants';
import { NicoContext } from '../NicoContext';
import { createLogger } from '../../util/Logger';
import { ImageCache } from '../../util/ImageCache';

const log = createLogger('MyListClient');

interface NvApiMylistResponse {
  meta?: { status?: number; errorCode?: string };
  data?: {
    mylist?: {
      id: string;
      name: string;
      description?: string;
      items?: NvApiMylistItem[];
      totalItemCount?: number;
    };
    // 一部レスポンスは items を data 直下に持つ
    items?: NvApiMylistItem[];
  };
}

interface NvApiMylistItem {
  watchId: string;
  itemId: number;
  description?: string;
  video: {
    id: string;
    title: string;
    duration: number;
    thumbnail: { url: string };
    count: { view: number; comment: number; mylist: number; like?: number };
    registeredAt: string;
  };
}

/**
 * マイリスト API クライアント (V2)。
 *
 * 公開マイリスト: GET https://nvapi.nicovideo.jp/v2/mylists/{id}?pageSize=N
 * 自分のマイリスト: GET https://nvapi.nicovideo.jp/v1/users/me/mylists
 *
 * 元: Niconicome の Remote/V2/Mylist/MylistHandler.cs
 */
export class MyListClient {
  static async fetchPublicMylist(
    mylistId: string,
    page = 1,
    pageSize = 100
  ): Promise<{ items: MyListItem[]; total: number }> {
    // 自分のマイリスト (非公開含む) を取得できる /v1/users/me/mylists/{id} を最初に試す。
    // 401 / 403 / 404 が返ったら公開マイリスト /v2/mylists/{id} にフォールバック。
    const ctx = NicoContext.get();
    const loggedIn = await ctx.isLoggedIn();
    const candidates = loggedIn
      ? [
          `https://nvapi.nicovideo.jp/v1/users/me/mylists/${encodeURIComponent(mylistId)}?pageSize=${pageSize}&page=${page}`,
          `${NicoApi.PUBLIC_MYLIST_API}${encodeURIComponent(mylistId)}?pageSize=${pageSize}&page=${page}`
        ]
      : [
          `${NicoApi.PUBLIC_MYLIST_API}${encodeURIComponent(mylistId)}?pageSize=${pageSize}&page=${page}`
        ];

    let res: NvApiMylistResponse | null = null;
    let lastError: unknown = null;
    for (const url of candidates) {
      log.debug('fetch mylist:', url);
      try {
        res = await ctx.http.getJson<NvApiMylistResponse>(url);
        const status = res.meta?.status;
        if (status && status >= 400) {
          log.warn(`mylist fetch returned status=${status} errorCode=${res.meta?.errorCode}, trying fallback`);
          res = null;
          continue;
        }
        break;
      } catch (e) {
        lastError = e;
        log.warn(`mylist fetch HTTP error for ${url}:`, e);
      }
    }
    if (!res) {
      throw new Error(
        `マイリスト ${mylistId} の取得に失敗: ${lastError instanceof Error ? lastError.message : String(lastError)}`
      );
    }
    const rawItems = res.data?.mylist?.items ?? res.data?.items ?? [];
    const total = res.data?.mylist?.totalItemCount ?? rawItems.length;
    log.debug(`mylist ${mylistId} page=${page} items=${rawItems.length} total=${total}`);
    let items = rawItems.map((i) => ({
      videoId: i.video.id,
      title: i.video.title,
      description: i.description ?? '',
      thumbnailUrl: i.video.thumbnail?.url ?? '',
      length: this.toLengthString(i.video.duration),
      pubDate: new Date(i.video.registeredAt),
      viewCount: i.video.count?.view ?? 0,
      commentCount: i.video.count?.comment ?? 0,
      mylistCount: i.video.count?.mylist ?? 0,
      likeCount: i.video.count?.like ?? 0
    }));
    if (ImageCache.isEnabled()) {
      const http = NicoContext.get().http;
      const urls = ImageCache.cacheUrlList(items.map(i => i.thumbnailUrl), http);
      items = items.map((i, idx) => ({ ...i, thumbnailUrl: urls[idx] }));
    }
    return { items, total };
  }

  /**
   * マイリストID からマイリスト名・説明を取得 (アイテムは取得しない軽量版)。
   */
  static async fetchMylistInfo(
    mylistId: string
  ): Promise<{ name: string; description?: string } | null> {
    const ctx = NicoContext.get();
    const loggedIn = await ctx.isLoggedIn();
    const urls = loggedIn
      ? [
          `https://nvapi.nicovideo.jp/v1/users/me/mylists/${encodeURIComponent(mylistId)}?pageSize=1&page=1`,
          `${NicoApi.PUBLIC_MYLIST_API}${encodeURIComponent(mylistId)}?pageSize=1&page=1`
        ]
      : [`${NicoApi.PUBLIC_MYLIST_API}${encodeURIComponent(mylistId)}?pageSize=1&page=1`];

    for (const url of urls) {
      try {
        const res = await ctx.http.getJson<NvApiMylistResponse>(url);
        if (res.meta?.status && res.meta.status >= 400) continue;
        const name = res.data?.mylist?.name;
        if (name) return { name, description: res.data?.mylist?.description };
      } catch {/* try next */}
    }
    return null;
  }

  static async fetchWatchLater(pageSize = 100): Promise<MyListItem[]> {
    const url = `${NicoApi.WATCH_LATER_API}?pageSize=${pageSize}&sortKey=addedAt&sortOrder=desc`;
    const res = await NicoContext.get().http.getJson<NvApiMylistResponse>(url);
    const rawItems = res.data?.mylist?.items ?? res.data?.items ?? [];
    let items = rawItems.map((i) => ({
      videoId: i.video.id,
      title: i.video.title,
      description: i.description ?? '',
      thumbnailUrl: i.video.thumbnail?.url ?? '',
      length: this.toLengthString(i.video.duration),
      pubDate: new Date(i.video.registeredAt),
      viewCount: i.video.count?.view ?? 0,
      commentCount: i.video.count?.comment ?? 0,
      mylistCount: i.video.count?.mylist ?? 0
    }));
    if (ImageCache.isEnabled()) {
      const http = NicoContext.get().http;
      const urls = ImageCache.cacheUrlList(items.map(i => i.thumbnailUrl), http);
      items = items.map((i, idx) => ({ ...i, thumbnailUrl: urls[idx] }));
    }
    return items;
  }

  /**
   * ログイン済みアカウントのマイリスト一覧を取得。
   * GET https://nvapi.nicovideo.jp/v1/users/me/mylists
   */
  static async fetchAccountMylists(): Promise<MyList[]> {
    interface AccountMylistsResponse {
      meta?: { status?: number };
      data?: {
        mylists?: Array<{
          id: string;
          name: string;
          description?: string;
          status?: string;
          itemsCount?: number;
        }>;
      };
    }

    const ctx = NicoContext.get();
    const url = NicoApi.MYLIST_API_BASE;
    log.debug('fetch account mylists:', url);
    const res = await ctx.http.getJson<AccountMylistsResponse>(url);
    const status = res.meta?.status;
    if (status && status >= 400) {
      throw new Error(`アカウントマイリスト取得失敗: status=${status}`);
    }
    const raw = res.data?.mylists ?? [];
    return raw.map((m) => ({
      myListUrl: m.id,
      myListName: m.name,
      isDir: false,
      unPlayVideoCount: 0,
      type: RssType.MY_LIST,
      myListVideoIds: {}
    }));
  }

  private static toLengthString(durationSec: number): string {
    const m = Math.floor(durationSec / 60);
    const s = Math.floor(durationSec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }
}
