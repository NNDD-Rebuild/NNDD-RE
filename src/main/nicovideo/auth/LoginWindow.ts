import { BrowserWindow, session } from 'electron';
import { NicoApi, NicoAuthCookieName } from '@shared/constants';
import { CookieStore } from './CookieStore';
import { createLogger } from '../../util/Logger';

const log = createLogger('LoginWindow');

/** ニコニコ公式ログインページ上のSSOボタン aria-label */
export type SsoProvider = 'apple' | 'google' | 'line' | 'x' | 'facebook';

const SSO_ARIA_LABEL: Record<SsoProvider, string> = {
  apple: 'Appleでログイン',
  google: 'Googleでログイン',
  line: 'LINEでログイン',
  x: 'Xでログイン',
  facebook: 'Facebookでログイン'
};

export interface LoginWindowOptions {
  parent?: BrowserWindow;
  ssoProvider?: SsoProvider;
  /** ID/Pass を指定するとログインフォームへ自動入力し、Turnstile解決後に自動送信する */
  credentials?: { email: string; password: string };
  /** false でウィンドウ非表示 (自動再ログイン等のサイレント試行用)。既定 true */
  show?: boolean;
  /**
   * サイレント試行時のタイムアウト(ms)。この時間内に user_session が取れなければ false。
   * 指定しない場合はタイムアウトせず、ユーザーがウィンドウを閉じるまで待つ。
   */
  timeoutMs?: number;
}

/**
 * Electron BrowserWindow でニコニコ動画のログインページを開く。
 * 元: Niconicome-develop の Webview2SharedLogin.cs
 *
 * ユーザーが自分の認証情報 (メール+パスワード+2FA等) を入力してログインしたら、
 * Electron session の Cookie API から user_session/user_session_secure を吸い出し、
 * CookieStore に保存する。
 *
 * NOTE (2026-07): ニコニコのログインは Cloudflare Turnstile 保護の SPA
 * (`account.nicovideo.jp/spa/login/index.html`) に移行した。フォームは
 * `mailOrTel` / `password` に加えて `cf-turnstile-response` トークンを要求する。
 * このトークンは実ブラウザ上で Turnstile ウィジェットが生成するため、main プロセスから
 * API を直叩きする方式 (旧 NicoFormLoginClient) では原理的に突破できない
 * (IP がWAFにフラグされると 403)。本ウィンドウは実ブラウザ context なので Turnstile を
 * 正しく解決でき、ID/Pass 自動入力もこの中で行う。
 *
 * - ssoProvider 指定時: 公式SSOボタン (aria-labelで識別) を自動クリック
 * - credentials 指定時: mailOrTel/password を自動入力し、Turnstile解決 & submit有効化を
 *   待って自動送信 (managedモードなら平常時は自動、フラグ時はユーザーがウィンドウ上で解く)
 */
export class LoginWindow {
  static async openAndCaptureCookie(
    cookieStore: CookieStore,
    options: LoginWindowOptions = {}
  ): Promise<boolean> {
    const { parent, ssoProvider, credentials, show = true, timeoutMs } = options;
    return new Promise<boolean>((resolve) => {
      // 専用のpartitionでセッションを分離 (メインのwebContentsと干渉させない)
      const partition = 'persist:nndd-login';
      const ses = session.fromPartition(partition);

      const win = new BrowserWindow({
        width: 480,
        height: 720,
        parent,
        modal: !!parent && show,
        show,
        autoHideMenuBar: true,
        title: 'ニコニコ動画 ログイン',
        webPreferences: {
          partition,
          contextIsolation: true,
          nodeIntegration: false
        }
      });

      let resolved = false;
      let timer: NodeJS.Timeout | undefined;
      const finish = (success: boolean): void => {
        if (resolved) return;
        resolved = true;
        if (timer) clearTimeout(timer);
        if (!win.isDestroyed()) win.close();
        resolve(success);
      };

      if (timeoutMs) {
        timer = setTimeout(() => finish(false), timeoutMs);
      }

      const checkAndCapture = async (): Promise<void> => {
        try {
          const cookies = await ses.cookies.get({ domain: '.nicovideo.jp' });
          const userSession = cookies.find(
            (c) => c.name === NicoAuthCookieName.USER_SESSION
          );
          if (!userSession) return;
          // 認証成功 → CookieStore に取り込む
          for (const c of cookies) {
            const domain = c.domain ?? '.nicovideo.jp';
            const cookieDomain = domain.replace(/^\./, '');
            // expirationDate 未指定 (セッションCookie) の場合は付けない。
            // 付け忘れると tough-cookie 側で無期限扱いになり、実際のサーバー側の
            // 失効タイミングとローカルのCookie有効期限判定がズレる。
            const expiresPart = c.expirationDate
              ? `; Expires=${new Date(c.expirationDate * 1000).toUTCString()}`
              : '';
            const cookieStr = `${c.name}=${c.value}; Domain=${domain}; Path=${c.path ?? '/'}${expiresPart}${c.secure ? '; Secure' : ''}${c.httpOnly ? '; HttpOnly' : ''}`;
            await cookieStore.setCookies(cookieStr, `https://${cookieDomain}/`);
          }
          await cookieStore.save();
          log.info('Login cookies captured');
          finish(true);
        } catch (e) {
          log.warn('Cookie capture error:', e);
        }
      };

      // URL変化/ロード完了のたびにCookieをチェック
      win.webContents.on('did-navigate', checkAndCapture);
      win.webContents.on('did-frame-navigate', checkAndCapture);
      win.webContents.on('did-finish-load', checkAndCapture);

      if (ssoProvider) {
        let ssoInjected = false;
        win.webContents.on('did-finish-load', () => {
          if (ssoInjected) return;
          ssoInjected = true;
          const label = SSO_ARIA_LABEL[ssoProvider];
          // SPAのため描画完了まで待つ必要がある: ボタン出現までポーリングしてクリック
          win.webContents
            .executeJavaScript(
              `(() => {
                const label = ${JSON.stringify(label)};
                let tries = 0;
                const iv = setInterval(() => {
                  tries++;
                  const btn = document.querySelector('button[aria-label="' + label + '"]');
                  if (btn) { btn.click(); clearInterval(iv); }
                  else if (tries > 40) { clearInterval(iv); }
                }, 250);
              })()`
            )
            .catch((e) => log.warn('SSO auto-click injection failed:', e));
        });
      }

      if (credentials) {
        let credInjected = false;
        win.webContents.on('did-finish-load', () => {
          if (credInjected) return;
          credInjected = true;
          win.webContents
            .executeJavaScript(buildCredentialInjectionScript(credentials))
            .catch((e) => log.warn('credential injection failed:', e));
        });
      }

      win.on('closed', () => finish(resolved));

      win.loadURL(NicoApi.LOGIN);
    });
  }
}

/**
 * SPAログインフォームへ ID/Pass を流し込み、Turnstile解決 & submit有効化を待って
 * 自動送信するスクリプトを組み立てる。
 * React 制御の input には value setter + input/change イベントで反映させる。
 * Turnstile が managed(自動)なら平常時は即送信、interactive化した場合はユーザーが
 * ウィンドウ上でチャレンジを解いた時点で token が埋まり自動送信される。
 */
function buildCredentialInjectionScript(credentials: {
  email: string;
  password: string;
}): string {
  return `(() => {
    const EMAIL = ${JSON.stringify(credentials.email)};
    const PASS = ${JSON.stringify(credentials.password)};
    const setValue = (el, v) => {
      const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      desc.set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    let submitted = false;
    let tries = 0;
    const iv = setInterval(() => {
      tries++;
      const mail = document.querySelector('input[name="mailOrTel"]');
      const pass = document.querySelector('input[name="password"]');
      if (mail && pass) {
        if (mail.value !== EMAIL) setValue(mail, EMAIL);
        if (pass.value !== PASS) setValue(pass, PASS);
        const token = document.querySelector('input[name="cf-turnstile-response"]');
        const btn = Array.from(document.querySelectorAll('button')).find(
          (b) => (b.textContent || '').trim() === 'ログイン'
        );
        if (!submitted && token && token.value && btn && !btn.disabled) {
          submitted = true;
          btn.click();
          clearInterval(iv);
        }
      }
      if (tries > 480) clearInterval(iv); // ~120s で諦め (ユーザー操作待ちの上限)
    }, 250);
  })()`;
}
