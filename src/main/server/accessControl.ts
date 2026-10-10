import net from 'node:net';
import os from 'node:os';
import type { Request, RequestHandler, Response } from 'express';

/**
 * 内蔵 HTTP サーバーのアクセス制御 (Host / Origin 検証)。認証は無い (Tailscale 経由は Tailscale の ACL で絞る)。
 * electron に依存しない純粋なロジックだけを置く (単体で検証できるようにするため)。
 */

/** `host[:port]` / `[v6]:port` からホスト部だけを取り出す (小文字・末尾ドット除去) */
export function parseHostname(hostHeader: string | undefined): string | null {
  if (!hostHeader) return null;
  const h = hostHeader.trim();
  let host: string;
  if (h.startsWith('[')) {
    const end = h.indexOf(']');
    if (end < 0) return null;
    host = h.slice(1, end);
  } else {
    const colon = h.lastIndexOf(':');
    host = colon >= 0 && h.indexOf(':') === colon ? h.slice(0, colon) : h;
  }
  host = host.toLowerCase().replace(/\.$/, '');
  return host.length > 0 ? host : null;
}

/**
 * DNS リバインディング対策の Host 許可判定。
 *
 * 攻撃者のページは自分のドメイン名 (ドット付きの公開 FQDN) 経由でしかこのサーバーに届かない。
 * よって次を許可し、それ以外 (ドット付きの公開ドメイン) を拒否する:
 *  - IP リテラル (v4 / v6)
 *  - `localhost` / `*.localhost`
 *  - ドットを含まない単一ラベル名 (LAN 内のホスト名・PC名)
 *  - `*.local` (mDNS)
 *  - `*.ts.net` (Tailscale MagicDNS)
 *  - 設定 `httpServer.allowedHosts` に列挙した名前 (`example.lan` / `*.example.lan`)
 */
export function isAllowedHostname(hostname: string, extraHosts: readonly string[] = []): boolean {
  if (net.isIP(hostname) !== 0) return true;
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return true;
  if (!hostname.includes('.')) return true;
  if (hostname.endsWith('.local') || hostname.endsWith('.ts.net')) return true;
  if (hostname === os.hostname().toLowerCase()) return true;
  for (const raw of extraHosts) {
    const p = raw.trim().toLowerCase().replace(/\.$/, '');
    if (!p) continue;
    if (p.startsWith('*.') ? hostname.endsWith(p.slice(1)) : hostname === p) return true;
  }
  return false;
}

export function isAllowedHostHeader(hostHeader: string | undefined, extraHosts: readonly string[] = []): boolean {
  const host = parseHostname(hostHeader);
  return host !== null && isAllowedHostname(host, extraHosts);
}

/**
 * Origin ヘッダーがある場合は、リクエスト先 (Host) と同一オリジンであることを要求する。
 * ブラウザは別オリジンのページからの fetch / フォーム送信に Origin を付ける。
 * (動画・画像タグの GET や Node の fetch は Origin を付けないので影響しない)
 */
export function isSameOrigin(originHeader: string | undefined, hostHeader: string | undefined): boolean {
  if (originHeader === undefined) return true;
  if (!hostHeader) return false;
  try {
    return new URL(originHeader).host.toLowerCase() === hostHeader.trim().toLowerCase();
  } catch {
    return false; // 'null' など
  }
}

export interface HostGuardOptions {
  /** `httpServer.allowedHosts` (毎リクエスト評価。設定変更を再起動なしで反映する) */
  getAllowedHosts: () => readonly string[];
}

/** Host / Origin 検証 (全モードで常時適用) */
export function createHostGuard(opts: HostGuardOptions): RequestHandler {
  return (req: Request, res: Response, next) => {
    if (!isAllowedHostHeader(req.headers.host, opts.getAllowedHosts())) {
      res.status(403).json({ error: 'forbidden host' });
      return;
    }
    if (!isSameOrigin(req.headers.origin, req.headers.host)) {
      res.status(403).json({ error: 'forbidden origin' });
      return;
    }
    next();
  };
}

/** サイドカーが付ける共有シークレットのヘッダー (nndd-re-tailscale の secretHeader と同じ) */
export const SIDECAR_SECRET_HEADER = 'x-nndd-sidecar-secret';

type RequestWithClient = Request & { nnddClientIp?: string };

/** 接続元IP。サイドカー経由 (共有シークレット一致) なら、サイドカーが付けた X-Forwarded-For を使う */
export function clientIpOf(req: Request): string {
  return (req as RequestWithClient).nnddClientIp ?? req.ip ?? req.socket.remoteAddress ?? '';
}

/**
 * サイドカー経由のリクエストを判定する。共有シークレットが一致したときだけ X-Forwarded-For を接続元として信頼する。
 * シークレットのヘッダーは判定後に必ず取り除く (後続の処理・ログに残さない)。
 */
export function createSidecarTrust(verify: (given: string | undefined) => boolean): RequestHandler {
  return (req: Request, _res: Response, next) => {
    const given = req.headers[SIDECAR_SECRET_HEADER];
    delete req.headers[SIDECAR_SECRET_HEADER];
    if (typeof given === 'string' && verify(given)) {
      const xff = req.headers['x-forwarded-for'];
      const ip = (typeof xff === 'string' ? xff.split(',').pop() : undefined)?.trim();
      if (ip) (req as RequestWithClient).nnddClientIp = ip.replace(/^::ffff:/, '');
    }
    next();
  };
}
