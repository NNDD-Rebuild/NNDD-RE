import { NicoContext } from '../NicoContext';
import { NicoAuthCookieName } from '@shared/constants';
import { createLogger } from '../../util/Logger';

const log = createLogger('NicoFormLogin');

export interface FormLoginResult {
  ok: boolean;
  /** 2段階認証必須の場合 true */
  mfaRequired?: boolean;
  /**
   * MFA入力フォーム送信URL (例: https://account.nicovideo.jp/mfa?site=niconico&...).
   * 続けて completeMfa() に渡す。
   */
  mfaSubmitUrl?: string;
  error?: string;
}

/**
 * ID/Pass によるアプリ内ログインクライアント。
 * 元: nicovideo4as の LoginUtil.as / Niconicome の Auth.cs (WebView2非依存版)
 *
 * 1) POST https://account.nicovideo.jp/api/v1/login?site=niconico&next_url=/
 *    - body: x-www-form-urlencoded `mail_tel=<email>&password=<pass>`
 *    - 成功 (302 Set-Cookie user_session 付き): 認証完了
 *    - MFA要 (302 Location: /mfa?...): mfaSubmitUrl を保持して待機
 *    - 失敗 (200 or 302 → /login?message=...): error
 *
 * 2) POST <mfaSubmitUrl>
 *    - body: x-www-form-urlencoded `otp=<code>&loginBouncerChallengeResponseToken=...`
 *      (loginBouncer のチャレンジは MFAページHTMLから抽出)
 *    - 成功時 user_session Cookie 取得
 */
export class NicoFormLoginClient {
  static readonly LOGIN_POST_URL =
    'https://account.nicovideo.jp/api/v1/login?site=niconico&next_url=%2F';

  static async login(email: string, password: string): Promise<FormLoginResult> {
    const ctx = NicoContext.get();
    const body = new URLSearchParams({
      mail_tel: email,
      password
    }).toString();

    // POST → 302 を最大 5 回まで手動追跡し、途中で MFA ページに飛んだら抜ける。
    // (ニコニコは認証成功後 /login?next_url= → / に多段リダイレクトすることがある)
    let currentUrl = this.LOGIN_POST_URL;
    let currentMethod: 'POST' | 'GET' = 'POST';
    let currentBody: string | undefined = body;
    let lastLocation = '';
    let mfaUrl: string | null = null;

    for (let hop = 0; hop < 5; hop++) {
      const headers: Record<string, string> = {
        Origin: 'https://account.nicovideo.jp',
        Referer:
          hop === 0 ? 'https://account.nicovideo.jp/login' : currentUrl
      };
      if (currentMethod === 'POST') {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
      }
      const res = await ctx.http.fetch(currentUrl, {
        method: currentMethod,
        headers,
        body: currentBody,
        redirect: 'manual'
      });
      lastLocation = res.headers.get('location') ?? '';
      log.debug(
        `login hop=${hop} ${currentMethod} ${currentUrl} → ${res.status}`,
        lastLocation
      );

      // 認証成功で Set-Cookie 経由で user_session を受け取り済み
      if (await ctx.cookieStore.hasLoginCookie()) {
        await ctx.cookieStore.save();
        return { ok: true };
      }

      // MFA ページに飛んだら確定して抜ける
      if (lastLocation.includes('/mfa')) {
        mfaUrl = lastLocation.startsWith('http')
          ? lastLocation
          : `https://account.nicovideo.jp${lastLocation}`;
        break;
      }

      // 302/303 ならその location を GET でフォローする
      if (
        (res.status === 301 ||
          res.status === 302 ||
          res.status === 303 ||
          res.status === 307 ||
          res.status === 308) &&
        lastLocation
      ) {
        currentUrl = lastLocation.startsWith('http')
          ? lastLocation
          : new URL(lastLocation, currentUrl).toString();
        currentMethod = 'GET';
        currentBody = undefined;
        continue;
      }

      // それ以外はリダイレクトループ終了
      break;
    }

    if (mfaUrl) {
      return { ok: false, mfaRequired: true, mfaSubmitUrl: mfaUrl };
    }

    log.warn('login failed, lastLocation=', lastLocation);
    return {
      ok: false,
      error:
        lastLocation.includes('message=')
          ? decodeURIComponent(
              lastLocation.split('message=')[1] ?? 'login_failed'
            )
          : 'メールアドレスまたはパスワードが正しくありません'
    };
  }

  /**
   * MFAコードを送信して認証を完了させる。
   * `mfaSubmitUrl` には login() が返した location を渡す。
   */
  static async completeMfa(
    mfaSubmitUrl: string,
    code: string
  ): Promise<FormLoginResult> {
    const ctx = NicoContext.get();

    // 1) MFA入力フォーム HTML を取得して loginBouncer のチャレンジを抽出
    const html = await ctx.http.getText(mfaSubmitUrl, {
      headers: { Accept: 'text/html,application/xhtml+xml' }
    });

    // loginBouncerChallengeResponseToken は input value=... の前後どちらに name= が来ても抽出可能にする。
    // 大文字小文字違い・空白量違いにも耐えるよう [\s\S] と \s* を使う。
    const tokenRe =
      /<input\b[^>]*\bname=["']loginBouncerChallengeResponseToken["'][^>]*\bvalue=["']([^"']+)["']/i;
    const tokenReRev =
      /<input\b[^>]*\bvalue=["']([^"']+)["'][^>]*\bname=["']loginBouncerChallengeResponseToken["']/i;
    const tokenMatch = html.match(tokenRe) || html.match(tokenReRev);

    // form は MFA用のものを優先抽出 (id/class/action に "mfa" を含む)。
    // 該当なしなら最初の form を使う。
    const mfaFormMatch = html.match(
      /<form\b[^>]*(?:id|class|action)=["'][^"']*mfa[^"']*["'][^>]*>/i
    );
    const formMatch = mfaFormMatch ?? html.match(/<form\b[^>]*>/i);
    const actionMatch = formMatch?.[0].match(/\baction=["']([^"']+)["']/i);

    const submitUrl = actionMatch
      ? actionMatch[1].startsWith('http')
        ? actionMatch[1]
        : new URL(actionMatch[1], mfaSubmitUrl).toString()
      : mfaSubmitUrl;

    const params = new URLSearchParams({ otp: code });
    if (tokenMatch?.[1]) {
      params.set('loginBouncerChallengeResponseToken', tokenMatch[1]);
    }
    // 「このデバイスを記憶する」相当
    params.set('is_mfa_trusted_device', 'true');

    // 2) MFA POST → リダイレクトを最大 5 回追跡。途中で user_session が取れれば成功
    let currentUrl = submitUrl;
    let currentMethod: 'POST' | 'GET' = 'POST';
    let currentBody: string | undefined = params.toString();
    let lastLocation = '';

    for (let hop = 0; hop < 5; hop++) {
      const headers: Record<string, string> = {
        Origin: 'https://account.nicovideo.jp',
        Referer: hop === 0 ? mfaSubmitUrl : currentUrl
      };
      if (currentMethod === 'POST') {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
      }
      const res = await ctx.http.fetch(currentUrl, {
        method: currentMethod,
        headers,
        body: currentBody,
        redirect: 'manual'
      });
      lastLocation = res.headers.get('location') ?? '';
      log.debug(
        `mfa hop=${hop} ${currentMethod} ${currentUrl} → ${res.status}`,
        lastLocation
      );

      if (await ctx.cookieStore.hasLoginCookie()) {
        await ctx.cookieStore.save();
        return { ok: true };
      }

      if (
        (res.status === 301 ||
          res.status === 302 ||
          res.status === 303 ||
          res.status === 307 ||
          res.status === 308) &&
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

    return {
      ok: false,
      error: lastLocation.includes('message=')
        ? decodeURIComponent(
            lastLocation.split('message=')[1] ?? 'mfa_failed'
          )
        : '2段階認証コードが正しくありません'
    };
  }

  /** ログインCookieが既に有効か (api 呼び出し前に確認用) */
  static async hasSession(): Promise<boolean> {
    const ctx = NicoContext.get();
    const cookies = await ctx.cookieStore.cookieHeader('https://www.nicovideo.jp/');
    return cookies.includes(`${NicoAuthCookieName.USER_SESSION}=`);
  }
}
