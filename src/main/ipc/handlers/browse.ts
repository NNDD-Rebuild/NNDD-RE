import { ipcMain } from 'electron';
import { IpcChannel } from '@shared/types';
import type { RssTypeValue } from '@shared/types';
import { NicoApi, NicoEndpoint, NicoHeaders } from '@shared/constants';
import { getConfigStore } from '../../config/ConfigStore';
import {
  SearchClient,
  MyListClient,
  RankingClient,
  fetchMylistLikeItems,
  fetchMylistLikeName,
  type SearchOptions
} from '../../nicovideo';
import { NicoContext } from '../../nicovideo/NicoContext';
import { SeriesClient } from '../../nicovideo/series/SeriesClient';
import { ImageCache } from '../../util/ImageCache';
import { createLogger } from '../../util/Logger';
import type { IpcHandlerContext } from './context';

const log = createLogger('IPC');

/**
 * ニコニコ動画の閲覧系: マイリスト (MYLIST_*)・シリーズ・関連動画・検索 (SEARCH_*)・
 * ランキング (RANKING_*)・フォロー中フィード (FOLLOW_*)・ユーザー情報 (USER_*)。
 */
export function registerBrowseHandlers(ctx: IpcHandlerContext): void {
  const { library } = ctx;

  // --- マイリスト (永続化分) ---
  ipcMain.handle(IpcChannel.MYLIST_LIST, () => {
    return library.myListDao.list();
  });

  // --- マイリスト (リモート取得) ---
  ipcMain.handle(IpcChannel.MYLIST_GET, async (_e, mylistId: string) => {
    return MyListClient.fetchPublicMylist(mylistId);
  });

  ipcMain.handle(IpcChannel.MYLIST_ADD, (_e, myList: import('@shared/types').MyList) => {
    library.myListDao.upsert(myList);
    return true;
  });

  ipcMain.handle(IpcChannel.MYLIST_REMOVE, (_e, url: string) => {
    library.myListDao.remove(url);
    return true;
  });

  ipcMain.handle(IpcChannel.MYLIST_UPDATE_NAME, (_e, args: { url: string; name: string }) => {
    library.myListDao.updateName(args.url, args.name);
    return true;
  });

  ipcMain.handle(
    IpcChannel.MYLIST_UPDATE_ICON,
    (_e, args: { url: string; icon: string | null }) => {
      library.myListDao.updateIcon(args.url, args.icon);
      return true;
    }
  );

  ipcMain.handle(
    IpcChannel.MYLIST_RENEW,
    async (_e, args: string | { url: string; type?: RssTypeValue }) => {
      const mylistUrl = typeof args === 'string' ? args : args.url;
      const type = typeof args === 'string' ? undefined : args.type;
      const { items } = await fetchMylistLikeItems(mylistUrl, type ?? 'mylist', 1, 100);
      return items;
    }
  );

  ipcMain.handle(
    IpcChannel.MYLIST_FETCH_PAGE,
    async (_e, args: { url: string; type?: RssTypeValue; page: number; pageSize?: number; cacheImages?: boolean }) => {
      return fetchMylistLikeItems(args.url, args.type ?? 'mylist', args.page, args.pageSize ?? 100, args.cacheImages ?? true);
    }
  );

  ipcMain.handle(IpcChannel.MYLIST_FETCH_ACCOUNT, async () => {
    return MyListClient.fetchAccountMylists();
  });

  ipcMain.handle(
    IpcChannel.MYLIST_FETCH_INFO,
    async (_e, args: string | { url: string; type?: RssTypeValue }) => {
      const url = typeof args === 'string' ? args : args.url;
      const type = typeof args === 'string' ? undefined : args.type;
      return fetchMylistLikeName(url, type ?? 'mylist').then((name) => (name ? { name } : null));
    }
  );

  ipcMain.handle(IpcChannel.SERIES_FETCH, async (_e, seriesId: string, currentVideoId?: string, requestedPage?: number) => {
    return SeriesClient.fetchPage(seriesId, requestedPage, currentVideoId);
  });

  ipcMain.handle(IpcChannel.VIDEO_GET_RELATED, async (_e, videoId: string) => {
    const ctx = NicoContext.get();
    interface RecommendContent {
      id: string;
      title?: string;
      shortDescription?: string;
      thumbnail?: { url?: string; listingUrl?: string; middleUrl?: string };
      duration?: number;
      registeredAt?: string;
      count?: { view?: number; comment?: number; mylist?: number; like?: number };
      isChannelVideo?: boolean;
    }
    interface RecommendItem {
      contentType?: string;
      content?: RecommendContent;
    }
    interface RecommendRes {
      meta?: { status?: number };
      data?: { items?: RecommendItem[] };
    }
    const url = NicoEndpoint.recommend(videoId);
    log.debug('fetch related videos:', url);
    const res = await ctx.http.getJson<RecommendRes>(url);
    if (res.meta?.status && res.meta.status >= 400) {
      throw new Error(`関連動画取得失敗: status=${res.meta.status}`);
    }
    const toLength = (sec: number): string => {
      const h = Math.floor(sec / 3600);
      const mm = Math.floor((sec % 3600) / 60);
      const ss = sec % 60;
      return h > 0
        ? `${h}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
        : `${mm}:${String(ss).padStart(2, '0')}`;
    };
    return (res.data?.items ?? [])
      .filter((i): i is Required<Pick<RecommendItem, 'content'>> & RecommendItem =>
        i.contentType === 'video' && !!i.content)
      .map((i) => ({
        videoId: i.content.id,
        title: i.content.title ?? '',
        description: i.content.shortDescription ?? '',
        thumbnailUrl: i.content.thumbnail?.listingUrl ?? i.content.thumbnail?.url ?? '',
        length: toLength(i.content.duration ?? 0),
        pubDate: i.content.registeredAt ?? new Date().toISOString(),
        viewCount: i.content.count?.view ?? 0,
        commentCount: i.content.count?.comment ?? 0,
        mylistCount: i.content.count?.mylist ?? 0,
        likeCount: i.content.count?.like ?? 0,
        isChannelVideo: i.content.isChannelVideo ?? false
      }));
  });

  ipcMain.handle(IpcChannel.MYLIST_ADD_VIDEO_DEFLIST, async (_e, videoId: string) => {
    const ctx = NicoContext.get();
    await ctx.http.postJson(
      NicoEndpoint.watchLater(),
      { watchId: videoId },
      { headers: { 'X-Frontend-Id': NicoHeaders.X_FRONTEND_ID, 'X-Frontend-Version': NicoHeaders.X_FRONTEND_VERSION, 'X-Request-With': NicoApi.WWW_BASE } }
    );
    return true;
  });

  // --- 検索 ---
  ipcMain.handle(IpcChannel.SEARCH_EXECUTE, async (_e, opts: SearchOptions) => {
    const searchApi = getConfigStore().get('searchApi');
    return SearchClient.search(opts, searchApi);
  });

  ipcMain.handle(IpcChannel.SEARCH_SAVED_LIST, () => {
    return library.searchDao.list();
  });

  ipcMain.handle(IpcChannel.SEARCH_SAVED_ADD, (_e, item) => {
    library.searchDao.upsert(item);
    return true;
  });

  ipcMain.handle(IpcChannel.SEARCH_SAVED_REMOVE, (_e, id: string) => {
    library.searchDao.remove(id);
    return true;
  });

  // --- ランキング ---
  ipcMain.handle(
    IpcChannel.RANKING_FETCH,
    async (_e, opts: { genre: string; term: 'hour' | '24h' | 'week' | 'month' | 'total'; tag?: string }) => {
      const hideSensitiveContents = getConfigStore().get('hideSensitiveContents');
      return RankingClient.fetch(opts.genre, opts.term, opts.tag, hideSensitiveContents);
    }
  );

  ipcMain.handle(IpcChannel.RANKING_GENRES, async () => {
    return RankingClient.fetchGenres();
  });

  // --- フォロー中フィード ---
  ipcMain.handle(
    IpcChannel.FOLLOW_FEED,
    async (_e, opts?: { limit?: number; untilId?: string; pageNum?: number; userId?: string; userNickname?: string; userIconUrl?: string }) => {
      const { FollowFeedClient } = await import('../../nicovideo/follow/FollowFeedClient');
      const user = opts?.userId
        ? { id: opts.userId, nickname: opts.userNickname ?? opts.userId, iconUrl: opts.userIconUrl ?? '' }
        : undefined;
      return FollowFeedClient.fetchFeed(opts?.limit ?? 32, opts?.untilId, user, opts?.pageNum ?? 1);
    }
  );

  ipcMain.handle(IpcChannel.FOLLOW_PROBE, async () => {
    const { FollowFeedClient } = await import('../../nicovideo/follow/FollowFeedClient');
    return FollowFeedClient.probeEndpoints();
  });

  ipcMain.handle(IpcChannel.FOLLOW_USERS, async () => {
    const { FollowFeedClient } = await import('../../nicovideo/follow/FollowFeedClient');
    return FollowFeedClient.fetchUsers(100);
  });

  // ユーザー情報取得 (nvapi /v1/users/{userId})。
  // 退会・削除済みユーザーは何度呼んでも404が返り続けるため、結果 (失敗時はnull) をプロセス内メモリにキャッシュし再フェッチを防ぐ。
  interface CachedUserInfo { nickname: string; iconUrl: string }
  const userInfoCache = new Map<string, CachedUserInfo | null>();

  async function fetchUserInfoCached(userId: string | number): Promise<CachedUserInfo | null> {
    const key = String(userId);
    if (userInfoCache.has(key)) return userInfoCache.get(key) ?? null;
    let result: CachedUserInfo | null = null;
    try {
      const ctx = NicoContext.get();
      const url = NicoEndpoint.user(key);
      interface UserRes {
        meta?: { status?: number };
        data?: { user?: { nickname?: string; icons?: { small?: string; large?: string } } };
      }
      const res = await ctx.http.getJson<UserRes>(url, { timeoutMs: 8000 });
      const user = res.data?.user;
      if (user) {
        let iconUrl = user.icons?.small ?? '';
        if (iconUrl && ImageCache.isEnabled()) {
          iconUrl = ImageCache.cacheUrlList([iconUrl], ctx.http)[0];
        }
        result = { nickname: user.nickname ?? '', iconUrl };
      }
    } catch {
      result = null;
    }
    userInfoCache.set(key, result);
    return result;
  }

  ipcMain.handle(IpcChannel.USER_ICON_FETCH, async (_e, userId: string | number) => {
    const info = await fetchUserInfoCached(userId);
    return info?.iconUrl ?? null;
  });

  ipcMain.handle(IpcChannel.USER_INFO_FETCH, async (_e, userId: string | number) => {
    return fetchUserInfoCached(userId);
  });

  ipcMain.handle(IpcChannel.USER_MYLISTS_FETCH, async (_e, userId: string) => {
    return MyListClient.fetchByUserId(userId);
  });

  ipcMain.handle(IpcChannel.USER_SERIES_FETCH, async (_e, userId: string) => {
    const ctx = NicoContext.get();
    const url = NicoEndpoint.userSeries(userId);
    interface NvApiUserSeriesResponse {
      meta?: { status?: number };
      data?: {
        items?: Array<{
          id: number | string;
          title: string;
          isListed?: boolean;
          itemsCount?: number;
          thumbnailUrl?: string;
        }>;
      };
    }
    const res = await ctx.http.getJson<NvApiUserSeriesResponse>(url);
    const status = res.meta?.status;
    if (status && status >= 400) {
      throw new Error(`ユーザーシリーズ一覧の取得に失敗: status=${status}`);
    }
    const raw = (res.data?.items ?? []).filter((s) => s.isListed !== false);
    let items = raw.map((s) => ({
      id: String(s.id),
      title: s.title,
      itemsCount: s.itemsCount ?? 0,
      thumbnailUrl: s.thumbnailUrl ?? ''
    }));
    if (ImageCache.isEnabled()) {
      const urls = ImageCache.cacheUrlList(items.map((i) => i.thumbnailUrl), ctx.http);
      items = items.map((i, idx) => ({ ...i, thumbnailUrl: urls[idx] }));
    }
    return items;
  });
}
