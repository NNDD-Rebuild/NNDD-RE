import { NicoContext } from '../NicoContext';
import { createLogger } from '../../util/Logger';

const log = createLogger('ApiLoginClient');

/**
 * tier-1 の高速サイレントログイン結果。
 * - ok:         user_session 取得成功
 * - wrongCreds: サーバーが資格情報を処理して拒否 (message=... )。ID/Pass が明確に誤り。
 *               → 上位はウィンドウ方式に進まず即エラー表示すべき
 * - mfa:        2段階認証が必要 → 上位はログインウィンドウ(表示)でユーザーに解かせる
 * - blocked:    403 等サーバー手前での拒否 (Cloudflare Turnstile 要求の疑い) or 判定不能
 *               → 上位はウィンドウ方式(隠し→表示)にフォールバックすべき
 */
export type ApiLoginResult =
  | { status: 'ok' }
  | { status: 'wrongCreds'; message: string }
  | { status: 'mfa'; mfaSubmitUrl: string }
  | { status: 'blocked'; message: string };

/**
 * レガシー v1 API (`/api/v1/login`) による ID/Pass ログイン。
 * 元: nicovideo4as LoginUtil.as / Niconicome Auth.cs (旧 NicoFormLoginClient 相当)。
 *
 * NOTE (2026-07): ニコニコのログインは Cloudflare Turnstile 保護のSPAへ移行した。
 * この v1 API は **送信元IPがクリーンな時だけ Turnstile をバイパスして 302 で通る**
 * (トークン無しで受理される)。動画再生等でIPがWAFにフラグされると 403 になる。
 * よって本クライアントは「通れば速い・無音」な tier-1 の best-effort であり、
 * blocked/mfa 時は上位 (AuthManager) がブラウザウィンドウ方式へフォールバックする。
 * ctx.http (Electron undici, Cookieジャー統合) を用いるため、成功時 user_session は
 * 自動的に CookieStore へ保存される。
 */
export class ApiLoginClient {
  private static readonly LOGIN_POST_URL =
    'https://account.nicovideo.jp/api/v1/login?site=niconico&next_url=%2F';

  static async login(email: string, password: string): Promise<ApiLoginResult> {
    const ctx = NicoContext.get();
    const body = new URLSearchParams({ mail_tel: email, password }).toString();

    let currentUrl = this.LOGIN_POST_URL;
    let currentMethod: 'POST' | 'GET' = 'POST';
    let currentBody: string | undefined = body;
    let lastLocation = '';

    for (let hop = 0; hop < 5; hop++) {
      const headers: Record<string, string> = {
        Origin: 'https://account.nicovideo.jp',
        Referer: hop === 0 ? 'https://account.nicovideo.jp/login' : currentUrl
      };
      if (currentMethod === 'POST') {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
      }

      let status: number;
      try {
        const res = await ctx.http.fetch(currentUrl, {
          method: currentMethod,
          headers,
          body: currentBody,
          redirect: 'manual'
        });
        status = res.status;
        lastLocation = res.headers.get('location') ?? '';
      } catch (e) {
        log.warn('api login request failed:', e);
        return { status: 'blocked', message: `ネットワークエラー: ${String(e)}` };
      }

      log.debug(`login hop=${hop} ${currentMethod} → ${status}`, lastLocation);

      // Cloudflare/WAF によるサーバー手前拒否 → ウィンドウ方式へ委譲
      if (status === 403) {
        return { status: 'blocked', message: 'WAF/Turnstile によりブロックされました(403)' };
      }

      // 認証成功 (Set-Cookie 経由で user_session 受領済み)
      if (await ctx.cookieStore.hasLoginCookie()) {
        await ctx.cookieStore.save();
        return { status: 'ok' };
      }

      // MFA ページへ誘導
      if (lastLocation.includes('/mfa')) {
        const abs = lastLocation.startsWith('http')
          ? lastLocation
          : `https://account.nicovideo.jp${lastLocation}`;
        return { status: 'mfa', mfaSubmitUrl: abs };
      }

      // message= を含む = サーバーが資格情報を処理して拒否 (ID/Pass 誤り)
      if (lastLocation.includes('message=')) {
        const raw = lastLocation.split('message=')[1]?.split('&')[0] ?? '';
        return {
          status: 'wrongCreds',
          message: raw ? decodeURIComponent(raw) : 'cant_login'
        };
      }

      // 3xx リダイレクトを GET で追跡
      if (
        (status === 301 || status === 302 || status === 303 || status === 307 || status === 308) &&
        lastLocation
      ) {
        currentUrl = lastLocation.startsWith('http')
          ? lastLocation
          : new URL(lastLocation, currentUrl).toString();
        currentMethod = 'GET';
        currentBody = undefined;
        continue;
      }

      break;
    }

    // ここまで来たら判定不能 → 安全側でウィンドウ方式へ委譲
    return { status: 'blocked', message: '判定不能な応答' };
  }
}
