import { ipcMain, BrowserWindow } from 'electron';
import { IpcChannel } from '@shared/types';
import type { IpcHandlerContext } from './context';

/**
 * プレイヤー窓 → メインウィンドウへのナビゲーション (NAV_*)。
 * navigateMylist は nndd-re-cmd:// 等 IPC 以外の経路からも呼ぶため返す。
 */
export function registerNavigationHandlers(ctx: IpcHandlerContext): {
  navigateMylist: (mylistId: string) => void;
} {
  const { mainWindowGetter } = ctx;

  // プレイヤーウィンドウ → メインウィンドウへのナビゲーション
  function navigateMylist(mylistId: string): void {
    const mainWin = mainWindowGetter?.();
    if (mainWin && !mainWin.isDestroyed()) {
      // メインウィンドウをフォアグラウンドに出してナビゲーション
      if (mainWin.isMinimized()) mainWin.restore();
      mainWin.show();
      mainWin.focus();
      mainWin.webContents.send(IpcChannel.NAV_MYLIST, mylistId);
    } else {
      // フォールバック: 全ウィンドウに送信
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send(IpcChannel.NAV_MYLIST, mylistId);
        }
      }
    }
  }
  ipcMain.handle(IpcChannel.NAV_MYLIST, (_e, mylistId: string) => {
    navigateMylist(mylistId);
  });

  // プレイヤーウィンドウ → メインウィンドウへのシリーズナビゲーション
  ipcMain.handle(IpcChannel.NAV_SERIES, (_e, seriesId: string) => {
    const mainWin = mainWindowGetter?.();
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.show();
      mainWin.focus();
      mainWin.webContents.send(IpcChannel.NAV_SERIES, seriesId);
    } else {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send(IpcChannel.NAV_SERIES, seriesId);
        }
      }
    }
  });

  ipcMain.handle(IpcChannel.NAV_SEARCH_TAG, (_e, tag: string) => {
    const mainWin = mainWindowGetter?.();
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.show();
      mainWin.focus();
      mainWin.webContents.send(IpcChannel.NAV_SEARCH_TAG, tag);
    } else {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send(IpcChannel.NAV_SEARCH_TAG, tag);
        }
      }
    }
  });

  // 生放送プレイヤー → メインウィンドウの生放送タブで番組検索
  ipcMain.handle(IpcChannel.NAV_LIVE_SEARCH, (_e, keyword: string) => {
    const mainWin = mainWindowGetter?.();
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.show();
      mainWin.focus();
      mainWin.webContents.send(IpcChannel.NAV_LIVE_SEARCH, String(keyword ?? ''));
    }
  });

  // プレイヤーウィンドウ → メインウィンドウへのフォローユーザーナビゲーション
  ipcMain.handle(
    IpcChannel.NAV_FOLLOW_USER,
    (_e, payload: { userId: string; nickname: string; iconUrl: string }) => {
      const mainWin = mainWindowGetter?.();
      if (mainWin && !mainWin.isDestroyed()) {
        mainWin.show();
        mainWin.focus();
        mainWin.webContents.send(IpcChannel.NAV_FOLLOW_USER, payload);
      } else {
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) {
            win.webContents.send(IpcChannel.NAV_FOLLOW_USER, payload);
          }
        }
      }
    }
  );

  return { navigateMylist };
}
