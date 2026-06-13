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
