import { BrowserWindow, session } from 'electron';
import { NICO_COOKIE_DOMAIN, NicoApi, NicoAuthCookieName } from '@shared/constants';
import { CookieStore } from './CookieStore';
import { MfaTrustStore } from './MfaTrustStore';
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
  /**
   * 2段階認証ページ検知時にコードを取得する。null (キャンセル) ならウィンドウを表示して手動入力に任せる。
   * error は前回コードが通らなかった場合のメッセージ。
   */
  requestMfaCode?: (error?: string) => Promise<string | null>;
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
    const { parent, ssoProvider, credentials, show = true, timeoutMs, requestMfaCode } = options;
    // 専用のpartitionでセッションを分離 (メインのwebContentsと干渉させない)
    const partition = 'persist:nndd-login';
    const ses = session.fromPartition(partition);
    // 前回の user_session が残っていると、フォーム送信前に「ログイン成功」と誤判定するためクリアする。
    // ただし 2段階認証の信頼済みデバイストークンは同じアカウントの分だけ書き戻す
    // (消しっぱなしだとログインのたびに 2段階認証と端末登録が走る)。別アカウントには引き継がない。
    if (credentials) {
      await ses.clearStorageData();
      await MfaTrustStore.restoreToSession(ses, credentials.email);
    }
    return new Promise<boolean>((resolve) => {

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

      let mfaSeen = false;
      let capturing = false;
      const checkAndCapture = async (): Promise<void> => {
        if (capturing) return;
        try {
          const cookies = await ses.cookies.get({ domain: NICO_COOKIE_DOMAIN });
          const userSession = cookies.find(
            (c) => c.name === NicoAuthCookieName.USER_SESSION
          );
          if (!userSession) return;
          capturing = true;
          // 認証成功 → CookieStore に取り込む
          for (const c of cookies) {
            const domain = c.domain ?? NICO_COOKIE_DOMAIN;
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
          // 信頼トークンは api.id.nicovideo.jp のホスト限定 Cookie のため上のループでは取れない。
          // 2段階認証を通した直後は user_session より遅れて入ることがあるので少し待つ
          if (credentials) {
            await MfaTrustStore.captureFromSession(ses, credentials.email, mfaSeen ? 3000 : 0);
          }
          log.info('Login cookies captured');
          finish(true);
        } catch (e) {
          capturing = false;
          log.warn('Cookie capture error:', e);
        }
      };

      // URL変化/ロード完了のたびにCookieをチェック
      win.webContents.on('did-navigate', checkAndCapture);
      win.webContents.on('did-frame-navigate', checkAndCapture);
      win.webContents.on('did-finish-load', checkAndCapture);

      // 2段階認証ページを通った場合、信頼トークンが user_session より遅れて入る可能性に備える
      const noteMfaPage = (): void => {
        if (win.webContents.getURL().includes('/mfa')) mfaSeen = true;
      };
      win.webContents.on('did-navigate', noteMfaPage);
      win.webContents.on('did-navigate-in-page', noteMfaPage);

      if (requestMfaCode) {
        let mfaBusy = false;
        const onNavigate = (): void => {
          if (mfaBusy || resolved || win.isDestroyed()) return;
          if (!win.webContents.getURL().includes('/mfa')) return;
          mfaBusy = true;
          // コード入力待ちはユーザー操作が必要なので、サイレント試行のタイムアウトを止める
          if (timer) clearTimeout(timer);
          void handleMfaPage().finally(() => {
            mfaBusy = false;
          });
        };
        const handleMfaPage = async (): Promise<void> => {
          log.info('MFA page detected:', win.webContents.getURL());
          let error: string | undefined;
          for (let attempt = 0; attempt < 5 && !resolved && !win.isDestroyed(); attempt++) {
            const code = await requestMfaCode(error);
            if (resolved || win.isDestroyed()) return;
            if (!code) {
              win.show();
              return;
            }
            const injected = await win.webContents
              .executeJavaScript(buildMfaInjectionScript(code))
              .catch((e) => {
                log.warn('mfa injection failed:', e);
                return null;
              });
            log.info('MFA injection result:', injected);
            if (!injected || !(injected as { ok: boolean }).ok) {
              win.show();
              return;
            }
            // 送信後、ページ遷移 (Cookie取得で finish) を待つ。変わらなければコード誤りとみなす
            await new Promise((r) => setTimeout(r, 12000));
            if (resolved || win.isDestroyed()) return;
            error = '認証コードが正しくないか、期限切れです。もう一度入力してください';
          }
          if (!resolved && !win.isDestroyed()) win.show();
        };
        win.webContents.on('did-navigate', onNavigate);
        win.webContents.on('did-navigate-in-page', onNavigate);
        win.webContents.on('did-finish-load', onNavigate);
      }

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

/**
 * 2段階認証ページのコード入力欄へコードを流し込み、送信ボタンを押す。
 * DOM 構造は未確定のため、見つけた input/button の構成を返してログに残す (selector 調整用)。
 */
function buildMfaInjectionScript(code: string): string {
  return `(async () => {
    const CODE = ${JSON.stringify(code)};
    const setValue = (el, v) => {
      const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      desc.set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    for (let i = 0; i < 40; i++) {
      const inputs = Array.from(document.querySelectorAll('input')).filter(
        (el) => visible(el) && !['hidden', 'checkbox', 'radio', 'password', 'submit', 'button'].includes(el.type)
      );
      if (inputs.length) {
        const info = {
          url: location.href,
          inputs: inputs.map((el) => ({ name: el.name, type: el.type, ac: el.autocomplete, im: el.inputMode, max: el.maxLength })),
          buttons: Array.from(document.querySelectorAll('button')).map((b) => (b.textContent || '').trim() + (b.disabled ? '(disabled)' : ''))
        };
        const boxes = inputs.filter((el) => el.maxLength === 1);
        if (boxes.length >= CODE.length) {
          boxes.forEach((el, idx) => setValue(el, CODE[idx] || ''));
        } else {
          setValue(inputs[0], CODE);
        }
        const device = inputs.find((el) => el.name === 'deviceName');
        if (device && !device.value.includes('NNDD-RE')) {
          const base = device.value.trim();
          setValue(device, base ? base + ' (NNDD-RE)' : 'NNDD-RE');
        }
        for (let j = 0; j < 20; j++) {
          await new Promise((r) => setTimeout(r, 250));
          const btn = Array.from(document.querySelectorAll('button')).find(
            (b) => !b.disabled && visible(b) && /認証|送信|確認|ログイン|次へ/.test(b.textContent || '')
          );
          if (btn) { btn.click(); return { ok: true, clicked: (btn.textContent || '').trim(), info }; }
        }
        return { ok: false, reason: 'no enabled submit button', info };
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    return { ok: false, reason: 'no input found', body: (document.body.innerText || '').slice(0, 300) };
  })()`;
}
