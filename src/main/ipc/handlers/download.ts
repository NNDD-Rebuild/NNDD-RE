import { ipcMain, webContents } from 'electron';
import { IpcChannel, DownloadStatusType } from '@shared/types';
import type { Schedule } from '@shared/types';
import type { EnqueueOptions } from '../../downloader/DownloadManager';
import { getConfigStore } from '../../config/ConfigStore';
import { sendWebhookNotify } from '../../notification/WebhookNotifier';
import type { IpcHandlerContext } from './context';

/**
 * ダウンロードキュー (DOWNLOAD_*)・スケジュール (SCHEDULE_*)・マイリスト差分DL (MYLIST_AUTO_*)。
 * DownloadManager の進捗イベントを全レンダラーへ中継する。
 */
export function registerDownloadHandlers(ctx: IpcHandlerContext): void {
  const { library, trayManager, dlManager, autoDl } = ctx;

  // 全レンダラーに進捗イベントをブロードキャスト
  dlManager.on('change', (item) => {
    for (const wc of webContents.getAllWebContents()) {
      wc.send(IpcChannel.DOWNLOAD_PROGRESS_EVENT, item);
    }
    // 完了通知
    if (item.status === DownloadStatusType.SUCCESS) {
      trayManager?.notify(
        'ダウンロード完了',
        item.videoName || item.videoId
      );
      if (getConfigStore().store.webhookNotify.notifyOnDownloadComplete) {
        void sendWebhookNotify({
          title: 'ダウンロード完了',
          description: item.videoName || item.videoId,
          level: 'success',
          videoId: item.videoId
        });
      }
    } else if (item.status === DownloadStatusType.FAIL) {
      trayManager?.notify(
        'ダウンロード失敗',
        `${item.videoName || item.videoId}: ${item.errorMessage ?? ''}`
      );
      if (getConfigStore().store.webhookNotify.notifyOnDownloadFail) {
        void sendWebhookNotify({
          title: 'ダウンロード失敗',
          description: `${item.videoName || item.videoId}: ${item.errorMessage ?? ''}`,
          level: 'error',
          videoId: item.videoId
        });
      }
    }
  });
  dlManager.on('changeAll', (items) => {
    for (const wc of webContents.getAllWebContents()) {
      wc.send(IpcChannel.DOWNLOAD_PROGRESS_EVENT, items);
    }
  });

  ipcMain.handle(IpcChannel.DOWNLOAD_LIST, () => dlManager.list());
  ipcMain.handle(IpcChannel.DOWNLOAD_ENQUEUE, (_e, opts: EnqueueOptions) =>
    dlManager.enqueue(opts)
  );
  ipcMain.handle(IpcChannel.DOWNLOAD_CANCEL, (_e, id: string) =>
    dlManager.cancel(id)
  );
  ipcMain.handle(IpcChannel.DOWNLOAD_CANCEL_ALL, () => {
    dlManager.cancelAll();
    return true;
  });
  ipcMain.handle(IpcChannel.DOWNLOAD_PAUSE, (_e, id: string) =>
    dlManager.pause(id)
  );
  ipcMain.handle(IpcChannel.DOWNLOAD_RESUME, (_e, id: string) =>
    dlManager.resume(id)
  );
  ipcMain.handle(IpcChannel.DOWNLOAD_PAUSE_ALL, () => {
    dlManager.pauseAll();
    return true;
  });
  ipcMain.handle(IpcChannel.DOWNLOAD_RESUME_ALL, () => {
    dlManager.resumeAll();
    return true;
  });
  ipcMain.handle(IpcChannel.DOWNLOAD_REMOVE, (_e, id: string) =>
    dlManager.remove(id)
  );
  ipcMain.handle(IpcChannel.DOWNLOAD_RETRY, (_e, id: string) =>
    dlManager.retry(id)
  );
  ipcMain.handle(IpcChannel.DOWNLOAD_CLEAR_COMPLETED, () => {
    dlManager.clearCompleted();
    return true;
  });

  // --- スケジュール ---
  ipcMain.handle(IpcChannel.SCHEDULE_LIST, () => library.scheduleDao.list());
  ipcMain.handle(IpcChannel.SCHEDULE_ADD, (_e, s: Schedule) => {
    library.scheduleDao.upsert(s);
    return true;
  });
  ipcMain.handle(IpcChannel.SCHEDULE_UPDATE, (_e, s: Schedule) => {
    library.scheduleDao.upsert(s);
    return true;
  });
  ipcMain.handle(IpcChannel.SCHEDULE_REMOVE, (_e, id: string) => {
    library.scheduleDao.remove(id);
    return true;
  });

  // マイリスト差分DL: 未登録の動画のみ DL キューに自動追加する
  ipcMain.handle(IpcChannel.MYLIST_AUTO_DOWNLOAD_ALL, async () => {
    return autoDl.renewAll();
  });
}
