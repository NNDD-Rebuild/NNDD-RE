import type { BrowserWindow } from 'electron';
import type { LibraryManager } from '../../db/LibraryManager';
import type { TrayManager } from '../../tray/TrayManager';
import type { BackupManager } from '../../githubSync/BackupManager';
import type { DownloadManager } from '../../downloader/DownloadManager';
import type { MyListAutoDownloader } from '../../downloader/MyListAutoDownloader';
import type { LiveFollowNotifier } from '../../nicovideo/live/LiveFollowNotifier';

/**
 * ドメイン別の IPC ハンドラ登録関数 (handlers/*.ts) が共有する依存。
 * registerIpcHandlers (registerIpc.ts) が組み立てて渡す。
 */
export interface IpcHandlerContext {
  library: LibraryManager;
  trayManager: TrayManager | null | undefined;
  mainWindowGetter: (() => BrowserWindow | null) | undefined;
  backupManager: BackupManager;
  /** ダウンロードキュー (シングルトン) */
  dlManager: DownloadManager;
  /** マイリスト差分DL */
  autoDl: MyListAutoDownloader;
  /** フォロー中放送者の放送開始通知 (設定変更時に apply し直す) */
  liveFollowNotifier: LiveFollowNotifier;
}
