import { autoUpdater } from 'electron-updater';
import { app, webContents } from 'electron';
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
