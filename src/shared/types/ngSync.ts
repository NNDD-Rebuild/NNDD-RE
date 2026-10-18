/** サーバー側 NG とのマージ結果 (NG_SERVER_SYNC の戻り値) */
export interface NgSyncResult {
  /** サーバーにだけあった新しい NG をローカルへ追加した件数 */
  pulled: number;
  /** ローカルにだけあった新しい NG をサーバーへ追加した件数 */
  pushed: number;
  /** サーバーで削除されていたためローカルからも削除した件数 (aborted のときは削除予定の件数) */
  deletedLocal: number;
  /** ローカルで削除されていたためサーバーからも削除した件数 (aborted のときは削除予定の件数) */
  deletedServer: number;
  /** サーバーに相当がなくローカルのみで保持する件数 (完全一致ワード・コマンド) */
  localOnly: number;
  /** 通信エラー等で反映できなかった件数 (次回の同期で再試行される) */
  failed: number;
  /** サーバー側の登録上限に達して、残りを送れなかった */
  limitReached: boolean;
  /** 同期後のサーバー側件数 (同期対象の種別のみ) */
  serverCount: number;
  /** 削除が大量で、確認なしでは実行しなかった (force: true で再実行すると削除を含めて同期する) */
  aborted?: 'massDelete';
}
