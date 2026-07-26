import { buildDefaultHeaders } from '@shared/constants';
import { CookieStore } from './auth/CookieStore';
import { createLogger } from '../util/Logger';
import fs from 'node:fs';
import path from 'node:path';

const log = createLogger('NicoHttp');

/**
 * ニコニコAPIがエラーレスポンス (4xx) の body に埋め込む meta 情報。
 * 例: { meta: { status: 404, errorCode: "NOT_FOUND" } }
 */
interface NicoApiErrorBody {
  meta?: {
    status?: number;
    errorCode?: string;
    errorMessage?: string;
  };
}

/**
 * HTTPエラー時、bodyのJSONから読み取れた errorCode 等を保持する例外。
 * 動画の「非公開/削除済み/ログイン必要」等を呼び出し元で区別するために使う。
 */
export class NicoApiError extends Error {
  constructor(
    message: string,
    public readonly httpStatus: number,
    public readonly errorCode?: string,
    public readonly errorMessage?: string
  ) {
    super(message);
    this.name = 'NicoApiError';
  }
}

/** !res.ok 時、bodyをJSONとして読み取れれば errorCode 等を含む NicoApiError を返す */
async function buildApiError(url: string, res: Response, method = 'GET'): Promise<NicoApiError> {
  const text = await res.text().catch(() => '');
  let errorCode: string | undefined;
  let errorMessage: string | undefined;
  try {
    const body = JSON.parse(text) as NicoApiErrorBody;
    errorCode = body.meta?.errorCode;
    errorMessage = body.meta?.errorMessage;
  } catch {
    // bodyがJSONでない (HTMLエラーページ等) 場合はerrorCode無しで進める
  }
  log.warn(
    `${method} ${url} failed: HTTP ${res.status} errorCode=${errorCode ?? '(none)'} errorMessage=${errorMessage ?? '(none)'}`
  );
  return new NicoApiError(
    `${method} ${url} failed: HTTP ${res.status}${errorCode ? ` errorCode=${errorCode}` : ''}`,
    res.status,
    errorCode,
    errorMessage
  );
}

export interface NicoHttpOptions extends Omit<RequestInit, 'headers'> {
  headers?: Record<string, string>;
  /** Cookieを送らない場合 true */
  noCookie?: boolean;
  /** 自動的にレスポンスのSet-Cookieを取り込まない場合 true */
  noCookieReceive?: boolean;
  /** タイムアウト (ms) */
  timeoutMs?: number;
  /** APIレスポンスをダンプするフォルダパス */
  debugDumpPath?: string;
  /** APIレスポンスのダンプ用ラベル */
  debugLabel?: string;
}

/**
 * ニコニコAPI向け HTTPクライアント。
 * 元: Niconicome-develop NicoHttp.cs
 *
 * - 必須ヘッダー (X-Frontend-Id 等) を常に付与
 * - CookieStore と連動し、リクエストCookie送信・レスポンスSet-Cookie取り込みを自動化
 */
export class NicoHttp {
  constructor(private readonly cookieStore: CookieStore) {}

  async fetch(url: string, opts: NicoHttpOptions = {}): Promise<Response> {
    const headers: Record<string, string> = {
      ...buildDefaultHeaders(),
      ...(opts.headers ?? {})
    };

    if (!opts.noCookie) {
      const cookieHeader = await this.cookieStore.cookieHeader(url);
      if (cookieHeader) headers['Cookie'] = cookieHeader;
    }

    const controller = new AbortController();
    const timer = opts.timeoutMs
      ? setTimeout(() => controller.abort(), opts.timeoutMs)
      : null;

    try {
      const res = await fetch(url, {
        ...opts,
        headers,
        signal: opts.signal ?? controller.signal,
        redirect: opts.redirect ?? 'follow'
      });

      if (!opts.noCookieReceive) {
        const setCookies = res.headers.getSetCookie?.() ?? [];
        if (setCookies.length > 0) {
          await this.cookieStore.setCookies(setCookies, url);
          await this.cookieStore.save();
        }
      }

      return res;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async getText(url: string, opts: NicoHttpOptions = {}): Promise<string> {
    const res = await this.fetch(url, opts);
    if (!res.ok) {
      throw await buildApiError(url, res);
    }
    return res.text();
  }

  async getJson<T = unknown>(
    url: string,
    opts: NicoHttpOptions = {}
  ): Promise<T> {
    // ニコニコの watch v3 等は Apache の Content Negotiation で
    // Accept: application/json 単体を送ると 406 を返す ("Available variants: v3.php")。
    // 必ず */* を含めてリクエストする。
    const res = await this.fetch(url, {
      ...opts,
      headers: { Accept: 'application/json, */*;q=0.8', ...(opts.headers ?? {}) }
    });
    if (!res.ok) {
      throw await buildApiError(url, res);
    }
    const data = (await res.json()) as T;

    // debugDumpPath が指定されている場合、レスポンスを保存
    if (opts.debugDumpPath) {
      this.dumpResponse(opts.debugDumpPath, opts.debugLabel || 'api', url, data);
    }

    return data;
  }

  async postJson<T = unknown>(
    url: string,
    body: unknown,
    opts: NicoHttpOptions = {}
  ): Promise<T> {
    const res = await this.fetch(url, {
      ...opts,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, */*;q=0.8',
        ...(opts.headers ?? {})
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      throw await buildApiError(url, res, 'POST');
    }
    const data = (await res.json()) as T;

    // debugDumpPath が指定されている場合、リクエスト＋レスポンスを保存
    if (opts.debugDumpPath) {
      this.dumpResponse(opts.debugDumpPath, opts.debugLabel || 'api', url, data, body);
    }
    
    return data;
  }

  /**
   * APIレスポンスをJSONファイルに保存する
   */
  private dumpResponse(
    dumpDir: string,
    label: string,
    url: string,
    responseData: unknown,
    requestBody?: unknown
  ): void {
    try {
      if (!fs.existsSync(dumpDir)) {
        fs.mkdirSync(dumpDir, { recursive: true });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${label}-${timestamp}.json`;
      const filepath = path.join(dumpDir, filename);

      const dump = {
        timestamp: new Date().toISOString(),
        url,
        request: requestBody ? { body: requestBody } : undefined,
        response: responseData
      };

      fs.writeFileSync(filepath, JSON.stringify(dump, null, 2), 'utf-8');
      log.debug(`API dump saved: ${filename}`);
    } catch (e) {
      log.warn('Failed to dump API response:', e);
    }
  }

  async getBinary(url: string, opts: NicoHttpOptions = {}): Promise<Buffer> {
    const res = await this.fetch(url, opts);
    if (!res.ok) {
      throw new Error(`GET ${url} failed: HTTP ${res.status}`);
    }
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  }
}
