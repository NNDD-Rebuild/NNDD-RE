import { Tray, Menu, BrowserWindow, nativeImage, app, Notification } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { getConfigStore } from '../config/ConfigStore';
import { createLogger } from '../util/Logger';

const log = createLogger('Tray');

/**
 * システムトレイ管理。
 * 元: src/org/mineap/nndd/SystemTrayIconManager.as
 *
 *  - クリック: メインウィンドウを復元
 *  - 右クリック: メニュー (表示/DLリスト/設定/終了)
 *  - DL完了通知
 */
export class TrayManager {
  private tray: Tray | null = null;
  private mainWindowGetter: () => BrowserWindow | null;

  constructor(mainWindowGetter: () => BrowserWindow | null) {
    this.mainWindowGetter = mainWindowGetter;
  }

  initialize(): void {
    const enabled = getConfigStore().get('tray').enabled;
    if (!enabled) {
      log.info('tray disabled by config');
      return;
    }

    // アイコン読み込み (build/icon.png または resources/icons/tray.png)
    const iconPath = this.resolveIconPath();
    const img = iconPath
      ? nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
      : nativeImage.createEmpty();

    this.tray = new Tray(img);
    this.tray.setToolTip('NNDD-RE - ニコニコ動画 ダウンローダー');
    this.applyContextMenu();
    this.tray.on('click', () => this.showMain());
    this.tray.on('double-click', () => this.showMain());

    log.info('tray initialized');
  }

  private resolveIconPath(): string | null {
    const candidates = [
      path.join(process.resourcesPath, 'build', 'icon.png'),
      path.join(__dirname, '../../build/icon.png'),
      path.join(app.getAppPath(), 'build', 'icon.png'),
      path.join(__dirname, '../../resources/icons/tray.png')
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  private applyContextMenu(): void {
    if (!this.tray) return;
    const menu = Menu.buildFromTemplate([
      {
        label: 'NNDD-RE を表示',
        click: () => this.showMain()
      },
      {
        label: 'DLリストを開く',
        click: () => {
          const w = this.mainWindowGetter();
          if (w) {
            w.show();
            w.webContents.send('nndd:tray:openTab', 'download');
          }
        }
      },
      { type: 'separator' },
      {
        label: '設定...',
        click: () => {
          const w = this.mainWindowGetter();
          if (w) {
            w.show();
            w.webContents.send('nndd:tray:openTab', 'settings');
          }
        }
      },
      { type: 'separator' },
      {
        label: '終了',
        click: () => {
          app.quit();
        }
      }
    ]);
    this.tray.setContextMenu(menu);
  }

  /** メインウィンドウを最前面に表示する。 */
  showMain(): void {
    const w = this.mainWindowGetter();
    if (!w) return;
    if (w.isMinimized()) w.restore();
    if (!w.isVisible()) w.show();
    w.focus();
  }

  /** 通知を表示 (DL完了等)。 */
  notify(title: string, body: string): void {
    if (!Notification.isSupported()) return;
    const n = new Notification({
      title,
      body,
      silent: false
    });
    n.on('click', () => this.showMain());
    n.show();
  }

  destroy(): void {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}
