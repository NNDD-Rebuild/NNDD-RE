/**
 * ダウンロード状態種別
 * 元: src/org/mineap/nndd/download/DownloadStatusType.as
 */
export const DownloadStatusType = {
  /** 待機中 */
  WAIT: 'wait',
  /** ログイン中 */
  LOGIN: 'login',
  /** 視聴ページ取得中 */
  WATCH: 'watch',
  /** コメントダウンロード中 */
  COMMENT: 'comment',
  /** 投稿者コメント取得中 */
  OWNER_COMMENT: 'ownerComment',
  /** サムネイル取得中 */
  THUMB: 'thumb',
  /** マスタープレイリスト解析中 (新DMS) */
  MASTER_PLAYLIST: 'masterPlaylist',
  /** キー取得中 (新DMS, AES-128) */
  KEY: 'key',
  /** セグメントダウンロード中 (新DMS) */
  SEGMENT: 'segment',
  /** FFmpegでの結合中 */
  MERGE: 'merge',
  /** 動画ダウンロード中 */
  VIDEO: 'video',
  /** 成功 */
  SUCCESS: 'success',
  /** 失敗 */
  FAIL: 'fail',
  /** キャンセル */
  CANCELED: 'canceled',
  /** スキップ */
  SKIPPED: 'skipped'
} as const;

export type DownloadStatusTypeValue =
  typeof DownloadStatusType[keyof typeof DownloadStatusType];

/**
 * ダウンロードキュー項目
 * 元: src/org/mineap/nndd/model/DownloadQueueItem.as
 */
export interface DownloadQueueItem {
  /** 内部ID (UUID) */
  id: string;
  /** ニコニコ動画ID (sm12345 等) */
  videoId: string;
  /** 表示名 */
  videoName: string;
  /** ステータス */
  status: DownloadStatusTypeValue;
  /** 進捗 0..1 */
  progress: number;
  /** 進捗詳細メッセージ */
  message: string;
  /** リトライ回数 */
  retryCount: number;
  /** 保存先ディレクトリ */
  saveDir: string;
  /** コメントのみダウンロードか */
  isCommentOnly: boolean;
  /** 開始時刻 */
  startTime: Date | null;
  /** 終了時刻 */
  endTime: Date | null;
  /** エラーメッセージ */
  errorMessage: string | null;
}

/**
 * スケジュール
 * 元: src/org/mineap/nndd/model/Schedule.as
 */
export interface Schedule {
  id: string;
  /** スケジュール名 */
  name: string;
  /** 対象マイリストURL */
  targetMyListUrl: string;
  /** 起動曜日 (0=日 .. 6=土) */
  daysOfWeek: number[];
  /** 起動時刻 "HH:MM" */
  time: string;
  /** 有効か */
  enabled: boolean;
  /** 最終実行 */
  lastRun: Date | null;
}
