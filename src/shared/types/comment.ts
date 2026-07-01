/**
 * コメント表示位置
 * mail属性で "naka" (中央 流れる) / "ue" (上固定) / "shita" (下固定)
 */
export const CommentPosition = {
  NAKA: 'naka',
  UE: 'ue',
  SHITA: 'shita'
} as const;

export type CommentPositionValue =
  typeof CommentPosition[keyof typeof CommentPosition];

/**
 * コメントサイズコマンド
 * 元: src/org/mineap/nndd/player/comment/Command.as
 * BIG=0, MEDIUM=1, SMALL=2
 */
export const CommentSize = {
  BIG: 0,
  MEDIUM: 1,
  SMALL: 2
} as const;

export type CommentSizeValue =
  typeof CommentSize[keyof typeof CommentSize];

/**
 * NNDDREComment - 再生時のコメント表現
 * 元: src/org/mineap/nndd/model/NNDDREComment.as と nicovideo4as の Comment.as
 *
 * 新API (V3) の `vposMs` は ミリ秒単位。
 * 旧API は `vpos` (× 1/100 秒) だが、内部統一は ms で扱う。
 */
export interface NNDDREComment {
  /** スレッドID */
  thread: string;
  /** コメント番号 */
  no: number;
  /** 動画位置 (ミリ秒) */
  vposMs: number;
  /** 投稿日時 (UnixTime秒) */
  date: number;
  /** コマンド文字列 (例: "big red shita") */
  mail: string;
  /** ユーザーID */
  userId: string;
  /** 投稿本文 */
  text: string;
  /** プレミアム会員投稿か */
  isPremium: boolean;
  /** 匿名投稿か */
  isAnonymity: boolean;
  /** 表示するかどうか (NGリスト等で操作) */
  isShow: boolean;
  /** サイズコマンド (BIG/MEDIUM/SMALL) */
  sizeCommand: CommentSizeValue;
  /** 位置コマンド (naka/ue/shita) */
  positionCommand: CommentPositionValue;
  /** 塗り色 (16進RGB) */
  color: number;
  /**
   * 輪郭色 (16進RGB)。二色コマンド時のみ設定される。
   * 例: "blue2 #000033" → color=0x3399ff, strokeColor=0x000033
   */
  strokeColor?: number;
  /** ニコる数 (V3 で取得可能) */
  nicoruCount?: number;
  /** スコア */
  score?: number;
  /** フォーク種別 (main/owner/easy 等) */
  fork?: string;
}

/**
 * コメントの色一覧
 * 元: src/org/mineap/nndd/player/comment/Command.as COLLOR_VALUE_ARRAY
 */
export const StandardColors: Record<string, number> = {
  white: 0xffffff,
  red: 0xff0000,
  pink: 0xff8080,
  orange: 0xffc000,
  yellow: 0xffff00,
  green: 0x00ff00,
  cyan: 0x00ffff,
  blue: 0x0000ff,
  purple: 0xc000ff,
  black: 0x000000
};

/**
 * プレミアム会員のみが使える色
 * 元: src/org/mineap/nndd/player/comment/Command.as COLLOR_PREMIUM_VALUE_ARRAY
 */
export const PremiumColors: Record<string, number> = {
  white2: 0xcccc99,
  niconicowhite: 0xcccc99,
  red2: 0xcc0033,
  truered: 0xcc0033,
  pink2: 0xff33cc,
  orange2: 0xff6600,
  passionorange: 0xff6600,
  yellow2: 0x999900,
  madyellow: 0x999900,
  green2: 0x00cc66,
  elementalgreen: 0x00cc66,
  cyan2: 0x00cccc,
  blue2: 0x3399ff,
  marineblue: 0x3399ff,
  purple2: 0x6633cc,
  nobleviolet: 0x6633cc,
  black2: 0x000000
};

/**
 * NGリスト項目種別
 */
export const NgListItemType = {
  /** 単語によるNG（部分一致） */
  WORD: 'word',
  /** 単語によるNG（完全一致） */
  WORD_EXACT: 'wordExact',
  /** ユーザーIDによるNG */
  USER_ID: 'userId',
  /** コマンドによるNG */
  COMMAND: 'command'
} as const;

export type NgListItemTypeValue =
  typeof NgListItemType[keyof typeof NgListItemType];

export interface NgListItem {
  type: NgListItemTypeValue;
  value: string;
}
