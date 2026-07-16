/**
 * マイリスト種別
 * 元: src/org/mineap/nndd/model/RssType.as
 */
export const RssType = {
  MY_LIST: 'mylist',
  CHANNEL: 'channel',
  COMMUNITY: 'community',
  USER_UPLOAD_VIDEO: 'userUpload',
  SERIES: 'series'
} as const;

export type RssTypeValue = typeof RssType[keyof typeof RssType];

/**
 * マイリスト・チャンネル・コミュニティの統合エンティティ
 * 元: src/org/mineap/nndd/myList/MyList.as
 */
export interface MyList {
  /** ID or URL */
  myListUrl: string;
  /** 表示名 */
  myListName: string;
  /** フォルダかどうか */
  isDir: boolean;
  /** 未再生数 */
  unPlayVideoCount: number;
  /** 種別 */
  type: RssTypeValue;
  /** 含まれる動画ID一覧 (重複検査用) */
  myListVideoIds: Record<string, boolean>;
}

/**
 * マイリスト内の動画項目
 * 元: nicovideo4as/src/org/mineap/nicovideo4as/model/MyListItem.as
 */
export interface MyListItem {
  videoId: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  length: string;
  /** 投稿日 */
  pubDate: Date;
  /** 視聴回数 */
  viewCount: number;
  /** コメント数 */
  commentCount: number;
  /** マイリスト数 */
  mylistCount: number;
  /** いいね数 */
  likeCount?: number;
  /** チャンネル動画かどうか (未加入だと再生できない場合がある) */
  isChannelVideo?: boolean;
}

/**
 * マイリスト更新ソート種別
 * 元: src/org/mineap/nndd/model/MyListSortType.as
 */
export const MyListSortType = {
  PUB_DATE_DESC: 'pubDateDesc',
  PUB_DATE_ASC: 'pubDateAsc',
  VIEW_COUNT_DESC: 'viewCountDesc',
  COMMENT_COUNT_DESC: 'commentCountDesc',
  MYLIST_COUNT_DESC: 'mylistCountDesc'
} as const;

export type MyListSortTypeValue =
  typeof MyListSortType[keyof typeof MyListSortType];

/**
 * 更新結果種別
 * 元: src/org/mineap/nndd/model/MyListRenewResultType.as
 */
export const MyListRenewResultType = {
  SUCCESS: 'success',
  FAIL: 'fail',
  CANCELED: 'canceled',
  SKIPPED: 'skipped'
} as const;

export type MyListRenewResultTypeValue =
  typeof MyListRenewResultType[keyof typeof MyListRenewResultType];
