/**
 * ランキング種別
 * 元: src/org/mineap/nndd/util/RankingStringBuilder.as
 */
export const RankingType = {
  HOT: 'hot',
  POPULAR: 'popular',
  TREND: 'trend',
  CUSTOM: 'custom'
} as const;

export type RankingTypeValue =
  typeof RankingType[keyof typeof RankingType];

/**
 * 集計期間
 */
export const RankingTerm = {
  HOUR: 'hour',
  TWENTY_FOUR_HOUR: '24h',
  WEEK: 'week',
  MONTH: 'month',
  TOTAL: 'total'
} as const;

export type RankingTermValue =
  typeof RankingTerm[keyof typeof RankingTerm];

/**
 * ランキングジャンル
 * 元: src/CategoryList.json
 */
export interface RankingGenre {
  /** 内部キー (英数字) */
  key: string;
  /** 表示名 */
  name: string;
  /** タグ一覧 */
  tags: string[];
}

/**
 * ランキングジャンル情報 (featuredKey ベース、動的取得用)
 */
export interface RankingGenreInfo {
  /** URL に使う featuredKey (opaque ID) */
  id: string;
  /** 表示名 */
  name: string;
  /** サブカテゴリ(トレンドタグ)選択に対応しているか */
  hasTags?: boolean;
}

/**
 * ランキング取得結果
 */
export interface RankingFetchResult {
  items: RankingItem[];
  /** 現在のジャンルで選べるサブカテゴリ(トレンドタグ)一覧 */
  trendTags: string[];
  hasNext: boolean;
}

/**
 * ランキング項目
 * 元: nicovideo4as/src/org/mineap/nicovideo4as/model/RankingItem.as
 */
export interface RankingItem {
  rank: number;
  videoId: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  length: number;
  viewCount: number;
  commentCount: number;
  mylistCount: number;
  likeCount: number;
  registeredAt: Date;
  /** チャンネル動画かどうか (未加入だと再生できない場合がある) */
  isChannelVideo?: boolean;
  /** 投稿者情報 (取得できる場合のみ) */
  authorId?: string;
  authorNickname?: string;
  authorIconUrl?: string;
}
