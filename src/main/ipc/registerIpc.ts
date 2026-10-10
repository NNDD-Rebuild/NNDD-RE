import type { BrowserWindow } from 'electron';
import type { LibraryManager } from '../db/LibraryManager';
import type { NgListItem } from '@shared/types';
import { createLogger } from '../util/Logger';
import { installIpcRegistry } from './ipcRegistry';
import {
  DownloadManager,
  type EnqueueOptions
} from '../downloader/DownloadManager';
import { MyListAutoDownloader } from '../downloader/MyListAutoDownloader';
import { SeriesAutoDownloader } from '../downloader/SeriesAutoDownloader';
import { FollowUserAutoDownloader } from '../downloader/FollowUserAutoDownloader';
import { ChannelWatcher } from '../downloader/ChannelWatcher';
import { LiveFollowNotifier } from '../nicovideo/live/LiveFollowNotifier';
import { LiveRecordScheduler } from '../nicovideo/live/LiveRecordScheduler';
import { ScheduleManager } from '../downloader/ScheduleManager';
import type { OpenPlayerParams } from '../player/PlayerManager';
import type { TrayManager } from '../tray/TrayManager';
import type { BackupManager } from '../githubSync/BackupManager';
import type { IpcHandlerContext } from './handlers/context';
import { registerDownloadHandlers } from './handlers/download';
import { registerLibraryHandlers } from './handlers/library';
import { registerBrowseHandlers } from './handlers/browse';
import { registerAuthHandlers, startSessionCheck } from './handlers/auth';
import { registerBackupHandlers } from './handlers/backup';
import { registerVideoHandlers } from './handlers/video';
import { registerCommentHandlers } from './handlers/comment';
import { registerConfigHandlers } from './handlers/config';
import { registerSystemHandlers } from './handlers/system';
import { registerPlayerHandlers } from './handlers/player';
import { registerLiveHandlers } from './handlers/live';
import { registerHttpHandlers } from './handlers/http';
import { registerNavigationHandlers } from './handlers/navigation';
import { registerImageHandlers } from './handlers/image';
import { registerHonkeImportHandlers } from './handlers/honkeImport';
import { registerTelemetryHandlers } from './handlers/telemetry';

const log = createLogger('IPC');

/**
 * IPC ハンドラー登録。
 * 元: AS3 では各 Manager がアプリケーションオブジェクト経由でアクセスしていたが、
 * Electron では preload経由でメインプロセスに問い合わせる構造。
 *
 * ハンドラ本体はドメインごとに handlers/*.ts に分けてあり、ここでは共有する依存
 * (IpcHandlerContext) を組み立てて各 registerXxxHandlers を呼ぶだけにする。
 * チャンネルの登録漏れ・二重登録は `npm run check:ipc` で確認できる。
 */
/** `nndd-re-cmd://` プロトコルハンドラ等、IPC以外の経路から呼び出すための最小API */
const NG_TYPE_LABEL: Record<NgListItem['type'], string> = {
  word: 'NGワード',
  wordExact: 'NGワード (完全一致)',
  userId: 'NGユーザーID',
  command: 'NGコマンド'
};

export interface CmdApi {
  openPlayer: (params: OpenPlayerParams) => Promise<void>;
  enqueueDownload: (opts: EnqueueOptions) => ReturnType<DownloadManager['enqueue']>;
  navigateMylist: (mylistId: string) => void;
  /** NG コメントを追加する (nndd-re-cmd://ngAdd)。追加できたら true、登録済みなら false。通知も出す */
  addNgComment: (item: NgListItem) => boolean;
}

export function registerIpcHandlers(
  library: LibraryManager,
  trayManager: TrayManager | null | undefined,
  mainWindowGetter: (() => BrowserWindow | null) | undefined,
  backupManager: BackupManager
): CmdApi {
  // ブラウザ版プレイヤー用に ipcMain.handle の登録内容を記録する (以降の handle より前に呼ぶ)
  installIpcRegistry();

  // --- ダウンロードマネージャ (シングルトン) ---
  const dlManager = new DownloadManager(library);
  const autoDl = new MyListAutoDownloader(library, dlManager);
  const seriesAutoDl = new SeriesAutoDownloader(library, dlManager);
  const followUserAutoDl = new FollowUserAutoDownloader(library, dlManager);
  const scheduler = new ScheduleManager(library, autoDl, seriesAutoDl, followUserAutoDl);
  scheduler.start();
  const channelWatcher = new ChannelWatcher(library, trayManager);
  channelWatcher.start();
  const liveFollowNotifier = new LiveFollowNotifier();
  liveFollowNotifier.apply();
  const liveRecordScheduler = new LiveRecordScheduler(dlManager, trayManager);
  liveRecordScheduler.start();

  const ctx: IpcHandlerContext = {
    library,
    trayManager,
    mainWindowGetter,
    backupManager,
    dlManager,
    autoDl,
    liveFollowNotifier
  };

  registerDownloadHandlers(ctx);
  registerLibraryHandlers(ctx);
  registerBrowseHandlers(ctx);
  registerAuthHandlers();
  registerBackupHandlers(ctx);
  const { openPlayer } = registerVideoHandlers(ctx);
  const { addNgComment } = registerCommentHandlers(ctx);
  registerConfigHandlers(ctx);
  registerSystemHandlers(ctx);
  registerPlayerHandlers();
  registerLiveHandlers(liveRecordScheduler);
  // 設定で有効なら内蔵 HTTP サーバーをここで自動起動する
  registerHttpHandlers(ctx);
  const { navigateMylist } = registerNavigationHandlers(ctx);
  registerImageHandlers();
  registerHonkeImportHandlers(ctx);
  registerTelemetryHandlers();

  // セッションの定期チェック (起動直後に1回 + 30分ごと)
  startSessionCheck(ctx);

  log.info('IPC handlers registered');

  return {
    openPlayer,
    enqueueDownload: (opts) => dlManager.enqueue({ ...opts, source: 'cmd' }),
    navigateMylist,
    addNgComment: (item) => {
      const added = addNgComment(item);
      const label = NG_TYPE_LABEL[item.type];
      trayManager?.notify(
        added ? 'NGリストに追加しました' : 'NGリストに登録済みです',
        `${label}: ${item.value}`
      );
      return added;
    }
  };
}
