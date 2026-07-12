import type { SearchResultItem } from '@shared/types';
import { NicoApi } from '@shared/constants/api';
import { NicoContext } from '../NicoContext';
import { createLogger } from '../../util/Logger';
import { ImageCache } from '../../util/ImageCache';

const log = createLogger('FollowFeedClient');

// api.feed.nicovideo.jp 型定義
interface FeedActor {
  id: string;
  type: 'user' | 'channel';
  name: string;
  iconUrl: string;
  url: string;
  isLive: boolean;
  isUnread?: boolean;
}

interface FeedActivity {
  id: string;
  kind: string;
  createdAt: string;
  sensitive: boolean;
  thumbnailUrl: string;
  message?: { text: string };
  label?: { text: string };
  content?: {
    type: string;
    id: string;
    title: string;
    url: string;
    startedAt?: string;
    video?: { duration: number };
  };
  actor?: FeedActor;
}

interface FeedActivitiesResponse {
  code: string;
  activities: FeedActivity[];
  nextCursor?: string;
  impressionId?: string;
}

interface FeedActorsResponse {
  code: string;
  actors: FeedActor[];
}

const FEED_API = 'https://api.feed.nicovideo.jp';

interface NicorepoEntry {
  id: string;
  updated: string;
  actor?: { name?: string; url?: string; iconUrl?: string };
  title?: string;
  object?: { type?: string; url?: string; name?: string; image?: string };
}

interface NicorepoResponse {
  meta?: { status?: number; hasNext?: boolean; maxId?: string; minId?: string };
  data?: NicorepoEntry[];
}

interface NvapiUser {
  id: number | string;
  nickname?: string;
}

interface NvapiFollowingUser {
  id?: number | string;
  nickname?: string;
  icons?: { small?: string; large?: string };
}

export interface FollowingUser {
  id: string;
  nickname: string;
  iconUrl: string;
}

interface NvapiFollowingResponse {
  meta?: { status?: number };
  data?: {
    items?: NvapiFollowingUser[];
    summary?: {
      followees?: number;
      followers?: number;
      hasNext?: boolean;
      cursor?: string;
    };
  };
}

interface NvapiVideoEssential {
  id?: string;
  title?: string;
  thumbnail?: { url?: string; middleUrl?: string };
  registeredAt?: string;
  count?: { view?: number; comment?: number; mylist?: number; like?: number };
  duration?: number;
}

interface NvapiVideoItem {
  essential?: NvapiVideoEssential;
}

interface NvapiVideosResponse {
  meta?: { status?: number };
  data?: {
    items?: NvapiVideoItem[];
    totalCount?: number;
  };
}

export interface ProbeResult {
  url: string;
  status: number;
  ok: boolean;
  preview: string;
}

export interface FeedResult {
  items: SearchResultItem[];
  hasNext: boolean;
  nextCursor: string | null;
  /** ユーザーモード時のみ: API が返す総動画数 (ページネーション判定用) */
  totalCount?: number;
}

const TERMS = ['last-6-months', 'last-1-month'] as const;

/** ユーザーID取得 */
async function getMyUserId(): Promise<string> {
  const http = NicoContext.get().http;
  const res = await http.fetch('https://nvapi.nicovideo.jp/v1/users/me', { timeoutMs: 8000 });
  if (!res.ok) throw new Error(`user info failed: ${res.status}`);
  const json = await res.json() as Record<string, unknown>;
  const id = (json['data'] as Record<string, unknown>)?.['user']?.['id'] ?? json['id'];
  if (!id) throw new Error('userId not found');
  log.verbose('userId =', id);
  return String(id);
}

/** フォローしているユーザー一覧を取得 (id + nickname + iconUrl) */
async function getFollowingUsers(maxCount = 30): Promise<FollowingUser[]> {
  const myUserId = await getMyUserId();
  const http = NicoContext.get().http;
  const users: FollowingUser[] = [];
  const baseUrl = `https://nvapi.nicovideo.jp/v1/users/${myUserId}/following/users`;

  let cursor: string | undefined;
  while (users.length < maxCount) {
    const need = Math.min(50, maxCount - users.length);
    const params = new URLSearchParams({ pageSize: String(need) });
    if (cursor) params.set('cursor', cursor);

    const url = `${baseUrl}?${params}`;
    try {
      const res = await http.fetch(url, { timeoutMs: 10000 });
      if (!res.ok) {
        log.debug(`following users: ${url} → ${res.status}`);
        break;
      }
      const json = await res.json() as NvapiFollowingResponse;
      const items = json.data?.items ?? [];
      for (const item of items) {
        if (!item.id) continue;
        users.push({
          id: String(item.id),
          nickname: item.nickname ?? String(item.id),
          iconUrl: item.icons?.small ?? '',
        });
        if (users.length >= maxCount) break;
      }
      log.verbose(`following users: ${users.length}件取得`);

      const summary = json.data?.summary;
      if (!summary?.hasNext || !summary.cursor || users.length >= maxCount) break;
      cursor = summary.cursor;
    } catch (e) {
      log.debug(`following users error ${url}:`, e);
      break;
    }
  }

  if (users.length === 0) {
    log.warn('フォローユーザー一覧取得失敗。');
    return users;
  }
  if (ImageCache.isEnabled()) {
    const http = NicoContext.get().http;
    const iconUrls = ImageCache.cacheUrlList(users.map(u => u.iconUrl), http);
    return users.map((u, idx) => ({ ...u, iconUrl: iconUrls[idx] }));
  }
  return users;
}

interface UserVideosResult {
  videos: SearchResultItem[];
  totalCount: number;
}

/** 指定ユーザーの最近の動画を取得 (page=1始まり, pageSize ベース) */
async function getUserRecentVideos(
  user: FollowingUser,
  pageSize = 10,
  page = 1
): Promise<UserVideosResult> {
  const http = NicoContext.get().http;
  const params = new URLSearchParams({
    sortKey: 'registeredAt',
    sortOrder: 'desc',
    pageSize: String(pageSize),
    page: String(page),
    sensitive: 'mask',
  });

  const url = `https://nvapi.nicovideo.jp/v3/users/${user.id}/videos?${params}`;
  try {
    const res = await http.fetch(url, { timeoutMs: 8000 });
    if (!res.ok) return { videos: [], totalCount: 0 };
    const json = await res.json() as NvapiVideosResponse;
    const totalCount = json.data?.totalCount ?? 0;
    let videos = (json.data?.items ?? []).map((v): SearchResultItem | null => {
      const e = v.essential;
      if (!e?.id) return null;
      return {
        videoId: e.id,
        title: e.title ?? e.id,
        description: '',
        thumbnailUrl: e.thumbnail?.middleUrl ?? e.thumbnail?.url ?? '',
        length: e.duration ?? 0,
        viewCount: e.count?.view ?? 0,
        commentCount: e.count?.comment ?? 0,
        mylistCount: e.count?.mylist ?? 0,
        likeCount: e.count?.like ?? 0,
        registeredAt: e.registeredAt ? new Date(e.registeredAt) : new Date(0),
        tags: [],
        author: {
          id: user.id,
          nickname: user.nickname,
          iconUrl: user.iconUrl,
        },
        // フォロー中ユーザー個人の動画一覧のためチャンネル動画は含まれない
        isChannelVideo: false,
      } satisfies SearchResultItem;
    }).filter((x): x is SearchResultItem => x !== null);
    if (ImageCache.isEnabled()) {
      const http = NicoContext.get().http;
      const urls = ImageCache.cacheUrlList(videos.map(v => v.thumbnailUrl), http);
      videos = videos.map((v, idx) => ({ ...v, thumbnailUrl: urls[idx] }));
    }
    return { videos, totalCount };
  } catch {
    return { videos: [], totalCount: 0 };
  }
}

/** 並列数を制限してバッチ実行 */
async function batchAsync<T, R>(
  items: T[],
  batchSize: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(batch.map(fn));
    for (const r of batchResults) {
      if (r.status === 'fulfilled') results.push(r.value);
    }
  }
  return results;
}

/** NicorepoEntry → SearchResultItem (型エラーなし版) */
function parseNicorepoToItems(entries: NicorepoEntry[]): SearchResultItem[] {
  const results: SearchResultItem[] = [];
  for (const e of entries) {
    if (e.object?.type !== 'video' || !e.object.url) continue;
    const match = e.object.url.match(/\/watch\/((?:sm|nm|so|ss)?\d+)/);
    const videoId = match?.[1] ?? '';
    if (!videoId) continue;
    const actorIdMatch = e.actor?.url?.match(/\/user\/(\d+)/);
    const authorId = actorIdMatch?.[1] ?? '';
    results.push({
      videoId,
      title: e.object.name ?? e.title ?? videoId,
      description: '',
      thumbnailUrl: e.object.image ?? '',
      length: 0,
      viewCount: 0,
      commentCount: 0,
      mylistCount: 0,
      likeCount: 0,
      registeredAt: new Date(e.updated),
      tags: [],
      ...(authorId ? { author: { id: authorId, nickname: e.actor?.name ?? '', iconUrl: e.actor?.iconUrl ?? '' } } : {}),
    });
  }
  return results;
}

interface NvapiVideoBulkItem {
  id?: string;
  title?: string;
  thumbnail?: { url?: string; middleUrl?: string };
  registeredAt?: string;
  count?: { view?: number; comment?: number; mylist?: number; like?: number };
  duration?: number;
}

interface NvapiVideoBulkResponse {
  meta?: { status?: number };
  data?: { videos?: NvapiVideoBulkItem[] };
}

/** nvapi /v1/videos?ids=... でviewCount/duration等を補完 (失敗時は元データそのまま) */
async function enrichVideoInfo(items: SearchResultItem[]): Promise<SearchResultItem[]> {
  if (items.length === 0) return items;
  const http = NicoContext.get().http;
  const ids = items.map(i => i.videoId).join(',');
  const url = `https://nvapi.nicovideo.jp/v1/videos?ids=${encodeURIComponent(ids)}`;
  try {
    const res = await http.fetch(url, { timeoutMs: 8000 });
    if (!res.ok) { log.debug(`enrichVideoInfo: ${res.status}`); return items; }
    const json = await res.json() as NvapiVideoBulkResponse;
    const map = new Map<string, NvapiVideoBulkItem>();
    for (const v of json.data?.videos ?? []) { if (v.id) map.set(v.id, v); }
    let enriched = items.map((item): SearchResultItem => {
      const v = map.get(item.videoId);
      if (!v) return item;
      return {
        ...item,
        title: v.title ?? item.title,
        thumbnailUrl: v.thumbnail?.middleUrl ?? v.thumbnail?.url ?? item.thumbnailUrl,
        length: v.duration ?? item.length,
        viewCount: v.count?.view ?? item.viewCount,
        commentCount: v.count?.comment ?? item.commentCount,
        mylistCount: v.count?.mylist ?? item.mylistCount,
        likeCount: v.count?.like ?? item.likeCount,
        registeredAt: v.registeredAt ? new Date(v.registeredAt) : item.registeredAt,
      };
    });
    if (ImageCache.isEnabled()) {
      const thumbUrls = ImageCache.cacheUrlList(enriched.map(v => v.thumbnailUrl), http);
      enriched = enriched.map((v, idx) => ({ ...v, thumbnailUrl: thumbUrls[idx] }));
    }
    log.info(`enrichVideoInfo: ${map.size}/${items.length}件補完`);
    return enriched;
  } catch (e) {
    log.debug('enrichVideoInfo error:', e);
    return items;
  }
}

/** api.feed.nicovideo.jp でフォローフィードを取得。失敗時は null */
async function tryFeedApi(limit: number, cursor?: string): Promise<FeedResult | null> {
  const http = NicoContext.get().http;
  const params = new URLSearchParams({ context: 'my_timeline', limit: String(Math.min(limit, 50)) });
  if (cursor) params.set('cursor', cursor);
  const url = `${FEED_API}/v1/activities/followings/video?${params}`;
  try {
    const res = await http.fetch(url, { timeoutMs: 10000, headers: { 'Accept': 'application/json', 'Origin': 'https://www.nicovideo.jp' } });
    if (!res.ok) { log.debug(`feed API: ${url} → ${res.status}`); return null; }
    const json = await res.json() as FeedActivitiesResponse;
    if (json.code !== 'ok') { log.debug(`feed API: code=${json.code}`); return null; }

    let items = (json.activities ?? [])
      .filter(a => a.content?.type === 'video' && a.content.id)
      .map((a): SearchResultItem => ({
        videoId: a.content!.id,
        title: a.content!.title,
        description: '',
        thumbnailUrl: a.thumbnailUrl,
        length: a.content!.video?.duration ?? 0,
        viewCount: 0,
        commentCount: 0,
        mylistCount: 0,
        likeCount: 0,
        registeredAt: new Date(a.createdAt),
        tags: [],
        author: a.actor ? { id: a.actor.id, nickname: a.actor.name, iconUrl: a.actor.iconUrl } : undefined,
        isChannelVideo: a.actor?.type === 'channel',
      }));

    if (ImageCache.isEnabled()) {
      const h = NicoContext.get().http;
      const thumbUrls = ImageCache.cacheUrlList(items.map(v => v.thumbnailUrl), h);
      items = items.map((v, idx) => ({ ...v, thumbnailUrl: thumbUrls[idx] }));
    }

    const hasNext = !!json.nextCursor;
    const nextCursor = json.nextCursor ?? null;
    log.info(`feed API: ${items.length}件 hasNext=${hasNext}`);
    return { items, hasNext, nextCursor };
  } catch (e) {
    log.debug('feed API error:', e);
    return null;
  }
}

/** フォロー中ユーザー一覧を api.feed.nicovideo.jp/v1/actors で取得 */
async function getFeedActors(): Promise<FollowingUser[]> {
  const http = NicoContext.get().http;
  const url = `${FEED_API}/v1/actors?limit=100`;
  try {
    const res = await http.fetch(url, { timeoutMs: 10000, headers: { 'Accept': 'application/json', 'Origin': 'https://www.nicovideo.jp' } });
    if (!res.ok) return [];
    const json = await res.json() as FeedActorsResponse;
    if (json.code !== 'ok') return [];
    const users: FollowingUser[] = json.actors
      .filter(a => a.type === 'user')
      .map(a => ({ id: a.id, nickname: a.name, iconUrl: a.iconUrl }));
    if (ImageCache.isEnabled()) {
      const h = NicoContext.get().http;
      const urls = ImageCache.cacheUrlList(users.map(u => u.iconUrl), h);
      return users.map((u, i) => ({ ...u, iconUrl: urls[i] }));
    }
    return users;
  } catch (e) {
    log.debug('getFeedActors error:', e);
    return [];
  }
}

/** ニコレポAPIでフォローフィードを取得。全候補失敗時は null */
async function tryNicorepoFeed(limit: number, cursor?: string): Promise<FeedResult | null> {
  const http = NicoContext.get().http;
  const params = new URLSearchParams({
    'object[type]': 'video',
    'list': 'followingUser',
    'limit': String(Math.min(limit, 50)),
  });
  if (cursor) params.set('maxId', cursor);

  // public.api.nicovideo.jp は ENOTFOUND のため api.nicovideo.jp を使用
  const NICOREPO_API = 'https://api.nicovideo.jp/v1/timelines/nicorepo';

  // 候補A: /my/ パス (ユーザーID不要)
  const candidateUrls: string[] = [
    `${NICOREPO_API}/last-1-month/my/pc/entries.json?${params}`,
  ];
  // 候補B/C: /users/{id}/ パス
  let userId: string | null = null;
  try { userId = await getMyUserId(); } catch { /* skip */ }
  if (userId) {
    candidateUrls.push(`${NICOREPO_API}/last-1-month/users/${userId}/pc/entries.json?${params}`);
    candidateUrls.push(`${NICOREPO_API}/last-6-months/users/${userId}/pc/entries.json?${params}`);
  }

  for (const url of candidateUrls) {
    try {
      const res = await http.fetch(url, { timeoutMs: 10000 });
      if (!res.ok) { log.debug(`nicorepo: ${url} → ${res.status}`); continue; }
      const json = await res.json() as NicorepoResponse;
      const rawItems = parseNicorepoToItems(json.data ?? []);
      const items = await enrichVideoInfo(rawItems);
      const hasNext = json.meta?.hasNext ?? false;
      const nextCursor = hasNext ? (json.meta?.maxId ?? null) : null;
      log.info(`nicorepo: ${url} → ${items.length}件 hasNext=${hasNext}`);
      return { items, hasNext, nextCursor };
    } catch (e) {
      log.debug(`nicorepo: ${url} error:`, e);
    }
  }
  return null;
}

/** フォローユーザーの動画を集約してフィードを構築 */
async function buildFeedFromFollowings(
  limit: number,
  beforeDateISO?: string
): Promise<FeedResult> {
  const followingUsers = await getFollowingUsers(30);
  if (followingUsers.length === 0) {
    throw new Error('フォローしているユーザーが見つかりません（フォロー中ユーザー取得APIが利用できないか、フォローなし）');
  }

  log.info(`フォローユーザー ${followingUsers.length} 人から動画を収集中…`);

  // 最大30ユーザー、10並列バッチで取得 (3バッチ×2秒=約6秒)
  const perUser = 10;
  const beforeDate = beforeDateISO ? new Date(beforeDateISO) : null;

  const resultLists = await batchAsync(followingUsers, 10, (user) =>
    getUserRecentVideos(user, perUser)
  );

  const allVideos: SearchResultItem[] = [];
  for (const list of resultLists) {
    for (const v of list.videos) {
      // サーバー側フィルタが使えない場合のクライアント側日付フィルタ
      if (beforeDate && v.registeredAt instanceof Date) {
        if (v.registeredAt.getTime() >= beforeDate.getTime()) continue;
      }
      allVideos.push(v);
    }
  }

  // 日付降順ソート
  allVideos.sort((a, b) => {
    const ta = a.registeredAt instanceof Date ? a.registeredAt.getTime() : 0;
    const tb = b.registeredAt instanceof Date ? b.registeredAt.getTime() : 0;
    return tb - ta;
  });

  // 重複除去
  const seen = new Set<string>();
  const deduped = allVideos.filter((v) => {
    if (seen.has(v.videoId)) return false;
    seen.add(v.videoId);
    return true;
  });

  const items = deduped.slice(0, limit);
  const hasNext = deduped.length > limit;
  const lastItem = items[items.length - 1];
  const nextCursor = lastItem?.registeredAt instanceof Date
    ? lastItem.registeredAt.toISOString()
    : null;

  return { items, hasNext, nextCursor };
}

/** 旧ニコレポ系エンドポイント候補 */
function buildNicorepoUrls(userId: string, params: URLSearchParams): string[] {
  const urls: string[] = [];
  const bases = [
    'https://api.nicovideo.jp',
    'https://nvapi.nicovideo.jp',
    'https://www.nicovideo.jp',
  ];
  for (const base of bases) {
    for (const term of TERMS) {
      urls.push(`${base}/v1/timelines/nicorepo/${term}/users/${userId}/pc/entries.json?${params}`);
      urls.push(`${base}/v1/timelines/nicorepo/${term}/users/${userId}/entries.json?${params}`);
    }
  }
  return urls;
}

export class FollowFeedClient {

  static async fetchUsers(maxCount = 100): Promise<FollowingUser[]> {
    const feedActors = await getFeedActors();
    if (feedActors.length > 0) return feedActors;
    return getFollowingUsers(maxCount);
  }

  static async fetchFeed(
    limit = 32,
    untilId?: string,
    user?: FollowingUser,
    pageNum = 1
  ): Promise<FeedResult> {
    if (user) {
      // 特定ユーザーの動画一覧: page + pageSize ベース
      const { videos, totalCount } = await getUserRecentVideos(user, limit, pageNum);
      log.info(`user ${user.id} page=${pageNum} totalCount=${totalCount} items=${videos.length}`);
      // page * pageSize < totalCount なら次ページあり
      const hasNext = pageNum * limit < totalCount;
      return { items: videos, hasNext, nextCursor: null, totalCount };
    }
    const cursor = untilId && !untilId.includes('T') ? untilId : undefined;

    // 優先: api.feed.nicovideo.jp
    const feedResult = await tryFeedApi(limit, cursor);
    if (feedResult) return feedResult;

    // 次点: ニコレポAPI (通常は403でスキップ)
    const nicorepoResult = await tryNicorepoFeed(limit, cursor);
    if (nicorepoResult) return nicorepoResult;

    // フォールバック: フォローユーザー個別取得
    log.warn('feed/nicorepo API 全失敗、フォールバック実装を使用');
    const beforeDateISO = untilId && untilId.includes('T') ? untilId : undefined;
    return buildFeedFromFollowings(limit, beforeDateISO);
  }

  static async probeEndpoints(): Promise<ProbeResult[]> {
    const http = NicoContext.get().http;
    const ctx = NicoContext.get();
    const results: ProbeResult[] = [];

    // Cookie診断
    try {
      const wwwCookie = await ctx.cookieStore.cookieHeader('https://www.nicovideo.jp/');
      const feedCookie = await ctx.cookieStore.cookieHeader(`${FEED_API}/`);
      results.push({
        url: '--- Cookie診断 ---', status: 0, ok: !!wwwCookie,
        preview: [
          `www.nicovideo.jp  : ${wwwCookie ? `[あり] ${wwwCookie.length}文字` : '[なし]'}`,
          `api.feed.nicovideo: ${feedCookie ? `[あり] ${feedCookie.length}文字` : '[なし]'}`,
        ].join('\n')
      });
    } catch (e) {
      results.push({ url: '--- Cookie診断 ---', status: 0, ok: false, preview: String(e) });
    }

    // ログイン確認
    try {
      const res = await http.fetch('https://nvapi.nicovideo.jp/v1/users/me', { timeoutMs: 8000 });
      const text = await res.text();
      results.push({ url: 'nvapi /v1/users/me', status: res.status, ok: res.ok, preview: text.slice(0, 200) });
    } catch (e) {
      results.push({ url: 'nvapi /v1/users/me', status: 0, ok: false, preview: String(e) });
    }

    // api.feed.nicovideo.jp テスト (メインAPI)
    for (const [label, url] of [
      ['feed /v1/activities/followings/video', `${FEED_API}/v1/activities/followings/video?context=my_timeline&limit=2`],
      ['feed /v1/actors', `${FEED_API}/v1/actors?limit=5`],
      ['feed /v1/unread', `${FEED_API}/v1/unread`],
    ] as [string, string][]) {
      try {
        const res = await http.fetch(url, { timeoutMs: 8000, headers: { 'Accept': 'application/json', 'Origin': 'https://www.nicovideo.jp' } });
        const text = await res.text();
        results.push({ url: label, status: res.status, ok: res.ok, preview: text.slice(0, 300) });
      } catch (e) {
        results.push({ url: label, status: 0, ok: false, preview: String(e) });
      }
    }

    return results;
  }
}

function parseNicorepoEntries(entries: NicorepoEntry[]): SearchResultItem[] {
  return entries
    .filter((e) => e.object?.type === 'video' && e.object.url)
    .map((e) => {
      const obj = e.object!;
      const videoId = obj.url?.match(/\/watch\/((?:sm|nm|so|ss)\d+|\d+)/)?.[1] ?? '';
      if (!videoId) return null;
      return {
        videoId,
        title: obj.name ?? e.title ?? videoId,
        description: '',
        thumbnailUrl: obj.image ?? '',
        length: 0,
        viewCount: 0,
        commentCount: 0,
        mylistCount: 0,
        likeCount: 0,
        registeredAt: new Date(e.updated),
        tags: []
      } satisfies SearchResultItem;
    })
    .filter((x): x is SearchResultItem => x !== null);
}
