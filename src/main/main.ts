import { app, BrowserWindow, shell, nativeTheme } from 'electron';
import { IpcChannel } from '@shared/types';
import path from 'node:path';
import fs from 'node:fs';
import { electronApp, optimizer, is } from '@electron-toolkit/utils';
import { LibraryManager } from './db/LibraryManager';
import { getConfigStore } from './config/ConfigStore';
import { registerIpcHandlers } from './ipc/registerIpc';
import { createLogger, setLogLevel } from './util/Logger';
import { NicoContext } from './nicovideo/NicoContext';
import {
  registerScheme,
  registerProtocolHandler,
  autoConfigureAllowedRoots
} from './player/LocalVideoProtocol';
import {
  startStreamServer,
  stopStreamServer
} from './player/StreamServer';
import { PlayerManager } from './player/PlayerManager';
import { NnddHttpServer } from './server/NnddHttpServer';
import { TrayManager } from './tray/TrayManager';

const log = createLogger('Main');

let mainWindow: BrowserWindow | null = null;
let library: LibraryManager | null = null;
let httpServer: NnddHttpServer | null = null;
let trayManager: TrayManager | null = null;

// Windows: setZoomFactor後にGPUデコード動画が黒くなるバグ対策 (Electron 33 / Chromium 130)
if (process.platform === 'win32') {
  app.commandLine.appendSwitch('disable-accelerated-video-decode');
  app.commandLine.appendSwitch('disable-features', 'D3D11VideoDecoder,D3D12VideoDecoder');
}
// DEV: renderer remote debugging (removed after testing)
if (process.env['NODE_ENV'] !== 'production') {
  app.commandLine.appendSwitch('remote-debugging-port', '9222');
}

// app.whenReady() より前にスキーム登録が必要
registerScheme();

// 多重起動防止: 2つ目のインスタンスは既存ウィンドウを復元して終了
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  });
}

function createMainWindow(): BrowserWindow {
  const config = getConfigStore();
  const winConfig = config.get('ui').window;
  const bgColor = config.get('ui').theme === 'light' ? '#f0f0f0' : '#1e1e1e';

  const win = new BrowserWindow({
    width: winConfig.width,
    height: winConfig.height,
    x: winConfig.x,
    y: winConfig.y,
    minWidth: 960,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    frame: true,
    backgroundColor: bgColor,
    title: 'NNDD-RE',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (winConfig.maximized) {
    win.maximize();
  }

  win.on('ready-to-show', () => {
    win.show();
  });

  // 閉じるボタンでもトレイ常駐 (設定で有効化されている場合)
  win.on('close', (e) => {
    const cfg = getConfigStore();
    if (cfg.get('tray').minimizeToTray && !(app as unknown as { isQuiting?: boolean }).isQuiting) {
      e.preventDefault();
      win.hide();
    }
  });

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  // ウィンドウサイズ・位置を保存
  const saveBounds = (): void => {
    if (!win.isMaximized()) {
      const b = win.getBounds();
      config.set('ui.window', {
        width: b.width,
        height: b.height,
        x: b.x,
        y: b.y,
        maximized: false
      });
    } else {
      config.set('ui.window.maximized', true);
    }
  };
  win.on('resize', saveBounds);
  win.on('move', saveBounds);
  win.on('maximize', () => {
    config.set('ui.window.maximized', true);
    win.webContents.send(IpcChannel.WIN_MAXIMIZE_CHANGED, true);
  });
  win.on('unmaximize', () => {
    config.set('ui.window.maximized', false);
    win.webContents.send(IpcChannel.WIN_MAXIMIZE_CHANGED, false);
  });

  // 開発時は Vite dev server, プロダクションは out/renderer/index.html
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  return win;
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('org.mineap.nndd-re');

  app.on('browser-window-created', (_, w) => {
    optimizer.watchWindowShortcuts(w);
  });

  // データディレクトリ自動マイグレーション (NNDD-electron → NNDD-rebuild → NNDD-RE)
  const docsDir = app.getPath('documents');
  const migrateDir = (src: string, dst: string): void => {
    if (fs.existsSync(src) && !fs.existsSync(dst)) {
      try {
        fs.renameSync(src, dst);
        log.info(`Migrated data directory: ${src} → ${dst}`);
      } catch (err) {
        log.warn(`Failed to migrate data directory (${(err as NodeJS.ErrnoException).code}): ${src} → ${dst}`);
      }
    }
  };
  migrateDir(path.join(docsDir, 'NNDD-electron'), path.join(docsDir, 'NNDD-rebuild'));
  migrateDir(path.join(docsDir, 'NNDD-rebuild'), path.join(docsDir, 'NNDD-RE'));

  // ライブラリ (DB) 初期化 — DB は常にデフォルト位置 (Documents/NNDD-RE/)
  const config = getConfigStore();
  setLogLevel(config.get('logLevel'));
  library = LibraryManager.createDefault();

  // 動画保存先: libraryRoot 設定があればそこ、なければデフォルト (library/Downloads)
  const configuredVideoDir = config.get('libraryRoot');
  if (configuredVideoDir) {
    library.videoDir = configuredVideoDir;
  }

  // 必要ディレクトリ作成
  for (const d of [
    library.rootDir,
    library.libraryDir,
    library.systemDir,
    library.tempDir,
    library.playlistDir,
    library.logDir,
    library.videoDir
  ]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
  log.info('Library root:', library.rootDir, '/ videoDir:', library.videoDir);

  // ローカル動画再生プロトコルを設定
  const cacheRoot = config.get('cacheRoot');
  const extraPaths = [library.libraryDir, library.rootDir, library.videoDir];
  if (cacheRoot) extraPaths.push(path.join(String(cacheRoot), 'cache', 'movie'));
  autoConfigureAllowedRoots(extraPaths);
  registerProtocolHandler();
  await startStreamServer();

  // ニコニコAPI コンテキスト初期化 (Cookie読込)
  await NicoContext.initialize();

  // 画像キャッシュ: 起動時にフォルダを確保 + 設定値を反映
  {
    const { ImageCache } = await import('./util/ImageCache');
    const ic = config.get('imageCache');
    ImageCache.setEnabled(ic.enabled);
    ImageCache.setMaxSizeMb(ic.maxSizeMb);
    // フォルダを明示的に作成して常駐させる (lazy init に依存しない)
    fs.mkdirSync(ImageCache.cacheDir, { recursive: true });
  }

  // ネイティブタイトルバーの明暗をテーマに合わせる
  nativeTheme.themeSource = config.get('ui').theme === 'light' ? 'light' : 'dark';

  // メインウィンドウ生成
  mainWindow = createMainWindow();

  // システムトレイ初期化 (IPC登録より先に行い、参照を渡す)
  trayManager = new TrayManager(() => mainWindow);
  trayManager.initialize();

  // IPC 登録 (トレイ参照・メインウィンドウ参照を渡して通知連携)
  registerIpcHandlers(library, trayManager, () => mainWindow);

  // 内蔵HTTPサーバー起動 (設定が有効な場合)
  const httpCfg = config.get('httpServer');
  if (httpCfg.enabled) {
    httpServer = new NnddHttpServer(library);
    try {
      await httpServer.start();
    } catch (e) {
      log.warn('HTTP server start failed:', e);
    }
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // システムトレイが有効ならアプリは終了しない (最小化トレイ動作)
  const config = getConfigStore();
  if (config.get('tray').minimizeToTray && trayManager) {
    return;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  (app as unknown as { isQuiting?: boolean }).isQuiting = true;
  stopStreamServer();
  PlayerManager.get().closeAll();
  // ストリーミングキャッシュ (userData/cache/movie) は次回シーク再生のため保持する
  if (httpServer) {
    await httpServer.stop().catch(() => undefined);
    httpServer = null;
  }
  if (trayManager) {
    trayManager.destroy();
    trayManager = null;
  }
  if (library) {
    library.close();
    library = null;
  }
});
