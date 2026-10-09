/**
 * ヘッドレス起動 (`--headless`): メインウィンドウとトレイを作らず、内蔵HTTPサーバーだけ常駐させる。
 * Linux で表示環境が無い場合は xvfb-run 経由でも起動できる。
 */
export const isHeadless = process.argv.includes('--headless');

/** `--allow-external`: 設定を書き換えず、内蔵HTTPサーバーを LAN 公開 (0.0.0.0バインド) で起動する */
export const forceAllowExternal = process.argv.includes('--allow-external');

/** `--port <n>` / `--port=<n>`: 設定を書き換えず、内蔵HTTPサーバーのポートを上書きする (不正値は無視) */
export const forcePort: number | null = (() => {
  const args = process.argv;
  const i = args.findIndex((a) => a === '--port' || a.startsWith('--port='));
  if (i < 0) return null;
  const raw = args[i].startsWith('--port=') ? args[i].slice('--port='.length) : args[i + 1];
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null;
})();
