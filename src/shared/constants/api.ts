/**
 * ニコニコ動画 新API (V3 DMS) 用エンドポイント定義。
 * 元: Niconicome-develop の APIConstant.cs / NetConstant.cs
 */

export const NicoApi = {
  /** 動画ウォッチページ */
  WATCH_PAGE: 'https://www.nicovideo.jp/watch/',

  /** トップページ (ログイン後リダイレクト先) */
  TOP: 'https://www.nicovideo.jp/',
  /** www.nicovideo.jp のオリジン (末尾スラッシュなし。Origin / X-Request-With ヘッダーにも使う) */
  WWW_BASE: 'https://www.nicovideo.jp',

  /** ユーザーページ */
  USER_PAGE: 'https://www.nicovideo.jp/user/',
  /** マイリストページ */
  MYLIST_PAGE: 'https://www.nicovideo.jp/my/mylist/',
  /** シリーズページ */
  SERIES_PAGE: 'https://www.nicovideo.jp/series/',

  /** アカウント (ログイン) サイトのオリジン */
  ACCOUNT_BASE: 'https://account.nicovideo.jp',

  /** ログインページ */
  LOGIN: 'https://account.nicovideo.jp/login',
  /** セッション削除 (ログアウト) API。DELETE。Origin ヘッダ必須 */
  LOGOUT: 'https://api.id.nicovideo.jp/v1/sessions/me',
  /** アカウントSPA (api.id) 呼び出し用の X-Frontend-Id / X-Frontend-Version */
  ACCOUNT_FRONTEND_ID: '8',
  ACCOUNT_FRONTEND_VERSION: '2',

  /** DMC (旧 HLS セッション API) のオリジン */
  DMC_API_BASE: 'https://api.dmc.nico',

  /** コメントサーバー (nvComment) のオリジン */
  NVCOMMENT_BASE: 'https://public.nvcomment.nicovideo.jp',

  /** nvapi のオリジン */
  NVAPI_BASE: 'https://nvapi.nicovideo.jp',

  /** 検索API (スナップショット形式) のオリジン */
  SEARCH_SNAPSHOT_BASE: 'https://snapshot.search.nicovideo.jp',

  /** チャンネル動画 (ページHTMLから) */
  CHANNEL_VIDEOS_BASE: 'https://ch.nicovideo.jp/',
  /** チャンネルアイコン CDN のオリジン */
  CHANNEL_ICON_BASE: 'https://secure-dcdn.cdn.nimg.jp',

  /** サムネイル情報 (旧) API のオリジン */
  EXT_BASE: 'https://ext.nicovideo.jp',

  /** Cookie 注入 (ses.cookies.set) 用の URL。www. 無しのホストで固定 */
  COOKIE_URL: 'https://nicovideo.jp/',

  /** api.nicovideo.jp のオリジン (旧ニコレポ等) */
  API_BASE: 'https://api.nicovideo.jp',
  /** フォローフィードAPI のオリジン */
  FEED_API_BASE: 'https://api.feed.nicovideo.jp',

  /** 生放送サイトのオリジン */
  LIVE_BASE: 'https://live.nicovideo.jp',
  /** 生放送ウォッチページ */
  LIVE_WATCH_PAGE: 'https://live.nicovideo.jp/watch/',
  /** 生放送API (タイムシフト予約等) のオリジン */
  LIVE2_API_BASE: 'https://live2.nicovideo.jp',
  /** 生放送 番組検索API のオリジン */
  CAS_API_BASE: 'https://api.cas.nicovideo.jp'
} as const;

/**
 * 必須HTTPヘッダー (Niconicome-develop NicoHttp.cs 参照)
 */
export const NicoHeaders = {
  USER_AGENT:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  REFERER: 'https://www.nicovideo.jp/',
  X_FRONTEND_ID: '6',
  X_FRONTEND_VERSION: '0',
  /** live.nicovideo.jp (PC Web) の X-Frontend-Id */
  LIVE_FRONTEND_ID: '9',
  X_CLIENT_OS_TYPE: 'others',
  X_NICONICO_LANGUAGE: 'ja-jp'
} as const;

/** URLSearchParams または組み立て済みのクエリ文字列 (先頭の ? は含めない) */
type Query = URLSearchParams | string;

const enc = encodeURIComponent;

/**
 * ニコニコ API のエンドポイント定義。パス・バージョン・固定クエリはここだけに持ち、
 * 仕様変更時はこのファイルだけを直せば済むようにする (画面 URL は utils/nicoUrl.ts)。
 */
export const NicoEndpoint = {
  /** 自分のマイリスト一覧 */
  myMylists: () => `${NicoApi.NVAPI_BASE}/v1/users/me/mylists`,
  /** 自分のマイリストのアイテム (非公開含む) */
  myMylist: (mylistId: string, pageSize: number, page: number) =>
    `${NicoApi.NVAPI_BASE}/v1/users/me/mylists/${enc(mylistId)}?pageSize=${pageSize}&page=${page}`,
  /** 公開マイリストのアイテム */
  publicMylist: (mylistId: string, pageSize: number, page: number) =>
    `${NicoApi.NVAPI_BASE}/v2/mylists/${enc(mylistId)}?pageSize=${pageSize}&page=${page}`,
  /** ウォッチレイター (追加 POST 用) */
  watchLater: () => `${NicoApi.NVAPI_BASE}/v1/users/me/watch-later`,
  /** ウォッチレイター一覧 */
  watchLaterList: (pageSize: number) =>
    `${NicoApi.NVAPI_BASE}/v1/users/me/watch-later?pageSize=${pageSize}&sortKey=addedAt&sortOrder=desc`,

  /** 自分のユーザー情報 */
  me: () => `${NicoApi.NVAPI_BASE}/v1/users/me`,
  /** ユーザー情報 */
  user: (userId: string) => `${NicoApi.NVAPI_BASE}/v1/users/${enc(userId)}`,
  /** ユーザーのマイリスト一覧 */
  userMylists: (userId: string) => `${NicoApi.NVAPI_BASE}/v1/users/${enc(userId)}/mylists`,
  /** ユーザーのシリーズ一覧 */
  userSeries: (userId: string) => `${NicoApi.NVAPI_BASE}/v1/users/${enc(userId)}/series`,
  /** ユーザー投稿動画 */
  userVideos: (userId: string, query: Query) =>
    `${NicoApi.NVAPI_BASE}/v3/users/${enc(userId)}/videos?${query}`,
  /** フォロー中ユーザー一覧 */
  followingUsers: (userId: string, query: Query) =>
    `${NicoApi.NVAPI_BASE}/v1/users/${enc(userId)}/following/users?${query}`,
  /** 動画情報の一括取得 (ids はカンマ区切り) */
  videosByIds: (ids: string) => `${NicoApi.NVAPI_BASE}/v1/videos?ids=${enc(ids)}`,
  /** 視聴履歴 */
  watchHistory: (query: Query) => `${NicoApi.NVAPI_BASE}/v2/users/me/watch/history?${query}`,
  /** シリーズ (動画一覧つき) */
  series: (seriesId: string, pageSize: number, page: number) =>
    `${NicoApi.NVAPI_BASE}/v2/series/${enc(seriesId)}?pageSize=${pageSize}&page=${page}`,
  /** 関連動画 (レコメンド) */
  recommend: (videoId: string) =>
    `${NicoApi.NVAPI_BASE}/v1/recommend?recipeId=video_watch_recommendation&videoId=${enc(videoId)}&site=nicovideo&_frontendId=${NicoHeaders.X_FRONTEND_ID}&_frontendVersion=${NicoHeaders.X_FRONTEND_VERSION}`,

  /** 視聴ページの lazy 取得 (シリーズ情報など) */
  watchLazy: (videoId: string, actionTrackId: string) =>
    `${NicoApi.NVAPI_BASE}/v4/watch/lazy/${enc(videoId)}?actionTrackId=${enc(actionTrackId)}`,
  /** 視聴ページ JSON API (ログイン時 v3 / 未ログイン時 v3_guest) */
  watchApi: (endpoint: 'v3' | 'v3_guest', videoId: string, actionTrackId: string) =>
    `${NicoApi.WWW_BASE}/api/watch/${endpoint}/${enc(videoId)}?actionTrackId=${actionTrackId}`,
  /** DMS の HLS セッション確立 (POST) */
  watchAccessRightsHls: (videoId: string, actionTrackId: string) =>
    `${NicoApi.NVAPI_BASE}/v1/watch/${enc(videoId)}/access-rights/hls?actionTrackId=${actionTrackId}`,

  /** DMC (旧 HLS) セッション作成 */
  dmcSessions: () => `${NicoApi.DMC_API_BASE}/api/sessions?_format=json`,
  /** DMC セッションの heartbeat */
  dmcSessionHeartbeat: (sessionId: string) =>
    `${NicoApi.DMC_API_BASE}/api/sessions/${enc(sessionId)}?_format=json&_method=PUT`,

  /** コメントサーバーのスレッド取得 (serverUrl は動画ごとに watch 情報から得る) */
  commentThreads: (serverUrl: string) => `${serverUrl.replace(/\/$/, '')}/v1/threads`,

  /** 検索 (スナップショット形式、日次更新) */
  searchSnapshot: (query: Query) =>
    `${NicoApi.SEARCH_SNAPSHOT_BASE}/api/v2/snapshot/video/contents/search?${query}`,
  /** 検索 (nvapi、ほぼリアルタイム。タグ情報は含まない) */
  searchNvapi: (query: Query) => `${NicoApi.NVAPI_BASE}/v2/search/video?${query}`,
  /** サムネイル情報 (旧 getthumbinfo, XML) */
  thumbInfo: (videoId: string) => `${NicoApi.EXT_BASE}/api/getthumbinfo/${videoId}`,

  /** ランキング (ジャンル別。featuredKey はジャンルページのキー) */
  rankingGenre: (featuredKey: string, query: Query) =>
    `${NicoApi.WWW_BASE}/ranking/genre/${enc(featuredKey)}?${query}`,
  /** 話題のランキング (nvapi) */
  rankingHotTopic: (genre: string) =>
    `${NicoApi.NVAPI_BASE}/v1/ranking/hot-topic?genre=${enc(genre)}&pageSize=100`,
  /** 話題のランキング (RSS) */
  rankingHotTopicRss: (genre: string) =>
    `${NicoApi.WWW_BASE}/ranking/hot-topic?genre=${enc(genre)}&rss=2.0&lang=ja-jp`,

  /** チャンネル動画一覧ページ (HTML) */
  channelVideos: (channelId: string, page: number) =>
    `${NicoApi.CHANNEL_VIDEOS_BASE}${enc(channelId)}/video?sort=f&order=d&page=${page}`,
  /** チャンネルアイコン (channelId は ch 接頭辞なしの数字) */
  channelIcon: (channelId: string | number | null | undefined) =>
    `${NicoApi.CHANNEL_ICON_BASE}/comch/channel-icon/128x128/ch${channelId}.jpg`,

  /** フォローフィード (api.feed) の新着動画 */
  feedFollowingVideos: (query: Query) =>
    `${NicoApi.FEED_API_BASE}/v1/activities/followings/video?${query}`,
  /** フォロー中アクター一覧 (api.feed) */
  feedActors: (limit: number) => `${NicoApi.FEED_API_BASE}/v1/actors?limit=${limit}`,
  /** 未読状態 (api.feed) */
  feedUnread: () => `${NicoApi.FEED_API_BASE}/v1/unread`,
  /** ニコレポ (自分、ユーザーID不要) */
  nicorepoMy: (term: string, query: Query) =>
    `${NicoApi.API_BASE}/v1/timelines/nicorepo/${term}/my/pc/entries.json?${query}`,
  /** ニコレポ (ユーザーID指定) */
  nicorepoUser: (term: string, userId: string, query: Query) =>
    `${NicoApi.API_BASE}/v1/timelines/nicorepo/${term}/users/${enc(userId)}/pc/entries.json?${query}`,

  /** 生放送: タイムシフト予約 (POST 予約 / PATCH 視聴開始) */
  liveTimeshiftReservation: (programId: string) =>
    `${NicoApi.LIVE2_API_BASE}/api/v2/programs/${programId}/timeshift/reservation`,
  /** 生放送: タイムシフト予約の一括解除 (DELETE) */
  liveTimeshiftReservations: (programIds: string[]) =>
    `${NicoApi.LIVE2_API_BASE}/api/v2/timeshift/reservations?programIds=${programIds.join(',')}`,
  /** 生放送: 番組検索 (CAS) */
  liveSearchPrograms: (query: Query) => `${NicoApi.CAS_API_BASE}/v2/search/programs.json?${query}`,
  /** 生放送: フォロー中の番組 (onair) */
  liveFollowPrograms: (status: string, offset: number) =>
    `${NicoApi.LIVE_BASE}/front/api/pages/follow/v1/programs?status=${status}&offset=${offset}`,
  /** 生放送: カテゴリ別の放送中番組 */
  liveRecentPrograms: (query: Query) =>
    `${NicoApi.LIVE_BASE}/front/api/pages/recent/v1/programs?${query}`
} as const;

/**
 * デフォルトヘッダーをオブジェクトとして返す。
 * fetch / axios どちらでもそのまま使える。
 */
export function buildDefaultHeaders(): Record<string, string> {
  return {
    'User-Agent': NicoHeaders.USER_AGENT,
    Referer: NicoHeaders.REFERER,
    'X-Frontend-Id': NicoHeaders.X_FRONTEND_ID,
    'X-Frontend-Version': NicoHeaders.X_FRONTEND_VERSION,
    'X-Client-Os-Type': NicoHeaders.X_CLIENT_OS_TYPE,
    'X-Niconico-Language': NicoHeaders.X_NICONICO_LANGUAGE
  };
}

/**
 * ニコニコの認証Cookie名
 */
export const NicoAuthCookieName = {
  USER_SESSION: 'user_session',
  USER_SESSION_SECURE: 'user_session_secure'
} as const;

/**
 * ニコニコの Cookie ドメイン
 */
export const NICO_COOKIE_DOMAIN = '.nicovideo.jp';
