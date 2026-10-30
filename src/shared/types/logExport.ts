/** 開発者へのログ送信: 切り出し範囲 */
export type LogExportRange =
  | { kind: 'sessions'; count: number }
  | { kind: 'time'; fromMs: number; toMs: number };

/** 既定のマスクに加えて、送る人が選べる追加のマスク */
export interface LogExportOptions {
  /** 動画ID・番組ID (sm123 / lv123 など)、ログに出た動画・番組のタイトル、サムネイルのURLとキャッシュ名 */
  maskVideoIds: boolean;
  /** チャンネルID・チャンネル名 */
  maskChannels: boolean;
  /** マイリスト名・シリーズ名・予約 (スケジュール) の名前 */
  maskNames: boolean;
}

export interface LogExportPreview {
  /** 送信時に指定する ID。プレビューした内容そのものを main が保持している */
  previewId: string;
  /** プレビュー表示用テキスト (マスク済み。大きい場合は末尾のみ) */
  text: string;
  lineCount: number;
  bytes: number;
  firstAt: string | null;
  lastAt: string | null;
  /** 指定した起動数ぶんの目印が残っておらず、残っている先頭から返したか */
  oldestMissing: boolean;
  /** 送信上限を超えたため古い側を切り捨てたか */
  truncated: boolean;
}

export type LogExportSendResult = { ok: true; id: string } | { ok: false; error: string };

/** 送信済みログの履歴 (削除トークンは含めない) */
export interface LogExportHistoryItem {
  id: string;
  uploadedAt: string;
  bytes: number;
  range: string;
  /** アプリから削除できるか (旧形式の Worker に送った分は false) */
  deletable: boolean;
}

export type LogExportDeleteResult = { ok: true } | { ok: false; error: string };
