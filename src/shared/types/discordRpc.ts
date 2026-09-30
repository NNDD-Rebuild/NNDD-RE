/** Discord Rich Presence 設定 (ConfigStore に保存) */
export interface DiscordRpcConfig {
  /** 連携を有効にするか */
  enabled: boolean;
  /** Discord Developer Portal で発行したアプリケーションのClient ID */
  clientId: string;
  /** 動画タイトルを表示するか (OFF時は「NNDD-REで視聴中」のみ表示) */
  showTitle: boolean;
  /** サムネイル画像を表示するか */
  showThumbnail: boolean;
  /** NNDD-REのGitHubリポジトリへのリンクボタンを表示するか */
  showGithubButton: boolean;
}

/** 再生中動画のPresence更新情報 (renderer → main) */
export interface DiscordActivityInfo {
  /** 再生の種別。省略時は通常の動画。live は放送中の生放送、timeshift はタイムシフト視聴 */
  kind?: 'live' | 'timeshift';
  /** 動画ID。生放送のときは番組ID (lv123...) */
  videoId: string;
  title: string;
  thumbnailUrl?: string;
  /** 動画の長さ (秒)。省略時は経過時間のみ表示 */
  durationSec?: number;
  /** 再生開始時刻 (Unix ms)。現在の再生位置から逆算して渡す */
  startedAtMs: number;
}
