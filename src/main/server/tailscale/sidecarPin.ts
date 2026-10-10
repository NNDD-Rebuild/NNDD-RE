/**
 * 同梱せず取得する Tailscale サイドカー (NNDD-Rebuild/nndd-re-tailscale) のピン留め。
 *
 * 取得するバージョンとバイナリの SHA256 を本体に埋め込む。リリースの SHA256SUMS を同じ場所から取ると、
 * リポジトリやリリースが侵害されたときに改ざんを検知できないため。
 * 新しいリリースを使うときは `node scripts/update-sidecar-pin.mjs <タグ>` で更新し、レビューしてコミットする。
 *
 * version が空のときはサイドカーを取得できない (検証できないものは実行しない)。
 */
export const SIDECAR_REPO = 'NNDD-Rebuild/nndd-re-tailscale';

export interface SidecarPin {
  /** リリースタグ (例 `v0.1.0`)。空なら未設定 */
  version: string;
  /** 資産名 → SHA256 (16進小文字) */
  assets: Record<string, string>;
}

export const SIDECAR_PIN: SidecarPin = {
  version: '',
  assets: {}
};

/** 本体が解釈できる制御プロトコルのバージョン (サイドカーの hello.protocol と一致が必要) */
export const SIDECAR_PROTOCOL = 1;
