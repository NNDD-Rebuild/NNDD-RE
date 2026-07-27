/**
 * NNDDREVideo - ライブラリ管理対象の動画エンティティ
 * 元: src/org/mineap/nndd/model/NNDDREVideo.as
 */
export interface NNDDREVideo {
  id: number;
  uri: string;
  videoName: string;
  tagStrings: string[];
  modificationDate: Date;
  creationDate: Date;
  thumbUrl: string;
  playCount: number;
  /** 動画長 (秒) */
  time: number;
  lastPlayDate: Date | null;
  yetReading: boolean;
  pubDate: Date | null;
  isFavorite: boolean;
  /** 動画説明文 (オフライン全文検索対象)。DL/スキャン時に取得できなかった場合は空文字 */
  description: string;
}

/**
 * 動画種別 (sm/nm/so/ax 等)
 * 元: src/org/mineap/nndd/model/VideoType.as
 */
export const VideoType = {
  SM: 'sm',
  NM: 'nm',
  SO: 'so',
  AX: 'ax',
  SD: 'sd',
  CA: 'ca',
  CD: 'cd',
  CW: 'cw',
  ZB: 'zb',
  ZE: 'ze',
  YO: 'yo'
} as const;

export type VideoTypeValue = typeof VideoType[keyof typeof VideoType];

/**
 * 動画ファイル種別 (再生形式)
 */
export const VideoFileType = {
  MP4: 'mp4',
  FLV: 'flv',
  SWF: 'swf',
  HLS: 'hls'
} as const;

export type VideoFileTypeValue = typeof VideoFileType[keyof typeof VideoFileType];
