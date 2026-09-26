import type { NNDDREComment } from './comment';

/**
 * ニコニコ生放送 関連の型。
 * main (LiveSession) → renderer (LivePlayerApp) へ LIVE_EVENT で送るイベント等。
 */

/** 番組の放送状態 (watchページ embedded-data の program.status) */
export type LiveProgramStatus = 'ON_AIR' | 'ENDED' | 'RELEASED' | string;

export interface LiveProgramInfo {
  /** 番組ID (lv123...) */
  programId: string;
  title: string;
  status: LiveProgramStatus;
  /** 提供元種別 (community / channel / official) */
  providerType: string;
  /** 放送者/提供者名 */
  supplierName: string;
  /** 開始・終了時刻 (unix ms) */
  beginTimeMs: number;
  endTimeMs: number;
  /** コメント vpos の基準時刻 (unix ms) */
  vposBaseTimeMs: number;
  /** サムネイル URL (無ければ空) */
  thumbnailUrl: string;
}

export interface LiveStatistics {
  viewers: number;
  comments: number;
  adPoints?: number;
  giftPoints?: number;
}

/** 生放送プレイヤーの接続状態 */
export type LiveConnectionState = 'connecting' | 'watching' | 'reconnecting' | 'ended' | 'error';

/** コメントリスト表示用の非コメント行 (運営コメント・通知・ギフト等) */
export interface LiveNotice {
  kind: 'operator' | 'notification' | 'gift' | 'nicoad';
  text: string;
  /** 受信時刻 (unix ms) */
  at: number;
  link?: string;
}

export type LiveEvent =
  | { type: 'state'; state: LiveConnectionState; message?: string }
  | { type: 'stream'; uri: string; quality: string; availableQualities: string[] }
  | { type: 'comments'; comments: NNDDREComment[] }
  /** タイムシフト: 過去コメントの取得分 (新しい区間から順に届く)。done=true で全件取得完了 */
  | { type: 'archiveComments'; comments: NNDDREComment[]; done: boolean }
  | { type: 'notice'; notice: LiveNotice }
  | { type: 'statistics'; statistics: LiveStatistics }
  /** 運営コメント (画面上部に固定表示するもの)。null で消去 */
  | { type: 'operatorComment'; notice: LiveNotice | null };

/** LIVE_START の戻り値 */
export interface LiveStartResult {
  program: LiveProgramInfo;
  /** タイムシフト視聴か */
  isTimeshift: boolean;
}
