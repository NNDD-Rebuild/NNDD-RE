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
  version: 'v0.1.1',
  assets: {
    'nndd-re-tailscale-windows-amd64.exe': '1c2ae3ef8f02bae66ab6961b72a8ba96a57c115cc7f53753ad9b1ccc07b701ab',
    'nndd-re-tailscale-darwin-amd64': 'aa7373837cf807e100ec20d196df4cec44c290bb0f3349256509359463c46e4a',
    'nndd-re-tailscale-darwin-arm64': 'e0b0619805a52a6406f57054a19ad35daf5137a83e8022567f2a8b5a0b185adc',
    'nndd-re-tailscale-linux-amd64': '80fbee2123bfa52b7c2ea64b515bb4f96ff68e2dc33cfef542b522514356dbe8'
  }
};

/** 本体が解釈できる制御プロトコルのバージョン (サイドカーの hello.protocol と一致が必要) */
export const SIDECAR_PROTOCOL = 1;
