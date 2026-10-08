// 検索: snapshot API v2 (api.search.nicovideo.jp)
export interface NicoSnapshotV2Response {
  meta: { status: number; totalCount: number; id: string };
  data: NicoSnapshotV2Item[];
}

export interface NicoSnapshotV2Item {
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

// 検索: nvapi /v2/search/video
export interface NicoNvapiSearchResponse {
  meta: { status: number };
  data: {
    totalCount: number;
    items: NicoNvapiSearchItem[];
  };
}

export interface NicoNvapiSearchItem {
  id: string;
  title: string;
  shortDescription?: string;
  thumbnail: { url: string; middleUrl?: string };
  duration: number;
  registeredAt: string;
  count: { view: number; comment: number; mylist: number; like: number };
  isChannelVideo?: boolean;
  /** プレミアム会員向けの動画なら true。キー名は難読化されており仕様ではない (watch の payment.video.isPremium と一致することを実測) */
  acf68865?: boolean;
  owner?: {
    ownerType?: 'user' | 'channel' | string;
    id: string;
    name: string;
    iconUrl: string;
  } | null;
}

// ランキング: www.nicovideo.jp/ranking BFF (?responseType=json)
export interface NicoBffRankingItem {
  id: string;
  title: string;
  registeredAt?: string;
  duration?: number;
  thumbnail?: { url?: string; middleUrl?: string; largeUrl?: string };
  count?: { view?: number; comment?: number; mylist?: number; like?: number };
  shortDescription?: string;
  owner?: { id?: string; name?: string; iconUrl?: string; ownerType?: string };
  isChannelVideo?: boolean;
  /** プレミアム会員向けの動画なら true。キー名は難読化されており仕様ではない (watch の payment.video.isPremium と一致することを実測) */
  acf68865?: boolean;
  requireSensitiveMasking?: boolean;
}

export interface NicoBffFeaturedKeyItem {
  featuredKey: string;
  label: string;
  isEnabledTrendTag?: boolean;
  isTopLevel?: boolean;
  isImmoral?: boolean;
  isEnabled?: boolean;
}

export interface NicoBffRankingResponse {
  data?: {
    response?: {
      $getTeibanRanking?: {
        data?: {
          items?: NicoBffRankingItem[];
          hasNext?: boolean;
        };
      };
      $getTeibanRankingFeaturedKeyAndTrendTags?: {
        data?: {
          trendTags?: string[];
        };
      };
      $getTeibanRankingFeaturedKeys?: {
        data?: {
          items?: NicoBffFeaturedKeyItem[];
        };
      };
    };
  };
}

// フォロー: api.feed.nicovideo.jp (フィード)
export interface NicoFeedActor {
  id: string;
  type: 'user' | 'channel';
  name: string;
  iconUrl: string;
  url: string;
  isLive: boolean;
  isUnread?: boolean;
}

export interface NicoFeedActivity {
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
  actor?: NicoFeedActor;
}

export interface NicoFeedActivitiesResponse {
  code: string;
  activities: NicoFeedActivity[];
  nextCursor?: string;
  impressionId?: string;
}

export interface NicoFeedActorsResponse {
  code: string;
  actors: NicoFeedActor[];
}

// フォロー: ニコレポ (public.api.nicovideo.jp)
export interface NicoNicorepoEntry {
  id: string;
  updated: string;
  actor?: { name?: string; url?: string; iconUrl?: string };
  title?: string;
  object?: { type?: string; url?: string; name?: string; image?: string };
}

export interface NicoNicorepoResponse {
  meta?: { status?: number; hasNext?: boolean; maxId?: string; minId?: string };
  data?: NicoNicorepoEntry[];
}

// フォロー: nvapi フォロー中ユーザー・投稿動画一覧
export interface NicoNvapiUser {
  id: number | string;
  nickname?: string;
}

export interface NicoNvapiFollowingUser {
  id?: number | string;
  nickname?: string;
  icons?: { small?: string; large?: string };
}

export interface NicoNvapiFollowingResponse {
  meta?: { status?: number };
  data?: {
    items?: NicoNvapiFollowingUser[];
    summary?: {
      followees?: number;
      followers?: number;
      hasNext?: boolean;
      cursor?: string;
    };
  };
}

export interface NicoNvapiVideoEssential {
  id?: string;
  title?: string;
  thumbnail?: { url?: string; middleUrl?: string };
  registeredAt?: string;
  count?: { view?: number; comment?: number; mylist?: number; like?: number };
  duration?: number;
}

export interface NicoNvapiVideoItem {
  essential?: NicoNvapiVideoEssential;
}

export interface NicoNvapiVideosResponse {
  meta?: { status?: number };
  data?: {
    items?: NicoNvapiVideoItem[];
    totalCount?: number;
  };
}

export interface NicoNvapiVideoBulkItem {
  id?: string;
  title?: string;
  thumbnail?: { url?: string; middleUrl?: string };
  registeredAt?: string;
  count?: { view?: number; comment?: number; mylist?: number; like?: number };
  duration?: number;
}

export interface NicoNvapiVideoBulkResponse {
  meta?: { status?: number };
  data?: { videos?: NicoNvapiVideoBulkItem[] };
}

// コメント: nv-comment V3 API
export interface NicoV3CommentResponse {
  data?: {
    threads?: Array<{
      id: string;
      fork: string;
      commentCount?: number;
      comments?: NicoV3CommentItem[];
    }>;
  };
  meta?: {
    status: number;
    errorCode?: string;
  };
}

export interface NicoV3CommentItem {
  id: string;
  no: number;
  vposMs: number;
  body: string;
  commands?: string[];
  userId: string;
  isPremium?: boolean;
  isMyPost?: boolean;
  nicoruCount?: number;
  score?: number;
  postedAt?: string;
  source?: string;
}

// 視聴履歴: nvapi /v2/users/me/watch/history
export interface NicoNvapiWatchHistoryResponse {
  meta?: { status?: number; errorCode?: string };
  data?: {
    items?: Array<{
      viewedAt?: string;
      video: {
        id: string;
        title: string;
        thumbnail?: { url?: string };
      };
    }>;
    nextCursor?: string;
  };
}

// マイリスト: nvapi /v2/mylists
export interface NicoNvapiMylistResponse {
  meta?: { status?: number; errorCode?: string };
  data?: {
    mylist?: {
      id: string;
      name: string;
      description?: string;
      items?: NicoNvapiMylistItem[];
      totalItemCount?: number;
    };
    // 一部レスポンスは items を data 直下に持つ
    items?: NicoNvapiMylistItem[];
  };
}

export interface NicoNvapiMylistItem {
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

// シリーズ: nvapi /v2/series
export interface NicoSeriesVideo {
  id: string;
  title: string;
  thumbnail?: { url?: string | { listingMedium?: string } };
  duration?: number;
  count?: { view?: number; comment?: number; mylist?: number; like?: number };
  registeredAt?: string;
}

export interface NicoSeriesResponse {
  meta?: { status?: number };
  data?: {
    detail?: { title?: string; description?: string };
    totalCount?: number;
    items?: Array<{ video: NicoSeriesVideo }>;
  };
}

// 共通: エラーレスポンス body の meta
/**
 * ニコニコAPIがエラーレスポンス (4xx) の body に埋め込む meta 情報。
 * 例: { meta: { status: 404, errorCode: "NOT_FOUND" } }
 */
export interface NicoApiErrorBody {
  meta?: {
    status?: number;
    errorCode?: string;
    errorMessage?: string;
  };
}


// 生放送: フォロー中 (live.nicovideo.jp/front/api/pages/follow) とカテゴリ別放送中 (recent) API の番組
export interface NicoLiveFollowProgram {
  id?: string;
  title?: string;
  listingThumbnail?: string;
  liveCycle?: string;
  beginAt?: number;
  endAt?: number;
  statistics?: { watchCount?: number; commentCount?: number };
  socialGroup?: { name?: string; thumbnailUrl?: string };
  programProvider?: { name?: string; icon?: string };
  providerType?: string;
  isFollowerOnly?: boolean;
  isPayProgram?: boolean;
  timeshift?: { isPlayable?: boolean };
}

export interface NicoLiveFollowResponse {
  data?: { programs?: NicoLiveFollowProgram[]; total?: number };
}

export interface NicoLiveRecentResponse {
  meta?: { totalCount?: number };
  data?: NicoLiveFollowProgram[];
}

// 生放送: 番組検索 (api.cas.nicovideo.jp) API
export interface NicoLiveSearchItem {
  id?: string;
  title?: string;
  listingThumbnailUrl?: { middle?: string };
  thumbnailUrl?: { listingMiddle?: string; normal?: string };
  liveScreenshotThumbnailUrls?: { middle?: string };
  liveCycle?: string;
  onAirTime?: { beginAt?: unknown; endAt?: unknown };
  beginAt?: unknown;
  endAt?: unknown;
  viewCount?: number;
  commentCount?: number;
  contentOwner?: { name?: string; icon?: string };
  providerType?: string;
  isMemberOnly?: boolean;
  isPayProgram?: boolean;
}

export interface NicoLiveSearchResponse {
  meta?: { totalCount?: number };
  data?: NicoLiveSearchItem[];
}

// 生放送: live.nicovideo.jp ページ埋め込みデータ (#embedded-data) の番組 (タイムシフト予約一覧・ランキング等で共通)
export interface NicoLiveEmbeddedProgram {
  nicoliveProgramId?: string;
  title?: string;
  listingThumbnail?: string;
  status?: string;
  beginTime?: unknown;
  endTime?: unknown;
  statistics?: { watchCount?: number; commentCount?: number };
  supplier?: { name?: string; icons?: { uri50x50?: string; uri150x150?: string } };
  socialGroup?: { name?: string; thumbnailUrl?: string };
  providerType?: string;
  isFollowerOnly?: boolean;
  payment?: unknown;
  timeshift?: {
    isPlayable?: boolean;
    viewing?: { endTime?: unknown };
    viewingEndTime?: unknown;
    expireTime?: unknown;
    publication?: { endTime?: unknown };
    publicationEndTime?: unknown;
  };
  reservation?: { expireTime?: unknown };
  expireTime?: unknown;
  timeshiftPublicationEndTime?: unknown;
}

// 生放送: ランキングの要素 ({ type, value } 形式。value が無ければ番組そのもの)
export type NicoLiveRankingItem = NicoLiveEmbeddedProgram & { value?: NicoLiveEmbeddedProgram };

// 生放送: フォロー中 (放送予定) の要素 (ランキングと同じ { type, value } 形式と、フォロー API と同じ形式が混在する)
export type NicoLiveFollowedProgramItem = NicoLiveEmbeddedProgram &
  NicoLiveFollowProgram & { value?: NicoLiveEmbeddedProgram & NicoLiveFollowProgram };

// 生放送: live.nicovideo.jp の #embedded-data (data-props) のうち番組一覧系ページで読む部分
export interface NicoLiveEmbeddedData {
  followedPrograms?: {
    comingsoonProgramListState?: {
      domain?: { items?: NicoLiveFollowedProgramItem[] };
      totalProgramsCount?: number;
    };
  };
  reservations?: { reservations?: NicoLiveEmbeddedProgram[] };
  ranking?: {
    officialAndChannelPrograms?: NicoLiveRankingItem[];
    userPrograms?: NicoLiveRankingItem[];
  };
}

// 生放送: 視聴ページ埋め込みデータの program.supplier
export interface NicoLiveSupplierNode {
  supplierType?: unknown;
  programProviderId?: unknown;
  name?: unknown;
  icons?: { uri150x150?: unknown; uri50x50?: unknown };
  pageUrl?: unknown;
  level?: unknown;
}

// 動画視聴ページ: www.nicovideo.jp/watch の $watchV4 data (値が number/string どちらもあり得るものは unknown)
export interface NicoWatchVideoNode {
  id?: unknown;
  title?: unknown;
  description?: unknown;
  duration?: unknown;
  registeredAt?: unknown;
  isDeleted?: unknown;
  thumbnail?: NicoWatchThumbnailNode;
  count?: NicoWatchCountNode;
}

export interface NicoWatchThumbnailNode {
  url?: unknown;
  largeUrl?: unknown;
  middleUrl?: unknown;
}

export interface NicoWatchCountNode {
  view?: unknown;
  comment?: unknown;
  mylist?: unknown;
  like?: unknown;
}

export interface NicoWatchOwnerNode {
  id?: unknown;
  nickname?: unknown;
  iconUrl?: unknown;
}

export interface NicoWatchChannelNode {
  id?: unknown;
  name?: unknown;
  isOfficialAnime?: unknown;
}

export interface NicoWatchSeriesNode {
  id?: unknown;
  title?: unknown;
}

export interface NicoWatchDomandStreamNode {
  id?: unknown;
  isAvailable?: unknown;
  qualityLevel?: unknown;
  label?: unknown;
  bitRate?: unknown;
  width?: unknown;
  height?: unknown;
}

export interface NicoWatchMediaNode {
  domand?: {
    accessRightKey?: unknown;
    videos?: NicoWatchDomandStreamNode[];
    audios?: NicoWatchDomandStreamNode[];
  };
  delivery?: {
    encryption?: unknown;
    movie?: { session?: unknown };
  };
}

export interface NicoWatchCommentThreadNode {
  id?: unknown;
  fork?: unknown;
  isActive?: unknown;
  isDefaultPostTarget?: unknown;
  isEasyCommentPostTarget?: unknown;
  isLeafRequired?: unknown;
  isOwnerThread?: unknown;
  isThreadkeyRequired?: unknown;
  threadkey?: unknown;
  is184Forced?: unknown;
  label?: unknown;
}

export interface NicoWatchCommentNode {
  threads?: NicoWatchCommentThreadNode[];
  threadKey?: unknown;
  nvComment?: {
    threadKey?: unknown;
    server?: unknown;
    params?: {
      targets?: Array<{ id?: unknown; fork?: unknown }>;
      language?: unknown;
    };
  };
  keys?: { userKey?: unknown };
}

export interface NicoWatchTagNode {
  items?: Array<{ name?: unknown }>;
}

export interface NicoWatchClientNode {
  watchTrackId?: unknown;
}

export interface NicoWatchV4Data {
  video?: NicoWatchVideoNode;
  owner?: NicoWatchOwnerNode | null;
  channel?: NicoWatchChannelNode | null;
  series?: NicoWatchSeriesNode | null;
  media?: NicoWatchMediaNode;
  comment?: NicoWatchCommentNode;
  tag?: NicoWatchTagNode;
  client?: NicoWatchClientNode;
  lazy?: { authKey?: unknown };
}

// 動画視聴ページ: 埋め込みJSON (data.response.$watchV4.data) のルート
export interface NicoWatchV4Root {
  data?: { response?: { $watchV4?: { data?: NicoWatchV4Data } } };
}
