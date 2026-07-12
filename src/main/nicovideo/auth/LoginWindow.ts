import { BrowserWindow, session } from 'electron';
import { NicoApi, NicoAuthCookieName } from '@shared/constants';
import { CookieStore } from './CookieStore';
import { createLogger } from '../../util/Logger';

const log = createLogger('LoginWindow');

/**
 * Electron BrowserWindow でニコニコ動画のログインページを開く。
 * 元: Niconicome-develop の Webview2SharedLogin.cs
 *
 * ユーザーが自分の認証情報 (メール+パスワード+2FA等) を入力してログインしたら、
 * Electron session の Cookie API から user_session/user_session_secure を吸い出し、
 * CookieStore に保存する。
 *
 * メリット:
 *  - ニコニコのログインフォーム仕様変更や CAPTCHA, 2FA に対応不要
 *  - 認証情報をアプリ側で扱わない (パスワードを持たない)
 */
export class LoginWindow {
  static async openAndCaptureCookie(
    cookieStore: CookieStore,
    parent?: BrowserWindow
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      // 専用のpartitionでセッションを分離 (メインのwebContentsと干渉させない)
      const partition = 'persist:nndd-login';
      const ses = session.fromPartition(partition);

      const win = new BrowserWindow({
        width: 480,
        height: 720,
        parent,
        modal: !!parent,
        autoHideMenuBar: true,
        title: 'ニコニコ動画 ログイン',
        webPreferences: {
          partition,
          contextIsolation: true,
          nodeIntegration: false
        }
      });

      let resolved = false;
      const finish = (success: boolean): void => {
        if (resolved) return;
        resolved = true;
        if (!win.isDestroyed()) win.close();
        resolve(success);
      };

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
            await cookieStore.setCookies(
              cookieStr,
              `https://${cookieDomain}/`
            );
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

      win.on('closed', () => finish(resolved));

      win.loadURL(NicoApi.LOGIN);
    });
  }
}
