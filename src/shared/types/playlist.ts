/**
 * プレイリスト (連続再生用)
 * 元: src/org/mineap/nndd/model/PlayList.as
 */
export interface PlayList {
  id: string;
  name: string;
  videos: PlayListItem[];
  /** ループ再生か */
  isLoop: boolean;
  /** シャッフルか */
  isShuffle: boolean;
}

export interface PlayListItem {
  /** ローカルファイルパスまたはニコニコ動画ID */
  uri: string;
  videoName: string;
  /** 動画長 (秒) */
  time: number;
}

/**
 * 視聴履歴項目
 */
export interface HistoryItem {
  videoId: string;
  title: string;
  thumbnailUrl: string;
  watchedAt: Date;
  /** ローカルファイルかどうか */
  isLocal: boolean;
}

/**
 * 自作プレイリスト (ローカル完結、サーバー同期なし)
 */
export interface Playlist {
  id: number;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * プレイリスト内の動画項目 (追加時のタイトル等スナップショット)
 */
export interface PlaylistItem {
  videoId: string;
  title: string;
  thumbnailUrl: string;
  lengthSec: number;
  sortOrder: number;
  addedAt: Date;
}

/**
 * 動画ごとの再生位置レジューム
 */
export interface ResumePosition {
  videoKey: string;
  positionSec: number;
  durationSec: number;
  updatedAt: Date;
}
