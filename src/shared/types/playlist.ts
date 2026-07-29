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
  /** 実測視聴秒数 (open〜close間の経過時間からpause時間を除いた値) */
  watchSeconds: number;
}

/**
 * ニコニコ動画本家 (公式サイト) 側の視聴履歴項目。
 * このアプリ内の視聴記録 (HistoryItem) とは出所が異なるため別テーブルで管理する。
 */
export interface NicoWatchHistoryItem {
  videoId: string;
  title: string;
  thumbnailUrl: string;
  /** ニコニコ動画側の視聴日時。APIから取得できなければnull */
  watchedAt: Date | null;
  /** このアプリが取得した日時 */
  fetchedAt: Date;
}

/**
 * 自作プレイリスト (ローカル完結、サーバー同期なし)
 */
export interface Playlist {
  id: number;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  /** ユーザーが選択したカスタムアイコン (絵文字)。未設定なら既定表示 */
  icon?: string | null;
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
