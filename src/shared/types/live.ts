import type { NgListItem, NNDDREComment } from './comment';

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
  /** 番組説明 (HTML) */
  description: string;
  tags: string[];
  /** 放送者 (ユーザー / チャンネル) */
  supplier: LiveSupplier | null;
  /** タイムシフト予約数 (分かる場合のみ) */
  timeshiftReservationCount?: number;
}

export interface LiveSupplier {
  /** user / channel 等 */
  type: string;
  /** ユーザーID またはチャンネルID */
  id: string;
  name: string;
  iconUrl: string;
  pageUrl: string;
  /** ユーザーレベル (ユーザー番組のみ) */
  level?: number;
}

export interface LiveStatistics {
  viewers: number;
  comments: number;
  adPoints?: number;
  giftPoints?: number;
  /** タイムシフト予約数 (コメントサーバーの state で届く。届くまで undefined) */
  timeshiftReservations?: number;
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

/** アンケート (NicoliveState.enquete)。Closed になったら LiveEvent 側で null を送る */
export interface LiveEnquete {
  question: string;
  choices: Array<{
    description: string;
    /** 得票率 (千分率)。Result のときだけ入る */
    perMille?: number;
  }>;
  /** poll: 投票中 / result: 結果表示 */
  status: 'poll' | 'result';
}

/** 放送者が指定するコメントの表示レイアウト (NicoliveState.comment_mode) */
export type LiveCommentLayout = 'normal' | 'splitTop' | 'background';

/** コメント投稿の制限 (NicoliveState.comment_lock) */
export interface LiveCommentLock {
  /** unrestricted: 制限なし / locked: 投稿不可 / restricted: 条件付き (フォロー期間など) */
  status: 'unrestricted' | 'locked' | 'restricted';
  /** restricted のとき、投稿に必要な最低フォロー期間 (秒) */
  minimumFollowSec?: number;
}

/** 放送者・モデレーターが登録した NG (SSNG) の追加/削除。削除は id だけ届くので id で管理する */
export interface LiveSsngUpdate {
  operation: 'add' | 'delete';
  id: string;
  /** add のとき、NG の内容 (種別が分からないものは入らない) */
  item?: NgListItem;
}

/** 番組の開始・終了予定 (視聴 WebSocket の schedule)。延長されると終了予定が変わる */
export interface LiveSchedule {
  beginMs: number;
  endMs: number;
}

/** 別番組への移動指示 (NicoliveState.move_order) */
export interface LiveMoveOrder {
  /** jump: 別番組へ移動 / redirect: URL へ移動 */
  kind: 'jump' | 'redirect';
  /** jump: 番組ID (lv...) / redirect: URL */
  target: string;
  message: string;
  /** 移動までの待ち時間 (ms) */
  waitMs: number;
}

/** クリエイターサポートの目標ゲージ (NicoliveState.creator_support_goal_status) */
export interface LiveCreatorSupport {
  rewardName: string;
  rewardDisplayName: string;
  /** 達成率 (0〜1) */
  progressRatio: number;
  currentPoint: number;
  lowerPoint: number;
  upperPoint: number;
  isAchieved: boolean;
}

/** ニコ生ゲーム (akashic) を動かすための、watch ページ由来の情報 */
export interface LiveAkashicInfo {
  /** この番組でニコ生ゲームが有効か (embedded-data の akashic.enabled) */
  enabled: boolean;
  /** 土台のゲーム (nicocas) の置き場 (site.coe.coeContentBaseUrl)。末尾は `/` */
  coeContentBaseUrl: string;
  /** ログイン中のユーザー。未ログインなら undefined */
  account?: { id: string; name: string; premium: boolean };
}

/** ニコ生ゲーム (akashic) のイベント 1 件。ゲームの実行基盤 (renderer) にそのまま渡す */
export interface LiveAkashicEvent {
  type: string;
  playId: string;
  ignorable?: boolean;
  transient?: boolean;
  parameters?: Record<string, unknown>;
}

/** ニコ生ゲーム (akashic) の状態更新 1 回分 (mpn の NicoliveState.akashic_state)。epoch の昇順に適用する */
export interface LiveAkashicBatch {
  epoch: number;
  /** 接続時の状態スナップショットから読んだものか。true なら join、false なら continuation を使う */
  snapshot: boolean;
  join: LiveAkashicEvent[];
  continuation: LiveAkashicEvent[];
  shared: LiveAkashicEvent[];
}

/** ニコ生ゲームの plugin (external.api) が呼ぶ HTTP 要求。main が Cookie を付けて送る */
export interface LiveAkashicApiRequest {
  url: string;
  method?: string;
  contentType?: string;
  queries?: Record<string, string>;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface LiveAkashicApiResponse {
  status: number;
  contentType?: string;
  body: unknown;
}

export type LiveEvent =
  | { type: 'state'; state: LiveConnectionState; message?: string }
  /** chasePlay: この stream が追っかけ再生 (通常 HLS) か低遅延 (LL-HLS) か */
  | { type: 'stream'; uri: string; quality: string; chasePlay: boolean; availableQualities: string[] }
  | { type: 'comments'; comments: NNDDREComment[] }
  /** タイムシフト: 過去コメントの取得分 (新しい区間から順に届く)。done=true で全件取得完了 */
  | { type: 'archiveComments'; comments: NNDDREComment[]; done: boolean }
  | { type: 'notice'; notice: LiveNotice }
  | { type: 'statistics'; statistics: LiveStatistics }
  /** 追っかけ再生を使えなかったため通常のライブ視聴に切り替えた */
  | { type: 'chasePlayUnavailable' }
  /** 視聴権限が無くなった (チャンネル会員限定部分への到達など)。renderer がポップアップで知らせる */
  | { type: 'accessRestricted'; message: string }
  | { type: 'trialPanel'; atMs: number; restricted: boolean }
  /** 運営コメント (画面上部に固定表示するもの)。null で消去 */
  | { type: 'operatorComment'; notice: LiveNotice | null }
  /** アンケート。null で消去 */
  | { type: 'enquete'; enquete: LiveEnquete | null }
  | { type: 'commentLayout'; layout: LiveCommentLayout }
  | { type: 'commentLock'; lock: LiveCommentLock }
  /** 番組タグの更新 (全件) */
  | { type: 'tags'; tags: string[] }
  | { type: 'ssng'; update: LiveSsngUpdate }
  | { type: 'schedule'; schedule: LiveSchedule }
  | { type: 'moveOrder'; order: LiveMoveOrder }
  /** クリエイターサポートの目標ゲージ。null で非表示 */
  | { type: 'creatorSupport'; support: LiveCreatorSupport | null }
  /** ニコ生ゲーム (クルーズの行き先投票など) の状態更新 */
  | { type: 'akashic'; batch: LiveAkashicBatch };

/** LIVE_START の戻り値 */
export interface LiveStartResult {
  program: LiveProgramInfo;
  /** タイムシフト視聴か */
  isTimeshift: boolean;
  /** 追っかけ再生で視聴しているか (放送中のみ)。通常は低遅延の false で始まる */
  chasePlay: boolean;
  /** 追っかけ再生へ切り替えられるか (放送中・プレミアム会員) */
  chasePlayAvailable: boolean;
  /**
   * 過去コメントの取得方法。
   * all: 開いたときに全件をバックグラウンドで取得 / seek: コメントが多いので再生位置の周辺だけ取得
   */
  commentFetchMode: 'all' | 'seek';
  /** ニコ生ゲーム (クルーズの行き先投票など) の実行に必要な情報 */
  akashic: LiveAkashicInfo;
  /**
   * NCV を起動した (起動予定の) か。NCV 連携 ON で開いた場合だけ入る。
   * タイムシフトでは設定 live.ncvTimeshift が OFF なら起動しない
   */
  ncvLaunched?: boolean;
}

/** LIVE_FETCH_COMMENTS_AROUND の戻り値: 取得できた範囲 (番組の vpos 基準、ms) */
export interface LiveCommentRange {
  fromVposMs: number;
  toVposMs: number;
}

/** タイムシフトの公開・視聴回数設定 (番組一覧のカードに視聴可否・期限を出すための値) */
export interface LiveTimeshiftSetting {
  /** BEFORE_OPEN (公開前) / OPENED / CLOSED (公開終了) */
  status: string;
  /** UNLIMITED (何回でも) / ONCE (1回のみ。視聴開始後は視聴チケットの期限まで) */
  watchLimit: string;
  /** 公開終了日時 (unix ms)。無期限なら undefined */
  publicationEndMs?: number;
  /** 視聴チケットの期限 (unix ms)。視聴を開始していなければ undefined */
  ticketExpireMs?: number;
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
  /** タイムシフトの視聴期限 (unix ms)。予約一覧で分かる場合のみ */
  timeshiftViewingLimitMs?: number;
  /** タイムシフトの公開・視聴回数設定。タイムシフト予約一覧で分かる場合のみ */
  timeshiftSetting?: LiveTimeshiftSetting;
  /** タイムシフト予約に対応した番組か (分かる場合のみ。false なら予約ボタンを出さない) */
  timeshiftEnabled?: boolean;
}

export interface LiveProgramListResult {
  programs: LiveProgramSummary[];
  total: number;
}

/** 番組検索の1ページの件数 */
export const LIVE_SEARCH_PAGE_SIZE = 100;

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

/** アニメ生放送 (anime.nicovideo.jp/live) の取得条件 */
export interface LiveAnimeParams {
  /** reserved: 放送中・放送予定 / past: 見逃し配信 */
  scope: 'reserved' | 'past';
  /** all: 全て / regular: 今期最新話 / ikkyo: 一挙放送 / tokuban: 声優特番 */
  kind: 'all' | 'regular' | 'ikkyo' | 'tokuban';
}

export interface LiveAnimeResult extends LiveProgramListResult {
  isLoggedIn: boolean;
  /** プレミアム会員か。ログイン済みでも判定できなかった場合は null */
  isPremium: boolean | null;
}

/** ランキングの種類 (live.nicovideo.jp/ranking の type) */
export interface LiveRankingParams {
  type: 'onair' | 'comingsoon' | 'closed';
  /** closed のときの対象日 (YYYYMMDD)。省略時は当日 */
  date?: string;
}

/** コメントリストの1行 (コメント or 運営コメント・通知等)。vposMs 昇順で並べる */
export interface LiveListItem {
  key: string;
  /** 番組の vpos 基準時刻からの経過 (ms) */
  vposMs: number;
  comment?: NNDDREComment;
  notice?: LiveNotice;
}

/** 生放送プレイヤー → (main 経由) → コメントウィンドウ */
export type LiveCommentWindowMessage =
  /** 開いた直後の全件。以降は append で差分を送る */
  | {
      type: 'snapshot';
      items: LiveListItem[];
      program: LiveProgramInfo | null;
      statistics: LiveStatistics | null;
      canSeek: boolean;
      /** 放送者が登録した NG (SSNG)。コメントウィンドウでも自分の NG リストに足して適用する */
      ssngList: NgListItem[];
    }
  | { type: 'append'; items: LiveListItem[] }
  /** 今映っている位置 (番組の vpos 基準、ms) */
  | { type: 'position'; vposMs: number }
  | { type: 'statistics'; statistics: LiveStatistics }
  /** SSNG の全件 (追加・削除のたびに送り直す) */
  | { type: 'ssng'; ssngList: NgListItem[] };

/** コメントウィンドウ・main → 生放送プレイヤー */
export type LiveCommentWindowEvent =
  /** コメントウィンドウの準備完了 (snapshot を送ってほしい) */
  | { type: 'ready' }
  | { type: 'seek'; vposMs: number }
  /** コメントウィンドウが閉じられた */
  | { type: 'closed' };

/**
 * 録画予約。放送予定の番組を、開始時刻に自動で録画する。
 * アプリ (トレイ常駐含む) が起動している間だけ動く。
 */
export interface LiveRecordReservation {
  programId: string;
  title: string;
  /** 一覧で見えていたサムネイル (録画の保存に使う) */
  thumbnailUrl: string;
  ownerName: string;
  /** 放送開始・終了の予定 (unix ms)。終了が分からなければ 0 */
  beginAtMs: number;
  endAtMs: number;
  /** 予約した時刻 (unix ms) */
  reservedAtMs: number;
}

/** 録画予約の追加に必要な項目 (予約時刻は main が付ける) */
export type LiveRecordReserveRequest = Omit<LiveRecordReservation, 'reservedAtMs'>;
