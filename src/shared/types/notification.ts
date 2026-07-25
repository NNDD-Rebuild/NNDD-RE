/** Webhook通知設定 (ConfigStore に保存) */
export interface WebhookNotifyConfig {
  /** 通知を有効にするか */
  enabled: boolean;
  /** Discord または Slack のIncoming Webhook URL。ドメインで自動判定して送信形式を切り替える */
  webhookUrl: string;
  /** ダウンロード完了時に通知するか */
  notifyOnDownloadComplete: boolean;
  /** ダウンロード失敗時に通知するか */
  notifyOnDownloadFail: boolean;
}
