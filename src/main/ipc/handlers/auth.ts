import { ipcMain, BrowserWindow } from 'electron';
import { IpcChannel } from '@shared/types';
import { AccountManager, AuthManager, MyListClient, type SsoProvider } from '../../nicovideo';
import { MaintenanceMonitor } from '../../nicovideo/MaintenanceMonitor';
import { createLogger } from '../../util/Logger';
import type { IpcHandlerContext } from './context';

const log = createLogger('IPC');

/** ニコニコ動画の認証 (AUTH_*) */
export function registerAuthHandlers(): void {
  // --- 認証 ---
  ipcMain.handle(IpcChannel.AUTH_STATUS, async () => {
    return AuthManager.checkLoggedIn();
  });

  ipcMain.handle(
    IpcChannel.AUTH_OPEN_LOGIN_WINDOW,
    async (e, params?: { ssoProvider?: SsoProvider }) => {
      const parent = BrowserWindow.fromWebContents(e.sender) ?? undefined;
      return AuthManager.login(parent, params?.ssoProvider);
    }
  );

  ipcMain.handle(
    IpcChannel.AUTH_LOGIN_FORM,
    async (_e, params: { email: string; password: string }) => {
      return AuthManager.loginWithCredentials(params.email, params.password);
    }
  );

  ipcMain.handle(
    IpcChannel.AUTH_LOGIN_MFA,
    async (_e, params: { mfaSubmitUrl: string; code: string }) => {
      return AuthManager.completeMfa(params.mfaSubmitUrl, params.code);
    }
  );

  ipcMain.handle(IpcChannel.AUTH_LOGOUT, async () => {
    await AuthManager.logout();
    // アカウントが変わると自分のマイリストも変わるので、所有確認のキャッシュを捨てる
    MyListClient.clearOwnMylistCache();
    return true;
  });

  ipcMain.handle(IpcChannel.ACCOUNT_LIST, () => AccountManager.getState());

  ipcMain.handle(IpcChannel.ACCOUNT_SWITCH, async (_e, params: { id: string }) => {
    return AuthManager.switchAccount(params.id);
  });

  ipcMain.handle(IpcChannel.ACCOUNT_REMOVE, async (_e, params: { id: string }) => {
    // 削除対象がログイン中ならサーバー側もログアウトしてから Cookie を破棄する
    if (AccountManager.activeId === params.id) await AuthManager.logout();
    return AccountManager.remove(params.id);
  });

  ipcMain.handle(
    IpcChannel.AUTH_SAVE_CREDENTIALS,
    (_e, params: { email: string; password: string }) => {
      return AuthManager.saveCredentials(params.email, params.password);
    }
  );

  ipcMain.handle(IpcChannel.AUTH_CLEAR_CREDENTIALS, () => {
    AuthManager.clearCredentials();
  });

  ipcMain.handle(IpcChannel.AUTH_HAS_CREDENTIALS, () => {
    return AuthManager.hasCredentials();
  });

  ipcMain.handle(IpcChannel.AUTH_GET_SAVED_EMAIL, () => {
    return AuthManager.getSavedEmail();
  });

  ipcMain.handle(IpcChannel.AUTH_AUTO_RELOGIN, () => {
    return AuthManager.autoRelogin();
  });

  ipcMain.handle(IpcChannel.AUTH_LOGIN_WITH_SAVED, () => {
    return AuthManager.loginWithSavedCredentials();
  });
}

/**
 * ログインセッションの定期チェックを開始する (registerIpcHandlers の最後に呼ぶ)。
 */
export function startSessionCheck(ctx: IpcHandlerContext): void {
  const { mainWindowGetter } = ctx;

  AuthManager.setMfaNotifier((payload) => {
    const mainWin = mainWindowGetter?.();
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send(IpcChannel.AUTH_MFA_REQUEST, payload);
    }
  });

  AccountManager.setNotifier((state) => {
    const mainWin = mainWindowGetter?.();
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send(IpcChannel.ACCOUNT_CHANGED, state);
    }
  });

  // セッションチェック。切れていたら自動再ログイン、失敗時はrendererに通知。
  // 起動直後に1回 + 以後30分ごと (起動直後チェックがないと、数日放置後の起動でセッション切れに
  // 気付かないまま最初の動画再生を試みて失敗する)
  const checkSession = (): void => {
    void (async (): Promise<void> => {
      if (AuthManager.isLoggedOut) return;
      try {
        const ok = await AuthManager.checkLoggedIn();
        if (ok) {
          // プレミアム加入/解約やニックネーム変更を反映
          await AccountManager.refreshActiveProfile();
          return;
        }
        // メンテ中は 503 でログイン確認に失敗するだけ。期限切れ扱いで再ログインや通知を出さない
        if (MaintenanceMonitor.isActive('video')) return;
        const result = await AuthManager.autoRelogin();
        if (result.ok) {
          log.info('session expired, auto relogin succeeded');
          return;
        }
        if (result.noCredentials) return;
        const mainWin = mainWindowGetter?.();
        if (mainWin && !mainWin.isDestroyed()) {
          mainWin.webContents.send(IpcChannel.AUTH_SESSION_EXPIRED, {
            mfaRequired: result.mfaRequired,
            mfaSubmitUrl: result.mfaSubmitUrl
          });
        }
      } catch (e) {
        log.warn('session check error:', e);
      }
    })();
  };
  checkSession();
  setInterval(checkSession, 30 * 60 * 1000);
}
