import { ipcMain } from 'electron';
import { IpcChannel, RssType } from '@shared/types';
import { extractMylistLikeId } from '@shared/utils/parseMylistUrl';
import { mylistUrl } from '@shared/utils/nicoUrl';
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
import { AccountManager } from '../../nicovideo/auth/AccountManager';
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
    return library.myListDao.list(AccountManager.key);
  });

  // --- マイリスト (リモート取得) ---
  ipcMain.handle(IpcChannel.MYLIST_GET, async (_e, mylistId: string) => {
    return MyListClient.fetchPublicMylist(mylistId);
  });

  ipcMain.handle(IpcChannel.MYLIST_ADD, (_e, myList: import('@shared/types').MyList) => {
    library.myListDao.upsert(AccountManager.key, myList);
    return true;
  });

  ipcMain.handle(IpcChannel.MYLIST_REMOVE, (_e, url: string) => {
    library.myListDao.remove(AccountManager.key, url);
    return true;
  });

  /** 自分のマイリストなら ID を返す。他人のマイリスト・未ログイン・マイリスト以外 (フォルダ等) は null */
  const ownMylistId = async (url: string): Promise<string | null> => {
    const id = extractMylistLikeId(url, RssType.MY_LIST);
    if (!id || !/^\d+$/.test(id)) return null;
    if (!(await NicoContext.get().isLoggedIn())) return null;
    return (await MyListClient.isOwnMylist(id)) ? id : null;
  };

  // 自分のマイリストは、先にサーバーへ反映する。失敗したらローカルも変えない (名前がずれるのを防ぐ)。
  // 他人のマイリストやフォルダなど、サーバーに対応するものがない行はローカルの表示名だけ変える
  ipcMain.handle(IpcChannel.MYLIST_UPDATE_NAME, async (_e, args: { url: string; name: string }) => {
    const id = await ownMylistId(args.url);
    if (id) await MyListClient.renameMylist(id, args.name);
    library.myListDao.updateName(AccountManager.key, args.url, args.name);
    return true;
  });

  ipcMain.handle(IpcChannel.MYLIST_CREATE_SERVER, async (_e, args: { name: string; isPublic: boolean }) => {
    const name = args.name.trim();
    if (!name) throw new Error('マイリスト名を入力してください');
    if (!(await NicoContext.get().isLoggedIn())) throw new Error('ログインすると新しいマイリストを作成できます');
    const id = await MyListClient.createMylist(name, args.isPublic === true);
    const ml: import('@shared/types').MyList = {
      myListUrl: mylistUrl(id),
      myListName: name,
      type: RssType.MY_LIST,
      isDir: false,
      unPlayVideoCount: 0,
      myListVideoIds: {}
    };
    library.myListDao.upsert(AccountManager.key, ml);
    return ml;
  });

  ipcMain.handle(IpcChannel.MYLIST_DELETE_SERVER, async (_e, args: { url: string }) => {
    const id = await ownMylistId(args.url);
    if (!id) throw new Error('自分のマイリストではないため、ニコニコから削除できません');
    await MyListClient.deleteMylist(id);
    // ニコニコ側を消せたら RE の登録も外す (先に外すと、失敗したときに登録だけ消えてしまう)
    library.myListDao.remove(AccountManager.key, args.url);
    return true;
  });

  ipcMain.handle(IpcChannel.MYLIST_OWN_IDS, async () => {
    if (!(await NicoContext.get().isLoggedIn())) return [];
    return [...(await MyListClient.fetchOwnMylistIds())];
  });

  ipcMain.handle(IpcChannel.MYLIST_SERVER_ADD_ITEM, async (_e, args: { url: string; videoId: string }) => {
    const id = await ownMylistId(args.url);
    if (!id) throw new Error('自分のマイリストではないため、動画を追加できません');
    await MyListClient.addItem(id, args.videoId);
    return true;
  });

  ipcMain.handle(IpcChannel.MYLIST_SERVER_REMOVE_ITEM, async (_e, args: { url: string; itemIds: number[] }) => {
    const id = await ownMylistId(args.url);
    if (!id) throw new Error('自分のマイリストではないため、動画を削除できません');
    await MyListClient.removeItems(id, args.itemIds);
    return true;
  });

  ipcMain.handle(
    IpcChannel.MYLIST_MOVE,
    (_e, args: { url: string; parentUrl: string | null }) => {
      library.myListDao.move(AccountManager.key, args.url, args.parentUrl);
      return true;
    }
  );

  ipcMain.handle(
    IpcChannel.MYLIST_UPDATE_ICON,
    (_e, args: { url: string; icon: string | null }) => {
      library.myListDao.updateIcon(AccountManager.key, args.url, args.icon);
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
    // 同期中のプレイリストのマイリストは、普通のマイリストとして出さない
    const linked = new Set(
      library.playlistDao.list(AccountManager.key).flatMap((p) => (p.serverMylistId ? [p.serverMylistId] : []))
    );
    return MyListClient.fetchAccountMylists(linked);
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
    log.verbose('fetch related videos:', url);
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

  // あとで見る: サーバーを正とし、ローカルには保存しない
  ipcMain.handle(IpcChannel.WATCH_LATER_FETCH, async () => {
    return MyListClient.fetchWatchLater();
  });

  ipcMain.handle(IpcChannel.WATCH_LATER_REMOVE, async (_e, args: { itemIds: number[] }) => {
    await MyListClient.removeWatchLater(args.itemIds);
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

  ipcMain.handle(
    IpcChannel.SEARCH_SAVED_MOVE,
    (_e, args: { id: string; parentId: string | null }) => {
      library.searchDao.move(args.id, args.parentId ?? null);
      return true;
    }
  );

  // --- 入力欄の履歴 (保存のON/OFFは設定。OFF中は追加せず、候補も返さない) ---
  const dao = library.inputHistoryDao;
  const cfg = getConfigStore();
  ipcMain.handle(IpcChannel.INPUT_HISTORY_SEARCH_LIST, () =>
    cfg.get('saveSearchHistory') ? dao.listSearch() : []
  );
  ipcMain.handle(IpcChannel.INPUT_HISTORY_SEARCH_ADD, (_e, word: string) => {
    if (cfg.get('saveSearchHistory') && typeof word === 'string' && word.trim()) dao.addSearch(word.trim());
  });
  ipcMain.handle(IpcChannel.INPUT_HISTORY_SEARCH_CLEAR, () => dao.clearSearch());
  ipcMain.handle(IpcChannel.INPUT_HISTORY_MYLIST_LIST, () =>
    cfg.get('saveMyListHistory') ? dao.listMyList(AccountManager.key) : []
  );
  ipcMain.handle(IpcChannel.INPUT_HISTORY_MYLIST_ADD, (_e, entry: { name: string; url: string }) => {
    if (cfg.get('saveMyListHistory') && entry?.url) dao.addMyList(AccountManager.key, { name: entry.name || entry.url, url: entry.url });
  });
  ipcMain.handle(IpcChannel.INPUT_HISTORY_MYLIST_CLEAR, () => dao.clearMyList(AccountManager.key));

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
