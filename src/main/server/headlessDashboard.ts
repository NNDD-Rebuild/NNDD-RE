import QRCode from 'qrcode';
import type { NnddHttpServer } from './NnddHttpServer';

/**
 * ヘッドレス起動時、接続台数・視聴数・URL (QR付き) をターミナルへ表示する (毎秒確認し、内容が変わったときだけ同じ位置に上書き)。
 * 標準出力が端末でない場合 (パッケージ版exeをダブルクリック起動など) は何もしない。
 * 同じ内容は http://<host>:<port>/status でも確認できる。
 */
export function startHeadlessDashboard(server: NnddHttpServer): void {
  if (!process.stdout.isTTY) return;

  const qrCache = new Map<string, string>();
  const qrFor = async (url: string): Promise<string> => {
    let qr = qrCache.get(url);
    if (qr === undefined) {
      qr = await QRCode.toString(url, { type: 'terminal', small: true });
      qrCache.set(url, qr);
    }
    return qr;
  };

  // 内容が変わったときだけ、カーソルを先頭に戻して上書きする (画面全消去はしない)
  let lastText = '';
  let first = true;
  let rendering = false;
  const render = async (): Promise<void> => {
    if (rendering) return;
    rendering = true;
    try {
      const s = server.getStats();
      const urls = server.getAccessUrls();
      const lines: string[] = [];
      lines.push('NNDD-RE ヘッドレスサーバー');
      lines.push('');
      lines.push(`接続台数: ${s.clients}   視聴数: ${s.viewers}`);
      // Tailscale 独立端末のログイン待ち・エラー。ヘッドレスではここに承認用 URL を出す
      const ex = server.getExposureStatus();
      if (ex && (ex.state === 'needs_login' || ex.state === 'error')) {
        if (ex.message) lines.push(ex.message);
        if (ex.authUrl) lines.push(`ログイン用URL: ${ex.authUrl}`);
      }
      for (const v of s.viewerList) lines.push(`  視聴中: ${v.ip}  ${v.videoId}`);
      lines.push('');
      lines.push(`ステータス: ${urls[0]?.replace(/\/library$/, '/status') ?? ''}`);
      lines.push('');
      // QR は先頭 (本命) のURLだけ。他のNICのURLは文字だけ並べる
      if (urls[0]) {
        lines.push(urls[0]);
        lines.push(await qrFor(urls[0]));
      }
      if (urls.length > 1) {
        lines.push('他のURL:');
        for (const url of urls.slice(1)) lines.push(`  ${url}`);
      }
      const text = lines.join('\n');
      if (text === lastText) return;
      lastText = text;
      const body = text.split('\n').map((l) => l + '\x1b[K').join('\n');
      process.stdout.write((first ? '\x1b[2J' : '') + '\x1b[H' + body + '\n\x1b[J');
      first = false;
    } catch {
      // 表示の失敗でサーバーを止めない
    } finally {
      rendering = false;
    }
  };

  void render();
  setInterval(() => void render(), 1000).unref();
}
