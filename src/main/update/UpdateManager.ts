import { autoUpdater } from 'electron-updater';
import {
  app,
  dialog,
  webContents,
  Notification,
  type BrowserWindow,
  type MessageBoxOptions
} from 'electron';
import { IpcChannel } from '@shared/types';
import { createLogger } from '../util/Logger';

const log = createLogger('Update');

/**
 * 自動更新管理。
 * `electron-updater` を使い GitHub Releases から更新を取得。
 *
 * 元: src/org/mineap/nndd/versionCheck/VersionChecker.as
 *      + libs/NativeApplicationUpdater
 */
export class UpdateManager {
  private initialized = false;

  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('checking-for-update', () =>
      this.broadcast({ event: 'checking' })
    );
    autoUpdater.on('update-available', (info) =>
      this.broadcast({ event: 'available', info })
    );
    autoUpdater.on('update-not-available', (info) =>
      this.broadcast({ event: 'not-available', info })
    );
    autoUpdater.on('error', (err) =>
      this.broadcast({ event: 'error', message: String(err) })
    );
    autoUpdater.on('download-progress', (p) =>
      this.broadcast({ event: 'progress', percent: p.percent })
    );
    autoUpdater.on('update-downloaded', (info) =>
      this.broadcast({ event: 'downloaded', info })
    );
  }

  async check(): Promise<unknown> {
    if (!app.isPackaged) return null;
    this.initialize();
    try {
      return await autoUpdater.checkForUpdates();
    } catch (e) {
      log.warn('checkForUpdates failed:', e);
      throw e;
    }
  }

  async download(): Promise<unknown> {
    this.initialize();
    return autoUpdater.downloadUpdate();
  }

  install(): void {
    autoUpdater.quitAndInstall();
  }

  /**
   * 起動時の自動更新確認。
   *   - 'ask':    更新があればダイアログで確認 → 承諾でダウンロード → 完了後に再度確認して再起動インストール
   *   - 'silent': 更新があれば即ダウンロード → 完了を通知のみ (次回終了時に自動インストール)
   */
  async checkOnStartup(
    getWindow: () => BrowserWindow | null,
    mode: 'ask' | 'silent'
  ): Promise<void> {
    if (!app.isPackaged) return;
    this.initialize();

    const onAvailable = (info: { version?: string }): void => {
      autoUpdater.off('update-available', onAvailable);
      if (mode === 'silent') {
        void this.silentDownload(info.version);
      } else {
        void this.promptDownload(getWindow, info.version);
      }
    };
    autoUpdater.on('update-available', onAvailable);

    try {
      await autoUpdater.checkForUpdates();
    } catch (e) {
      log.warn('checkForUpdates (startup) failed:', e);
    } finally {
      autoUpdater.off('update-available', onAvailable);
    }
  }

  private async silentDownload(version?: string): Promise<void> {
    autoUpdater.once('update-downloaded', () => {
      this.notify(
        'アップデートの準備完了',
        `新バージョン ${version ?? ''} をダウンロードしました。次回終了時に自動的に適用されます。`
      );
    });
    try {
      await autoUpdater.downloadUpdate();
    } catch (e) {
      log.warn('downloadUpdate (silent) failed:', e);
    }
  }

  private notify(title: string, body: string): void {
    if (!Notification.isSupported()) return;
    new Notification({ title, body, silent: false }).show();
  }

  private async promptDownload(
    getWindow: () => BrowserWindow | null,
    version?: string
  ): Promise<void> {
    const response = await this.confirm(getWindow, {
      type: 'question',
      buttons: ['更新する', '後で'],
      defaultId: 0,
      cancelId: 1,
      title: 'アップデートの確認',
      message: `新しいバージョン ${version ?? ''} が利用可能です。`,
      detail: 'ダウンロードしますか？'
    });
    if (response !== 0) return;

    autoUpdater.once('update-downloaded', () => {
      void this.promptInstall(getWindow);
    });
    try {
      await autoUpdater.downloadUpdate();
    } catch (e) {
      log.warn('downloadUpdate (startup) failed:', e);
    }
  }

  private async promptInstall(getWindow: () => BrowserWindow | null): Promise<void> {
    const response = await this.confirm(getWindow, {
      type: 'question',
      buttons: ['再起動してインストール', '後で'],
      defaultId: 0,
      cancelId: 1,
      title: 'アップデートの準備完了',
      message: 'アップデートのダウンロードが完了しました。'
    });
    if (response === 0) autoUpdater.quitAndInstall();
  }

  private async confirm(
    getWindow: () => BrowserWindow | null,
    opts: MessageBoxOptions
  ): Promise<number> {
    const win = getWindow();
    const { response } = win
      ? await dialog.showMessageBox(win, opts)
      : await dialog.showMessageBox(opts);
    return response;
  }

  private broadcast(payload: unknown): void {
    for (const wc of webContents.getAllWebContents()) {
      wc.send(IpcChannel.UPDATE_EVENT, payload);
    }
  }
}

let instance: UpdateManager | null = null;

export function getUpdateManager(): UpdateManager {
  if (!instance) instance = new UpdateManager();
  return instance;
}
