import type { MyListItem, MyList, UserMylistSummary } from '@shared/types';
import { RssType } from '@shared/types';
import { NicoEndpoint } from '@shared/constants';
import { mylistUrl } from '@shared/utils/nicoUrl';
import { NicoContext } from '../NicoContext';
import { createLogger } from '../../util/Logger';
import { ImageCache } from '../../util/ImageCache';
import type { NicoNvapiMylistResponse } from '../apiTypes';

const log = createLogger('MyListClient');

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
    pageSize = 100,
    cacheImages = true
  ): Promise<{ items: MyListItem[]; total: number }> {
    // 自分のマイリスト (非公開含む) を取得できる /v1/users/me/mylists/{id} を最初に試す。
    // 401 / 403 / 404 が返ったら公開マイリスト /v2/mylists/{id} にフォールバック。
    const ctx = NicoContext.get();
    const loggedIn = await ctx.isLoggedIn();
    const candidates = loggedIn
      ? [
          NicoEndpoint.myMylist(mylistId, pageSize, page),
          NicoEndpoint.publicMylist(mylistId, pageSize, page)
        ]
      : [NicoEndpoint.publicMylist(mylistId, pageSize, page)];

    let res: NicoNvapiMylistResponse | null = null;
    let lastError: unknown = null;
    for (const url of candidates) {
      log.debug('fetch mylist:', url);
      try {
        res = await ctx.http.getJson<NicoNvapiMylistResponse>(url);
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
    if (cacheImages && ImageCache.isEnabled()) {
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
          NicoEndpoint.myMylist(mylistId, 1, 1),
          NicoEndpoint.publicMylist(mylistId, 1, 1)
        ]
      : [NicoEndpoint.publicMylist(mylistId, 1, 1)];

    for (const url of urls) {
      try {
        const res = await ctx.http.getJson<NicoNvapiMylistResponse>(url);
        if (res.meta?.status && res.meta.status >= 400) continue;
        const name = res.data?.mylist?.name;
        if (name) return { name, description: res.data?.mylist?.description };
      } catch {/* try next */}
    }
    return null;
  }

  static async fetchWatchLater(pageSize = 100): Promise<MyListItem[]> {
    const url = NicoEndpoint.watchLaterList(pageSize);
    const res = await NicoContext.get().http.getJson<NicoNvapiMylistResponse>(url);
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
    const url = NicoEndpoint.myMylists();
    log.debug('fetch account mylists:', url);
    const res = await ctx.http.getJson<AccountMylistsResponse>(url);
    const status = res.meta?.status;
    if (status && status >= 400) {
      throw new Error(`アカウントマイリスト取得失敗: status=${status}`);
    }
    const raw = res.data?.mylists ?? [];
    return raw.map((m) => ({
      myListUrl: mylistUrl(m.id),
      myListName: m.name,
      isDir: false,
      unPlayVideoCount: 0,
      type: RssType.MY_LIST,
      myListVideoIds: {}
    }));
  }

  /**
   * 指定ユーザーの投稿動画一覧を取得。
   * GET https://nvapi.nicovideo.jp/v3/users/{userId}/videos
   * 元: FollowFeedClient の getUserRecentVideos
   */
  static async fetchUserVideos(
    userId: string,
    page = 1,
    pageSize = 100,
    cacheImages = true
  ): Promise<{ items: MyListItem[]; total: number }> {
    interface NvApiUserVideosResponse {
      meta?: { status?: number };
      data?: {
        items?: Array<{
          essential?: {
            id?: string;
            title?: string;
            thumbnail?: { url?: string; middleUrl?: string };
            registeredAt?: string;
            count?: { view?: number; comment?: number; mylist?: number; like?: number };
            duration?: number;
          };
        }>;
        totalCount?: number;
      };
    }

    const ctx = NicoContext.get();
    const params = new URLSearchParams({
      sortKey: 'registeredAt',
      sortOrder: 'desc',
      pageSize: String(pageSize),
      page: String(page),
      // センシティブ (年齢制限等) 動画も含めて取得する。パラメータ名は sensitiveContents
      // (sensitive は API に無視され、未指定扱い=センシティブ動画が除外される)
      sensitiveContents: 'mask'
    });
    const url = NicoEndpoint.userVideos(userId, params);
    log.debug('fetch user videos:', url);
    const res = await ctx.http.getJson<NvApiUserVideosResponse>(url);
    const status = res.meta?.status;
    if (status && status >= 400) {
      throw new Error(`ユーザー投稿動画の取得に失敗: status=${status}`);
    }
    const rawItems = res.data?.items ?? [];
    const total = res.data?.totalCount ?? rawItems.length;
    let items = rawItems
      .map((it): MyListItem | null => {
        const e = it.essential;
        if (!e?.id) return null;
        return {
          videoId: e.id,
          title: e.title ?? e.id,
          description: '',
          thumbnailUrl: e.thumbnail?.middleUrl ?? e.thumbnail?.url ?? '',
          length: this.toLengthString(e.duration ?? 0),
          pubDate: e.registeredAt ? new Date(e.registeredAt) : new Date(0),
          viewCount: e.count?.view ?? 0,
          commentCount: e.count?.comment ?? 0,
          mylistCount: e.count?.mylist ?? 0,
          likeCount: e.count?.like ?? 0
        };
      })
      .filter((i): i is MyListItem => i !== null);
    if (cacheImages && ImageCache.isEnabled()) {
      const http = ctx.http;
      const urls = ImageCache.cacheUrlList(items.map(i => i.thumbnailUrl), http);
      items = items.map((i, idx) => ({ ...i, thumbnailUrl: urls[idx] }));
    }
    log.debug(`user ${userId} page=${page} items=${items.length} total=${total}`);
    return { items, total };
  }

  /**
   * 指定ユーザーの公開マイリスト一覧を取得。
   * GET https://nvapi.nicovideo.jp/v1/users/{userId}/mylists
   */
  static async fetchByUserId(userId: string): Promise<UserMylistSummary[]> {
    interface NvApiUserMylistsResponse {
      meta?: { status?: number };
      data?: {
        mylists?: Array<{
          id: number | string;
          isPublic?: boolean;
          name: string;
          itemsCount?: number;
        }>;
      };
    }
    const url = NicoEndpoint.userMylists(userId);
    log.debug('fetch user mylists:', url);
    const res = await NicoContext.get().http.getJson<NvApiUserMylistsResponse>(url);
    const status = res.meta?.status;
    if (status && status >= 400) {
      throw new Error(`ユーザーマイリスト一覧の取得に失敗: status=${status}`);
    }
    const raw = res.data?.mylists ?? [];
    return raw
      .filter((m) => m.isPublic !== false)
      .map((m) => ({
        id: String(m.id),
        name: m.name,
        itemsCount: m.itemsCount ?? 0
      }));
  }

  /**
   * ユーザーIDからニックネームを取得 (表示名用の軽量版)。
   */
  static async fetchUserName(userId: string): Promise<string | null> {
    interface NvApiUserResponse {
      data?: { user?: { nickname?: string } };
    }
    try {
      const res = await NicoContext.get().http.getJson<NvApiUserResponse>(
        NicoEndpoint.user(userId)
      );
      return res.data?.user?.nickname ?? null;
    } catch (e) {
      log.debug(`fetchUserName failed for ${userId}:`, e);
      return null;
    }
  }

  private static toLengthString(durationSec: number): string {
    const m = Math.floor(durationSec / 60);
    const s = Math.floor(durationSec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }
}
