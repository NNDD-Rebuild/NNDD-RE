import type { NgListItem } from './comment';
import type { RssTypeValue } from './mylist';
import type { SearchItem } from './search';

/**
 * GitHub Gist バックアップ・同期機能
 */

/** 同期対象データの範囲 */
export interface DataScope {
  /** アプリ設定 (機微・機体固有情報を除く) */
  config: boolean;
  /** NGリスト (コメントNG/NGタグ/NGユーザー) */
  ngList: boolean;
  /** マイリスト登録一覧 */
  myList: boolean;
  /** スケジュール (予約DL) */
  schedule: boolean;
  /** 保存検索 */
  savedSearch: boolean;
  /** 自作プレイリスト */
  playlist: boolean;
  /** 視聴履歴 (個人情報寄り・データ量が多いため既定OFF) */
  history: boolean;
}

export const DEFAULT_DATA_SCOPE: DataScope = {
  config: true,
  ngList: true,
  myList: true,
  schedule: true,
  savedSearch: true,
  playlist: true,
  history: false
};

/** 同期プロファイル (1プロファイル = 1 Gist) */
export interface SyncProfile {
  id: string;
  /** 表示名 (例: "仕事用", "自宅PC") */
  name: string;
  /** 紐付くGist ID。未アップロードの場合は null */
  gistId: string | null;
  dataScope: DataScope;
  /** 最終同期日時 (ISO8601) */
  lastSyncedAt: string | null;
  lastSyncDirection: 'upload' | 'download' | null;
  /** true の場合、アプリ起動時・終了時にこのプロファイル(アクティブ時のみ)へ自動アップロードする */
  autoUploadEnabled: boolean;
  /** 前回アップロード成功時のペイロードハッシュ (SHA256)。変更検知用、未アップロードなら undefined */
  lastUploadedContentHash?: string;
}

/** GitHub連携設定 (ConfigStore に保存) */
export interface GitHubSyncConfig {
  /** アクセストークン (safeStorage で暗号化した base64 文字列) */
  accessTokenEnc?: string;
  /** ログイン中の GitHub ユーザー名 (表示用) */
  username?: string;
  profiles: SyncProfile[];
  activeProfileId: string | null;
}

export const BACKUP_SCHEMA_VERSION = 1;

/** Gist にアップロードするバックアップペイロード */
export interface BackupPayload {
  schemaVersion: number;
  /** 書き出し日時 (ISO8601) */
  exportedAt: string;
  /** 書き出し時のアプリバージョン (互換性表示用、判定には未使用) */
  appVersion: string;
  /** このペイロードに実際に含まれるデータの範囲 */
  scope: DataScope;
  /** アプリ設定 (機微・機体固有情報を除いたサブセット) */
  config?: Record<string, unknown>;
  ngList?: {
    comments: NgListItem[];
    tags: string[];
    ups: string[];
  };
  myList?: Array<{
    url: string;
    name: string;
    type: RssTypeValue;
    isDir: boolean;
  }>;
  schedule?: Array<{
    id: string;
    name: string;
    targetMyListUrl: string;
    daysOfWeek: number[];
    time: string;
    enabled: boolean;
  }>;
  /** 保存検索 */
  savedSearch?: SearchItem[];
  /**
   * 自作プレイリスト。id は AUTOINCREMENT のため保持しない
   * (復元時は create()+addVideo() で再採番、配列順序で並びを保持)
   */
  playlist?: Array<{
    name: string;
    items: Array<{
      videoId: string;
      title: string;
      thumbnailUrl: string;
      lengthSec: number;
    }>;
  }>;
  /**
   * 視聴履歴。watchedAt は Date だが JSON化での暗黙変換に頼らず ISO 文字列として明示する。
   */
  history?: Array<{
    videoId: string;
    title: string;
    thumbnailUrl: string;
    watchedAt: string;
    isLocal: boolean;
  }>;
}

/** Gist 一覧・要約情報 (Gist選択UI用) */
export interface GistSummary {
  id: string;
  description: string;
  updatedAt: string;
  htmlUrl: string;
}

/** Device Flow 開始結果 */
export interface DeviceFlowStartResult {
  userCode: string;
  verificationUri: string;
  expiresIn: number;
}

/** Device Flow の進捗通知 (main -> renderer) */
export interface DeviceFlowEvent {
  status: 'pending' | 'success' | 'error' | 'expired' | 'denied';
  message?: string;
  username?: string;
}

/** GitHub ログイン状態 */
export interface GitHubStatus {
  loggedIn: boolean;
  username?: string;
}

/** バックアップ アップロード/ダウンロード結果 */
export interface BackupResult {
  ok: boolean;
  error?: string;
  gistUrl?: string;
  applied?: DataScope;
}
