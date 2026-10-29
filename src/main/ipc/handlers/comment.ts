import { ipcMain, BrowserWindow } from 'electron';
import { IpcChannel } from '@shared/types';
import type { NgListItem, NNDDREComment, WatchPageInfo } from '@shared/types';
import { getConfigStore } from '../../config/ConfigStore';
import { WatchInfoHandler, CommentClient, CommentXmlReader, CommentDiffUpdater, NicoContext } from '../../nicovideo';
import { mergeNgWithServer, pushNgAdd, pushNgRemove } from '../../nicovideo/ng/NgServerSync';
import { CommentWindowManager } from '../../player/CommentWindowManager';
import { AccountManager } from '../../nicovideo/auth/AccountManager';
import { createLogger } from '../../util/Logger';
import { runExclusive } from '../../util/KeyedMutex';
import type { IpcHandlerContext } from './context';

const log = createLogger('IPC');

/**
 * コメント取得 (VIDEO_GET_COMMENTS / PAST_COMMENT_*)・NG リスト (NG_*)・
 * ローカルコメント読み込み (COMMENT_*)・コメントウィンドウ (COMMENT_WINDOW_*)。
 */
export function registerCommentHandlers(ctx: IpcHandlerContext): {
  addNgComment: (item: NgListItem) => boolean;
} {
  const { library } = ctx;

  ipcMain.handle(IpcChannel.VIDEO_GET_COMMENTS, async (_e, videoId: string, watchInfo?: WatchPageInfo) => {
    const watch = watchInfo ?? await WatchInfoHandler.fetchWatchInfo(videoId);
    return CommentClient.fetchComments(watch);
  });

  // --- NGリスト ---
  ipcMain.handle(IpcChannel.NG_LIST_COMMENT, () =>
    library.ngListDao.listComment(AccountManager.key)
  );
  const broadcast = (channel: string): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(channel);
    }
  };
  const broadcastNgChanged = (): void => broadcast(IpcChannel.NG_COMMENT_CHANGED);
  // コメントNGはアカウントごとなので、アカウントが替わったら開いているウィンドウの表示を更新する
  AccountManager.onActiveChange(() => broadcastNgChanged());
  /** 自動同期が ON でログイン済みのときだけ、ローカルの NG 変更をサーバーへ反映する */
  const serverSyncEnabled = async (): Promise<boolean> =>
    getConfigStore().get('ngServerSync') === true && (await NicoContext.get().isLoggedIn());
  /** NG コメントを追加して全ウィンドウへ通知する。追加できたら true、登録済みなら false */
  const addNgComment = (item: NgListItem): boolean => {
    const added = library.ngListDao.addComment(AccountManager.key, item);
    broadcastNgChanged();
    // ローカルを先に確定し、サーバー反映は失敗してもブロックしない (ログのみ)
    if (added) {
      void serverSyncEnabled().then((on) => {
        if (on) return pushNgAdd(item);
      });
    }
    return added;
  };
  ipcMain.handle(IpcChannel.NG_ADD_COMMENT, (_e, item: NgListItem) => {
    addNgComment(item);
    return true;
  });
  ipcMain.handle(IpcChannel.NG_REMOVE_COMMENT, (_e, item: NgListItem) => {
    library.ngListDao.removeComment(AccountManager.key, item);
    broadcastNgChanged();
    void serverSyncEnabled().then((on) => {
      if (on) return pushNgRemove(item);
    });
    return true;
  });
  // サーバー側NGとのマージ (手動の同期ボタン)。ローカルの変更は broadcast で他ウィンドウへ通知する
  ipcMain.handle(IpcChannel.NG_SERVER_SYNC, (_e, args?: { force?: boolean }) =>
    // 並走すると同じ基準から二重にサーバーへ追加・削除するため直列にする
    runExclusive('ng-sync', async () => {
      const dao = library.ngListDao;
      // ローカルの NG は開始時のアカウントのものとして扱う (途中で切り替わっても別アカウントに混ぜない)
      const localAccount = AccountManager.key;
      const result = await mergeNgWithServer(
        {
          localAccount,
          list: () => dao.listComment(localAccount),
          add: (item) => dao.addComment(localAccount, item),
          remove: (item) => dao.removeComment(localAccount, item),
          getBase: (account) => dao.getSyncBase(account),
          setBase: (account, items) => dao.setSyncBase(account, items)
        },
        { force: args?.force === true }
      );
      if (result.pulled > 0 || result.deletedLocal > 0) {
        if (!result.aborted) broadcastNgChanged();
      }
      return result;
    })
  );
  ipcMain.handle(IpcChannel.NG_LIST_TAG, () => library.ngListDao.listTags());
  ipcMain.handle(IpcChannel.NG_ADD_TAG, (_e, tag: string) => {
    library.ngListDao.addTag(tag);
    broadcast(IpcChannel.NG_TAG_CHANGED);
    return true;
  });
  ipcMain.handle(IpcChannel.NG_REMOVE_TAG, (_e, tag: string) => {
    library.ngListDao.removeTag(tag);
    broadcast(IpcChannel.NG_TAG_CHANGED);
    return true;
  });
  ipcMain.handle(IpcChannel.NG_LIST_UP, () => library.ngListDao.listUps());
  ipcMain.handle(IpcChannel.NG_ADD_UP, (_e, userId: string) => {
    library.ngListDao.addUp(userId);
    return true;
  });
  ipcMain.handle(IpcChannel.NG_REMOVE_UP, (_e, userId: string) => {
    library.ngListDao.removeUp(userId);
    return true;
  });

  // --- ローカルコメント読み込み ---
  ipcMain.handle(IpcChannel.COMMENT_READ_NGUPS, (_e, filePath: string) => {
    return CommentXmlReader.readNgUps(filePath);
  });
  ipcMain.handle(IpcChannel.COMMENT_READ_LOCAL, (_e, filePath: string) => {
    return CommentXmlReader.readFile(filePath);
  });

  ipcMain.handle(IpcChannel.COMMENT_NOW_IDS_READ, (_e, filePath: string) => {
    const fsmod = require('node:fs') as typeof import('node:fs');
    if (!fsmod.existsSync(filePath)) return [];
    try {
      return JSON.parse(fsmod.readFileSync(filePath, 'utf-8')) as number[];
    } catch {
      return [];
    }
  });

  // --- 過去コメント ---
  ipcMain.handle(
    IpcChannel.PAST_COMMENT_FETCH,
    async (e, videoId: string, whenUnixSec: number, maxCount?: number) => {
      const watch = await WatchInfoHandler.fetchWatchInfo(videoId);
      return CommentClient.fetchAllComments(watch, {
        startWhenUnixSec: whenUnixSec,
        maxTotalCount: maxCount ?? 10_000,
        includeEasy: false,
        comment429RetryWaitSec: getConfigStore().get('comment429RetryWaitSec') ?? 60,
        onProgress: (msg) => {
          if (!e.sender.isDestroyed()) e.sender.send(IpcChannel.PAST_COMMENT_FETCH_PROGRESS, msg);
        }
      });
    }
  );
  ipcMain.handle(
    IpcChannel.PAST_COMMENT_FETCH_LOCAL,
    (_e, filePath: string, whenUnixSec: number, fromUnixSec: number = 0) => {
      const all = CommentXmlReader.readFile(filePath);
      return all.filter(
        (c) =>
          (!fromUnixSec || c.date >= fromUnixSec) &&
          (!whenUnixSec || c.date <= whenUnixSec)
      );
    }
  );

  // --- コメント差分取得・ローカルXMLにマージ保存 (今コメも更新) ---
  ipcMain.handle(
    IpcChannel.PAST_COMMENT_REFETCH,
    async (_e, videoId: string, xmlPath: string) => {
      const watch = await WatchInfoHandler.fetchWatchInfoRaw(videoId, true);
      return CommentDiffUpdater.update(watch, CommentDiffUpdater.pathsFromCommentXml(xmlPath), {
        refreshWatch: () => WatchInfoHandler.fetchWatchInfoRaw(videoId, true)
      });
    }
  );

  // --- コメントウィンドウ ---
  const commentWinMgr = CommentWindowManager.get();

  ipcMain.handle(
    IpcChannel.COMMENT_WINDOW_OPEN,
    (
      event,
      data: { videoId: string; title: string; comments: NNDDREComment[]; localCommentXmlPath?: string; ichibaHtmlPath?: string }
    ) => {
      const playerWin = BrowserWindow.fromWebContents(event.sender);
      if (!playerWin) return;
      commentWinMgr.open(playerWin, data);
    }
  );

  ipcMain.on(IpcChannel.COMMENT_WINDOW_READY, () => {
    commentWinMgr.notifyReady();
  });

  ipcMain.on(
    IpcChannel.COMMENT_WINDOW_PUSH,
    (_e, comments: NNDDREComment[]) => {
      commentWinMgr.pushComments(comments);
    }
  );

  ipcMain.on(
    IpcChannel.COMMENT_WINDOW_TIME,
    (_e, timeSec: number) => {
      commentWinMgr.pushTime(timeSec);
    }
  );

  ipcMain.on(
    IpcChannel.COMMENT_WINDOW_SEEK,
    (_e, timeSec: number) => {
      commentWinMgr.relaySeek(timeSec);
    }
  );

  // コメントウィンドウ → プレイヤー: 過去コメント配列中継
  ipcMain.on(
    IpcChannel.COMMENT_WINDOW_PAST_PUSH,
    (_e, comments: NNDDREComment[] | null) => {
      commentWinMgr.relayPastComments(comments);
    }
  );

  return { addNgComment };
}
