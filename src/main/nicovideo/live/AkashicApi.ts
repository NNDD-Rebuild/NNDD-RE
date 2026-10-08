import type { LiveAkashicApiRequest, LiveAkashicApiResponse } from '@shared/types';
import { NicoHeaders } from '@shared/constants';
import { NicoContext } from '../NicoContext';
import { createLogger } from '../../util/Logger';
import { LIVE_ORIGIN } from './LiveWatchPage';

const log = createLogger('AkashicApi');

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE']);
/** ゲームが指定できないヘッダー (認証・送信元の偽装を防ぐ) */
const FORBIDDEN_HEADERS = new Set(['cookie', 'host', 'origin', 'referer', 'user-agent', 'x-frontend-id']);
const TIMEOUT_MS = 15_000;

function isNicoHost(host: string): boolean {
  return host === 'nicovideo.jp' || host.endsWith('.nicovideo.jp');
}

/**
 * ニコ生ゲームの external.api (投票・フォローなど) の HTTP 要求を、ログイン済みの Cookie を付けて代理送信する。
 * ゲームのコードは外部から読み込んだものなので、宛先は https の nicovideo.jp ドメインだけに絞る。
 */
export async function sendAkashicApi(req: LiveAkashicApiRequest): Promise<LiveAkashicApiResponse> {
  const url = new URL(String(req.url));
  if (url.protocol !== 'https:' || !isNicoHost(url.hostname)) {
    throw new Error(`許可されていない宛先です: ${url.origin}`);
  }
  for (const [k, v] of Object.entries(req.queries ?? {})) url.searchParams.set(k, String(v));
  const method = String(req.method ?? 'GET').toUpperCase();
  if (!ALLOWED_METHODS.has(method)) throw new Error(`許可されていないメソッドです: ${method}`);

  const headers: Record<string, string> = {
    'X-Frontend-Id': NicoHeaders.LIVE_FRONTEND_ID,
    Origin: LIVE_ORIGIN,
    Referer: `${LIVE_ORIGIN}/`
  };
  for (const [k, v] of Object.entries(req.headers ?? {})) {
    if (!FORBIDDEN_HEADERS.has(k.toLowerCase())) headers[k] = String(v);
  }
  if (req.contentType) headers['Content-Type'] = req.contentType;
  const hasBody = req.body !== undefined && req.body !== null && method !== 'GET';

  log.info(`${method} ${url.origin}${url.pathname}`);
  const res = await NicoContext.get().http.fetch(url.toString(), {
    method,
    headers,
    body: hasBody ? (typeof req.body === 'string' ? req.body : JSON.stringify(req.body)) : undefined,
    timeoutMs: TIMEOUT_MS
  });
  const contentType = res.headers.get('content-type') ?? undefined;
  const text = await res.text();
  let body: unknown = text;
  if (contentType?.includes('json')) {
    try {
      body = JSON.parse(text);
    } catch {
      // JSON でなければ文字列のまま返す
    }
  }
  log.info(`${method} ${url.pathname} -> HTTP ${res.status}`);
  return { status: res.status, contentType, body };
}
