/**
 * 内蔵HTTPサーバー (127.0.0.1 待受) を Tailscale 経由で公開する仕組みの共通インターフェース。
 * 実装: TailscaleServe (既存の Tailscale + `tailscale serve`) / TailscaleSidecar (RE 専用の独立端末)。
 */
export type ExposureState =
  | 'idle'
  | 'starting'
  | 'needs_login' // Tailscale へのログインが必要 (authUrl があれば承認用 URL)
  | 'running'
  | 'error';

export interface ExposureStatus {
  state: ExposureState;
  /** 利用者向けの説明 (エラー内容・待機理由など) */
  message?: string;
  /** needs_login のときの承認用 URL */
  authUrl?: string;
  /** 公開中の URL (トークンなし) */
  urls: string[];
}

export interface Exposure {
  /** 公開を開始する。失敗しても throw せず status に反映する (サーバー本体の起動を止めない) */
  start(port: number): Promise<void>;
  /** 公開を止める。自分が作った設定だけを片付ける */
  stop(): Promise<void>;
  /** 定期確認 (状態の更新・設定が消えていたら再作成) */
  refresh(): Promise<void>;
  getStatus(): ExposureStatus;
  /**
   * 転送してきた中継 (サイドカー) が付けた共有シークレットか。一致したリクエストだけ、
   * 中継が付けた X-Forwarded-For を接続元として信頼する。実装しない公開方式では未定義。
   */
  verifySecret?(given: string | undefined): boolean;
}
