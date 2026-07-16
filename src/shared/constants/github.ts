/**
 * GitHub OAuth Device Flow / Gist API 用エンドポイント定義。
 *
 * CLIENT_ID は OAuth App の識別子であり秘匿情報ではないため、
 * ソースコードに定数として埋め込む (client_secret は Device Flow では不要)。
 *
 * 事前に GitHub の Settings > Developer settings > OAuth Apps で
 * "Enable Device Flow" を有効にした OAuth App を作成し、
 * 発行された Client ID をここに設定すること。
 */
export const GitHubApi = {
  /** OAuth App の Client ID (要設定) */
  CLIENT_ID: 'Ov23liEQqwZ8qmFw7mUq',

  /** Device Flow: デバイスコード発行 */
  DEVICE_CODE_URL: 'https://github.com/login/device/code',
  /** Device Flow: アクセストークン取得 (ポーリング) */
  ACCESS_TOKEN_URL: 'https://github.com/login/oauth/access_token',
  /** ログインユーザー情報取得 */
  USER_URL: 'https://api.github.com/user',
  /** Gist API ベース */
  GIST_API_BASE: 'https://api.github.com/gists',

  /** 要求スコープ (Gistの読み書きのみ) */
  SCOPE: 'gist',
  /** バックアップ用Gistのファイル名 */
  BACKUP_FILE_NAME: 'nndd-backup.json',
  /** バックアップ用Gistの説明文プレフィックス (自アプリが作成したGistの識別用) */
  BACKUP_DESCRIPTION_PREFIX: 'NNDD-RE Backup',

  API_VERSION: '2022-11-28'
} as const;
