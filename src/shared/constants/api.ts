/**
 * ニコニコ動画 新API (V3 DMS) 用エンドポイント定義。
 * 元: Niconicome-develop の APIConstant.cs / NetConstant.cs
 */

export const NicoApi = {
  /** 動画ウォッチページ */
  WATCH_PAGE: 'https://www.nicovideo.jp/watch/',
  /** 動画ウォッチページ (短縮) */
  WATCH_PAGE_SHORT: 'https://nicovideo.jp/watch/',

  /** トップページ (ログイン後リダイレクト先) */
  TOP: 'https://www.nicovideo.jp/',

  /** ログインページ */
  LOGIN: 'https://account.nicovideo.jp/login',
  /** ログイン送信URL */
  LOGIN_POST:
    'https://account.nicovideo.jp/api/v1/login?site=niconico&next_url=%2F',
  /** ログアウトURL */
  LOGOUT: 'https://secure.nicovideo.jp/secure/logout',

  /** DMS の heartbeat / セッション関連 */
  DMC_SESSION_BASE: 'https://api.dmc.nico/api/sessions/',

  /** スレッド (コメント) API (V3) */
  COMMENT_THREADS_V3: 'https://nvcomment.nicovideo.jp/v1/threads',

  /** マイリストAPI (V2) */
  MYLIST_API_BASE: 'https://nvapi.nicovideo.jp/v1/users/me/mylists',
  /** 他人マイリスト */
  PUBLIC_MYLIST_API: 'https://nvapi.nicovideo.jp/v2/mylists/',
  /** ウォッチレイター */
  WATCH_LATER_API: 'https://nvapi.nicovideo.jp/v1/users/me/watch-later',

  /** 検索API (V2 スナップショット形式) */
  SEARCH_API:
    'https://snapshot.search.nicovideo.jp/api/v2/snapshot/video/contents/search',

  /** ユーザー投稿動画 */
  USER_VIDEOS_API: 'https://nvapi.nicovideo.jp/v3/users/',
  /** チャンネル動画 (ページHTMLから) */
  CHANNEL_VIDEOS_BASE: 'https://ch.nicovideo.jp/',

  /** シリーズAPI */
  SERIES_API: 'https://nvapi.nicovideo.jp/v1/series/',

  /** サムネイル情報 (旧) */
  THUMB_INFO: 'https://ext.nicovideo.jp/api/getthumbinfo/',

  /** ランキング (RSS) */
  RANKING_RSS: 'https://www.nicovideo.jp/ranking/',

  /** ニコニコ市場 */
  ICHIBA_EMBED: 'https://ichiba.nicovideo.jp/embed/nicovideo_watch_detail/',

  /** Public API ベース */
  PUBLIC_API_BASE: 'https://public.api.nicovideo.jp',
  /** 自分のユーザー情報 */
  MY_USER_INFO: 'https://public.api.nicovideo.jp/v2/user.json',
  /**
   * ニコレポ/フォロー新着
   * /v1/timelines/nicorepo/{term}/users/{userId}/pc/entries.json
   */
  NICOREPO_BASE: 'https://public.api.nicovideo.jp/v1/timelines/nicorepo'
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
  X_CLIENT_OS_TYPE: 'others',
  X_NICONICO_LANGUAGE: 'ja-jp'
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
