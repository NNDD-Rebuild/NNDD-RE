import { NicoApi } from '@shared/constants';
import { NicoContext } from './NicoContext';
import { AuthManager } from './auth/AuthManager';

export interface DiagResult {
  name: string;
  url: string;
  ok: boolean;
  status?: number;
  message?: string;
  durationMs: number;
}

/**
 * ニコニコ動画各サーバーへの疎通確認。
 *
 * 元: src/org/mineap/nndd/util/NicoServerStatusCheck.as
 */
export class ConnectionDiag {
  static async runAll(): Promise<{
    loggedIn: boolean;
    results: DiagResult[];
  }> {
    const targets: {
      name: string;
      url: string;
      method?: 'HEAD' | 'GET' | 'POST' | 'OPTIONS';
      body?: string;
    }[] = [
      { name: 'トップページ', url: NicoApi.TOP },
      { name: 'ログインページ', url: NicoApi.LOGIN },
      {
        name: '検索API (snapshot)',
        url: `${NicoApi.SEARCH_API}?q=test&targets=title&_offset=0&_limit=1&_context=nndd-diag`
      },
      {
        // nvComment は HEAD/GET 単体には 4xx/405 を返すため、
        // 実運用と同じ POST + 空 JSON で叩く (認証/threadKey 不要で接続性のみ判定する)。
        name: 'コメントサーバー',
        url: NicoApi.COMMENT_THREADS_V3,
        method: 'POST',
        body: '{}'
      },
      {
        name: 'マイリストAPI',
        url: 'https://nvapi.nicovideo.jp/v1/users/me/mylists'
      }
    ];

    const results: DiagResult[] = [];
    for (const t of targets) {
      results.push(await this.probe(t.name, t.url, t.method, t.body));
    }
    const loggedIn = await AuthManager.checkLoggedIn();
    return { loggedIn, results };
  }

  private static async probe(
    name: string,
    url: string,
    method: 'HEAD' | 'GET' | 'POST' | 'OPTIONS' = 'HEAD',
    body?: string
  ): Promise<DiagResult> {
    const start = Date.now();
    try {
      const ctx = NicoContext.get();
      const res = await ctx.http.fetch(url, {
        method,
        body,
        headers: body
          ? { 'Content-Type': 'application/json' }
          : undefined,
        timeoutMs: 8000,
        noCookieReceive: true
      });
      // 5xx (= サーバー側障害) のみ NG。
      // 4xx (= 入力不正/未認証) はサーバーが応答できている = 接続性は OK と判定する。
      return {
        name,
        url,
        ok: res.status < 500,
        status: res.status,
        durationMs: Date.now() - start
      };
    } catch (e) {
      return {
        name,
        url,
        ok: false,
        message: e instanceof Error ? e.message : String(e),
        durationMs: Date.now() - start
      };
    }
  }
}
