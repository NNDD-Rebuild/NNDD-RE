/**
 * 検索種別
 * 元: src/org/mineap/nndd/model/NNDDRESearchType.as
 */
export const NNDDRESearchType = {
  /** キーワード検索 */
  TAG: 'tag',
  KEYWORD: 'keyword'
} as const;

export type NNDDRESearchTypeValue =
  typeof NNDDRESearchType[keyof typeof NNDDRESearchType];

/**
 * 検索ソート種別
 * 元: src/org/mineap/nndd/model/NNDDRESearchSortType.as
 */
export const NNDDRESearchSortType = {
  /** 投稿日時 新しい順 */
  REGISTERED_AT_DESC: 'registeredAt_desc',
  REGISTERED_AT_ASC: 'registeredAt_asc',
  /** 再生数 多い順 */
  VIEW_COUNT_DESC: 'viewCount_desc',
  VIEW_COUNT_ASC: 'viewCount_asc',
  /** コメント数 多い順 */
  COMMENT_COUNT_DESC: 'commentCount_desc',
  COMMENT_COUNT_ASC: 'commentCount_asc',
  /** マイリスト数 多い順 */
  MYLIST_COUNT_DESC: 'mylistCount_desc',
  MYLIST_COUNT_ASC: 'mylistCount_asc',
  /** いいね数 多い順 */
  LIKE_COUNT_DESC: 'likeCount_desc',
  /** 長さ 短い順 */
  LENGTH_ASC: 'length_asc',
  LENGTH_DESC: 'length_desc'
} as const;

export type NNDDRESearchSortTypeValue =
  typeof NNDDRESearchSortType[keyof typeof NNDDRESearchSortType];

/**
 * 検索結果項目
 * 元: nicovideo4as/src/org/mineap/nicovideo4as/model/search/SearchResultItem.as
 */
export interface SearchResultItem {
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
  tags: string[];
  /** 投稿者情報 (フォロー新着など、投稿者が特定できる場合のみ) */
  author?: {
    id: string;
    nickname: string;
    iconUrl: string;
  };
}

/**
 * 保存検索項目
 * 元: src/org/mineap/nndd/model/SearchItem.as
 */
export interface SearchItem {
  id: string;
  name: string;
  word: string;
  type: NNDDRESearchTypeValue;
  sortType: NNDDRESearchSortTypeValue;
}
