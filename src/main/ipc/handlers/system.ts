import path from 'node:path';
import { ipcMain, dialog, shell, app, BrowserWindow } from 'electron';
import { IpcChannel } from '@shared/types';
import { ConnectionDiag } from '../../nicovideo';
import { YtDlpStreamer } from '../../nicovideo/video/YtDlpStreamer';
import { BinaryInstaller } from '../../util/BinaryInstaller';
import { getUpdateManager } from '../../update/UpdateManager';
import {
  createLogger,
  readLogTail,
  clearLog,
  getLogFilePath
} from '../../util/Logger';
import type { IpcHandlerContext } from './context';

const log = createLogger('IPC');

/**
 * システム (SYS_*)・接続診断 (DIAG_*)・ログ (LOG_*)・自動更新 (UPDATE_*)・
 * 外部バイナリ管理 (BINARY_*)・メインウィンドウ制御 (WIN_*)。
 */
export function registerSystemHandlers(ctx: IpcHandlerContext): void {
  const { library, mainWindowGetter } = ctx;

  // --- システム ---
  ipcMain.handle(IpcChannel.SYS_GET_VERSION, () => {
    return app.getVersion();
  });

  ipcMain.handle(IpcChannel.SYS_GET_APP_INFO, () => ({
    version: app.getVersion(),
    userData: app.getPath('userData'),
    libraryRoot: library.rootDir,
    dbPath: path.join(library.systemDir, 'library.db'),
    cookiePath: path.join(library.systemDir, 'cookies.json'),
    logPath: getLogFilePath(),
    cacheDir: YtDlpStreamer.cacheDir(),
  }));

  ipcMain.handle(
    IpcChannel.SYS_CHOOSE_DIRECTORY,
    async (e, defaultPath?: string) => {
      const win = BrowserWindow.fromWebContents(e.sender);
      const result = await dialog.showOpenDialog(win ?? undefined!, {
        properties: ['openDirectory', 'createDirectory'],
        defaultPath
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      return result.filePaths[0];
    }
  );

  ipcMain.handle(
    IpcChannel.SYS_CHOOSE_FILE,
    async (e, filters?: Electron.FileFilter[]) => {
      const win = BrowserWindow.fromWebContents(e.sender);
      const result = await dialog.showOpenDialog(win ?? undefined!, {
        properties: ['openFile'],
        filters
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      return result.filePaths[0];
    }
  );

  ipcMain.handle(IpcChannel.SYS_OPEN_PATH, async (_e, p: string) => {
    // http(s) URL は openPath (ローカルファイル用) に渡すとネイティブ層で不正動作するため openExternal で開く
    if (/^https?:\/\//i.test(p)) {
      // Linuxでは既定ブラウザ (xdg-open) が存在しない環境で shell.openExternal を呼ぶと
      // ネイティブクラッシュすることがあるため、事前に存在確認する
      if (process.platform === 'linux') {
        const { execFile } = await import('node:child_process');
        const hasXdgOpen = await new Promise<boolean>((resolve) => {
          execFile('which', ['xdg-open'], (err) => resolve(!err));
        });
        if (!hasXdgOpen) {
          log.warn('xdg-open が見つからないため外部リンクを開けません:', p);
          return '';
        }
      }
      await shell.openExternal(p);
      return '';
    }
    return shell.openPath(p);
  });

  // --- 内蔵ブラウザウィンドウで開く ---
  ipcMain.handle(IpcChannel.SYS_OPEN_IN_BROWSER, (_e, url: string) => {
    const browserWin = new BrowserWindow({
      width: 960,
      height: 720,
      title: url,
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true
      }
    });
    if (url.startsWith('file://') || url.startsWith('/') || /^[A-Za-z]:[/\\]/.test(url)) {
      void browserWin.loadURL(`file:///${url.replace(/\\/g, '/').replace(/^\/+/, '')}`);
    } else {
      void browserWin.loadURL(url);
    }
    browserWin.show();
    return true;
  });

  // --- 接続診断 ---
  ipcMain.handle(IpcChannel.DIAG_RUN, async () => {
    return ConnectionDiag.runAll();
  });

  // --- ログ ---
  ipcMain.handle(IpcChannel.LOG_READ, (_e, bytes?: number) =>
    readLogTail(bytes ?? 64 * 1024)
  );
  ipcMain.handle(IpcChannel.LOG_CLEAR, () => {
    clearLog();
    return true;
  });
  ipcMain.handle(IpcChannel.LOG_GET_PATH, () => getLogFilePath());

  // --- 自動更新 ---
  ipcMain.handle(IpcChannel.UPDATE_CHECK, async () => {
    return getUpdateManager().check();
  });
  ipcMain.handle(IpcChannel.UPDATE_DOWNLOAD, async () => {
    return getUpdateManager().download();
  });
  ipcMain.handle(IpcChannel.UPDATE_INSTALL, () => {
    getUpdateManager().install();
    return true;
  });

  // バイナリ管理
  ipcMain.handle(IpcChannel.BINARY_STATUS, async () => {
    const [ytDlp, ffmpeg] = await Promise.all([
      BinaryInstaller.checkYtDlp(),
      BinaryInstaller.checkFfmpeg(),
    ]);
    return {
      ytDlp, ffmpeg,
      canAutoInstallFfmpeg: BinaryInstaller.canAutoInstallFfmpeg(),
      hasWinget: await BinaryInstaller.checkWinget(),
      platform: process.platform,
      localPaths: {
        ytDlp: BinaryInstaller.ytDlpLocalPath(),
        ffmpeg: BinaryInstaller.ffmpegLocalPath(),
      }
    };
  });

  ipcMain.handle(IpcChannel.BINARY_INSTALL_YT_DLP, async (event) => {
    const status = await BinaryInstaller.checkYtDlp();
    await BinaryInstaller.installYtDlp(status.found, (pct) => {
      event.sender.send(IpcChannel.BINARY_INSTALL_PROGRESS, { tool: 'yt-dlp', pct });
    });
  });

  ipcMain.handle(IpcChannel.BINARY_INSTALL_FFMPEG, async (event) => {
    const status = await BinaryInstaller.checkFfmpeg();
    await BinaryInstaller.installFfmpegSuite(status.found, (pct) => {
      event.sender.send(IpcChannel.BINARY_INSTALL_PROGRESS, { tool: 'ffmpeg', pct });
    });
  });

  // ウィンドウ制御 (カスタムタイトルバー)
  ipcMain.handle(IpcChannel.WIN_IS_MAXIMIZED, () => mainWindowGetter?.()?.isMaximized() ?? false);
  ipcMain.on(IpcChannel.WIN_MINIMIZE, () => mainWindowGetter?.()?.minimize());
  ipcMain.on(IpcChannel.WIN_MAXIMIZE_TOGGLE, () => {
    const win = mainWindowGetter?.();
    if (!win) return;
    win.isMaximized() ? win.unmaximize() : win.maximize();
  });
  ipcMain.on(IpcChannel.WIN_CLOSE, () => mainWindowGetter?.()?.close());
}
