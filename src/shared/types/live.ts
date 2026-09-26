import type { NNDDREComment } from './comment';

/**
 * ニコニコ生放送 関連の型。
 * main (LiveSession) → renderer (LivePlayerApp) へ LIVE_EVENT で送るイベント等。
 */

/** 番組の放送状態 (watchページ embedded-data の program.status) */
export type LiveProgramStatus = 'ON_AIR' | 'ENDED' | 'RELEASED' | string;

export interface LiveProgramInfo {
  /** 番組ID (lv123...) */
  programId: string;
  title: string;
  status: LiveProgramStatus;
  /** 提供元種別 (community / channel / official) */
  providerType: string;
  /** 放送者/提供者名 */
  supplierName: string;
  /** 開始・終了時刻 (unix ms) */
  beginTimeMs: number;
  endTimeMs: number;
  /** コメント vpos の基準時刻 (unix ms) */
  vposBaseTimeMs: number;
  /** サムネイル URL (無ければ空) */
  thumbnailUrl: string;
  /** 追っかけ再生 (放送中に過去へ巻き戻して視聴) に対応しているか */
  chasePlayEnabled: boolean;
  /** watchページ取得時点のコメント数 */
  commentCount: number;
}

export interface LiveStatistics {
  viewers: number;
  comments: number;
  adPoints?: number;
  giftPoints?: number;
}

/** 生放送プレイヤーの接続状態 */
export type LiveConnectionState = 'connecting' | 'watching' | 'reconnecting' | 'ended' | 'error';

/** コメントリスト表示用の非コメント行 (運営コメント・通知・ギフト等) */
export interface LiveNotice {
  kind: 'operator' | 'notification' | 'gift' | 'nicoad';
  text: string;
  /** 受信時刻 (unix ms) */
  at: number;
  link?: string;
}

export type LiveEvent =
  | { type: 'state'; state: LiveConnectionState; message?: string }
  | { type: 'stream'; uri: string; quality: string; availableQualities: string[] }
  | { type: 'comments'; comments: NNDDREComment[] }
  /** タイムシフト: 過去コメントの取得分 (新しい区間から順に届く)。done=true で全件取得完了 */
  | { type: 'archiveComments'; comments: NNDDREComment[]; done: boolean }
  | { type: 'notice'; notice: LiveNotice }
  | { type: 'statistics'; statistics: LiveStatistics }
  /** 運営コメント (画面上部に固定表示するもの)。null で消去 */
  | { type: 'operatorComment'; notice: LiveNotice | null };

/** LIVE_START の戻り値 */
export interface LiveStartResult {
  program: LiveProgramInfo;
  /** タイムシフト視聴か */
  isTimeshift: boolean;
  /** 追っかけ再生で視聴しているか (放送中のみ) */
  chasePlay: boolean;
  /**
   * 過去コメントの取得方法。
   * all: 開いたときに全件をバックグラウンドで取得 / seek: コメントが多いので再生位置の周辺だけ取得
   */
  commentFetchMode: 'all' | 'seek';
}

/** LIVE_FETCH_COMMENTS_AROUND の戻り値: 取得できた範囲 (番組の vpos 基準、ms) */
export interface LiveCommentRange {
  fromVposMs: number;
  toVposMs: number;
}

/** 番組一覧 (フォロー中・検索・タイムシフト予約) の1件 */
export interface LiveProgramSummary {
  programId: string;
  title: string;
  thumbnailUrl: string;
  /** ON_AIR / RELEASED (放送前) / ENDED */
  status: string;
  beginAtMs: number;
  endAtMs: number;
  viewers?: number;
  comments?: number;
  /** 放送者・コミュニティ・チャンネル名 */
  ownerName: string;
  ownerIconUrl: string;
  providerType: string;
  isMemberOnly: boolean;
  /** タイムシフトが視聴可能か (分かる場合のみ) */
  timeshiftPlayable?: boolean;
}

export interface LiveProgramListResult {
  programs: LiveProgramSummary[];
  total: number;
}

/** 番組検索の条件 */
export interface LiveSearchParams {
  keyword: string;
  /** onair: 放送中 / reserved: 放送予定 / past: 過去 */
  liveStatus: 'onair' | 'reserved' | 'past';
  sort: 'startTime' | 'viewCounter' | 'commentCounter';
  order: 'asc' | 'desc';
  offset: number;
}

/** 生放送ランキング (live.nicovideo.jp/ranking) */
export interface LiveRankingResult {
  /** 公式・チャンネル番組 */
  official: LiveProgramSummary[];
  /** ユーザー番組 */
  user: LiveProgramSummary[];
}

/** 放送中番組のカテゴリ (live.nicovideo.jp/recent の tab) */
export type LiveRecentCategory = 'common' | 'try' | 'live' | 'req' | 'face' | 'totu' | 'vtuber';

/** カテゴリ別の放送中番組の取得条件 */
export interface LiveRecentParams {
  category: LiveRecentCategory;
  sortOrder:
    | 'recentDesc'
    | 'recentAsc'
    | 'viewCountDesc'
    | 'commentCountDesc'
    | 'userLevelDesc';
  /** ページ番号 (0 始まり、1 ページ 70 件) */
  page: number;
}

/** ランキングの種類 (live.nicovideo.jp/ranking の type) */
export interface LiveRankingParams {
  type: 'onair' | 'comingsoon' | 'closed';
  /** closed のときの対象日 (YYYYMMDD)。省略時は当日 */
  date?: string;
}
