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
  version: 'v0.1.0',
  assets: {
    'nndd-re-tailscale-windows-amd64.exe': '8a7c184e2094bcc78d68fea53818fdcfc252a261bb3cb7728baad9ad70310f39',
    'nndd-re-tailscale-darwin-amd64': 'a7baebf5119fb4648b072aa369c0ec31165ee9e3293f76dcc91d1d648ede3737',
    'nndd-re-tailscale-darwin-arm64': 'a8ec44b24eccda3a5a07ad608646dcdbf1a304375529e2512c75c8677b946149',
    'nndd-re-tailscale-linux-amd64': '9a43e763dffff6d133c4556bbca94a55fc5fad741b44f0a637e3642c59544d16'
  }
};

/** 本体が解釈できる制御プロトコルのバージョン (サイドカーの hello.protocol と一致が必要) */
export const SIDECAR_PROTOCOL = 1;
