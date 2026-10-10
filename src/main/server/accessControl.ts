import crypto from 'node:crypto';
import net from 'node:net';
import os from 'node:os';
import type { Request, RequestHandler, Response } from 'express';

/**
 * 内蔵 HTTP サーバーのアクセス制御 (Host / Origin 検証・アクセストークン認証)。
 * electron に依存しない純粋なロジックだけを置く (単体で検証できるようにするため)。
 */

export const TOKEN_COOKIE = 'nndd_token';

/** 失敗をカウントする窓と上限 (トークンを提示して間違えた回数) */
const FAIL_WINDOW_MS = 60_000;
const FAIL_LIMIT = 10;

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

/** ログ出力用: URL のクエリ中の token 値を伏せる */
export function maskTokenInUrl(url: string): string {
  return url.replace(/([?&]token=)[^&#\s]*/gi, '$1***');
}

function sha256(s: string): Buffer {
  return crypto.createHash('sha256').update(s).digest();
}

/** 定数時間でトークンを比較する */
export function tokensMatch(given: string | undefined, expected: string): boolean {
  if (!given || !expected) return false;
  return crypto.timingSafeEqual(sha256(given), sha256(expected));
}

function readCookie(req: Request, name: string): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

function readBearer(req: Request): string | undefined {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '');
  return m ? m[1] : undefined;
}

function wantsHtml(req: Request): boolean {
  return req.method === 'GET' && (req.headers.accept ?? '').includes('text/html');
}

function stripTokenFromUrl(originalUrl: string): string {
  const u = new URL(originalUrl, 'http://placeholder');
  u.searchParams.delete('token');
  return u.pathname + u.search;
}

const UNAUTHORIZED_HTML = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NNDD-RE</title></head><body style="font-family:sans-serif;padding:2em"><h1>アクセストークンが必要です</h1><p>NNDD-RE の設定画面に表示される QR コード、または URL (<code>?token=…</code> 付き) から開き直してください。</p></body></html>`;

export interface AccessControlOptions {
  /** `httpServer.allowedHosts` (毎リクエスト評価。設定変更を再起動なしで反映する) */
  getAllowedHosts: () => readonly string[];
  /** トークン認証を要求するか */
  isTokenRequired: () => boolean;
  /** 現在の有効なトークン */
  getToken: () => string;
  /** トークン認証の対象外にするパス */
  publicPaths?: readonly string[];
}

/** Host / Origin 検証 (全モードで常時適用) */
export function createHostGuard(opts: Pick<AccessControlOptions, 'getAllowedHosts'>): RequestHandler {
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

/**
 * アクセストークン認証。`Authorization: Bearer` / Cookie / `?token=` のいずれかで受け付ける。
 *  - `<video>` / `<img>` はヘッダーを付けられないので Cookie (または ?token=) が必要
 *  - ブラウザの画面遷移 (Accept: text/html) で ?token= が来たら Cookie に引き換えて、URL からトークンを消してリダイレクトする
 *  - 誤ったトークンを提示し続ける IP は一定時間 429 にする
 */
export function createTokenGuard(opts: AccessControlOptions): RequestHandler {
  const publicPaths = new Set(opts.publicPaths ?? []);
  const failures = new Map<string, { count: number; resetAt: number }>();

  return (req: Request, res: Response, next) => {
    if (!opts.isTokenRequired() || publicPaths.has(req.path)) {
      next();
      return;
    }
    // プロキシ (サイドカー / Tailscale Serve) 経由は socket が常に 127.0.0.1 になる。接続元ごとに数えるため転送元IPを使う
    const ip = clientIpOf(req);
    const now = Date.now();
    // 期限切れのエントリを掃除する (Map が増え続けないように)
    if (failures.size > 1000) {
      for (const [k, v] of failures) if (v.resetAt <= now) failures.delete(k);
    }
    const fail = failures.get(ip);
    if (fail && fail.resetAt <= now) failures.delete(ip);
    const current = failures.get(ip);
    if (current && current.count >= FAIL_LIMIT) {
      res.setHeader('Retry-After', String(Math.ceil((current.resetAt - now) / 1000)));
      res.status(429).json({ error: 'too many attempts' });
      return;
    }

    const expected = opts.getToken();
    const bearer = readBearer(req);
    const queryToken = typeof req.query.token === 'string' ? req.query.token : undefined;
    const cookie = readCookie(req, TOKEN_COOKIE);

    // トークンの再生成後は古い Cookie が残っている。有効な Bearer / ?token= を Cookie より優先して引き換える
    if (tokensMatch(queryToken, expected) && wantsHtml(req)) {
      res.cookie(TOKEN_COOKIE, expected, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 365 * 24 * 60 * 60 * 1000
      });
      res.redirect(302, stripTokenFromUrl(req.originalUrl));
      return;
    }
    if (tokensMatch(bearer, expected) || tokensMatch(queryToken, expected) || tokensMatch(cookie, expected)) {
      next();
      return;
    }

    // 総当たり対策のカウントは Bearer / ?token= を提示して間違えた場合だけ。
    // 古い Cookie は画像・動画の 1 リクエストごとに送られるため、数えると正規の利用者が締め出される
    if (bearer !== undefined || queryToken !== undefined) {
      const entry = failures.get(ip) ?? { count: 0, resetAt: now + FAIL_WINDOW_MS };
      entry.count++;
      failures.set(ip, entry);
    }
    res.setHeader('Cache-Control', 'no-store');
    if (wantsHtml(req)) {
      res.status(401).type('text/html; charset=utf-8').send(UNAUTHORIZED_HTML);
    } else {
      res.status(401).json({ error: 'unauthorized' });
    }
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
