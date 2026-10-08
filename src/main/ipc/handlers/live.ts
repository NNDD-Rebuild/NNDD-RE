import { ipcMain } from 'electron';
import { IpcChannel } from '@shared/types';
import type {
  LiveAkashicApiRequest,
  LiveCommentWindowMessage,
  LiveRankingParams,
  LiveRecentParams,
  LiveSearchParams
} from '@shared/types';
import { LivePlayerManager } from '../../player/LivePlayerManager';
import { sendAkashicApi } from '../../nicovideo/live/AkashicApi';
import { LiveCommentWindowManager } from '../../player/LiveCommentWindowManager';
import { activateTimeshift, cancelTimeshiftReservations, normalizeLiveId, reserveTimeshift } from '../../nicovideo/live/LiveWatchPage';
import {
  fetchFollowingPrograms,
  fetchLiveRanking,
  fetchRecentPrograms,
  fetchTimeshiftReservations,
  searchPrograms
} from '../../nicovideo/live/LiveListClient';

/** ニコニコ生放送 (LIVE_*) */
export function registerLiveHandlers(): void {
  // --- 生放送 視聴フロー調査 PoC ---
  ipcMain.handle(IpcChannel.LIVE_POC_RUN, async (_e, programId: string) => {
    const { runLivePoc } = await import('../../nicovideo/live/LivePoc');
    return runLivePoc(programId);
  });

  // --- 生放送 ---
  ipcMain.handle(IpcChannel.LIVE_OPEN_PLAYER, (_e, input: string) => {
    const id = normalizeLiveId(String(input ?? ''));
    if (!id) throw new Error('番組ID (lv/co/ch) または生放送URLを指定してください');
    LivePlayerManager.get().open(id);
  });
  ipcMain.handle(IpcChannel.LIVE_START, (e, programId: string) =>
    LivePlayerManager.get().startSession(e.sender, String(programId))
  );
  ipcMain.handle(IpcChannel.LIVE_TIMESHIFT_ACTIVATE, (_e, programId: string) =>
    activateTimeshift(String(programId))
  );
  ipcMain.handle(IpcChannel.LIVE_TIMESHIFT_RESERVE, (_e, programId: string) =>
    reserveTimeshift(String(programId))
  );
  ipcMain.handle(IpcChannel.LIVE_TIMESHIFT_CANCEL, (_e, programIds: string[]) =>
    cancelTimeshiftReservations((Array.isArray(programIds) ? programIds : []).map(String))
  );
  ipcMain.handle(
    IpcChannel.LIVE_LIST_FOLLOWING,
    (_e, args: { status: 'onair' | 'reserved'; offset: number }) =>
      fetchFollowingPrograms(args.status === 'reserved' ? 'reserved' : 'onair', Number(args.offset) || 0)
  );
  ipcMain.handle(IpcChannel.LIVE_SEARCH, (_e, params: LiveSearchParams) => searchPrograms(params));
  ipcMain.handle(IpcChannel.LIVE_LIST_TIMESHIFT_RESERVATIONS, () => fetchTimeshiftReservations());
  ipcMain.handle(IpcChannel.LIVE_RANKING, (_e, params: LiveRankingParams) => fetchLiveRanking(params));
  ipcMain.handle(IpcChannel.LIVE_RECENT, (_e, params: LiveRecentParams) => fetchRecentPrograms(params));
  ipcMain.handle(IpcChannel.LIVE_STOP, (e) => {
    LivePlayerManager.get().stopSession(e.sender.id);
  });
  ipcMain.handle(IpcChannel.LIVE_FETCH_COMMENTS_AROUND, (e, vposMs: number) =>
    LivePlayerManager.get().fetchCommentsAround(e.sender.id, Number(vposMs) || 0)
  );
  // 生放送のコメントウィンドウ (フロート)
  ipcMain.handle(IpcChannel.LIVE_COMMENT_WINDOW_OPEN, (e) => LiveCommentWindowManager.get().open(e.sender));
  ipcMain.handle(IpcChannel.LIVE_COMMENT_WINDOW_CLOSE, (e) => LiveCommentWindowManager.get().close(e.sender.id));
  ipcMain.on(IpcChannel.LIVE_COMMENT_WINDOW_PUSH, (e, msg: LiveCommentWindowMessage) =>
    LiveCommentWindowManager.get().push(e.sender.id, msg)
  );
  ipcMain.on(IpcChannel.LIVE_COMMENT_WINDOW_READY, (e) =>
    LiveCommentWindowManager.get().fromCommentWindow(e.sender.id, { type: 'ready' })
  );
  ipcMain.on(IpcChannel.LIVE_COMMENT_WINDOW_SEEK, (e, vposMs: number) =>
    LiveCommentWindowManager.get().fromCommentWindow(e.sender.id, { type: 'seek', vposMs: Number(vposMs) || 0 })
  );
  ipcMain.on(IpcChannel.LIVE_COMMENT_WINDOW_SET_ON_TOP, (e, onTop: boolean) =>
    LiveCommentWindowManager.get().setOnTop(e.sender.id, Boolean(onTop))
  );
  ipcMain.handle(IpcChannel.LIVE_CHANGE_QUALITY, (e, quality: string) => {
    LivePlayerManager.get().changeQuality(e.sender.id, String(quality));
  });
  ipcMain.handle(IpcChannel.LIVE_AKASHIC_API, (_e, req: LiveAkashicApiRequest) =>
    sendAkashicApi(req)
  );
  ipcMain.handle(IpcChannel.LIVE_SET_CHASE_PLAY, (e, enabled: boolean) => {
    LivePlayerManager.get().setChasePlay(e.sender.id, Boolean(enabled));
  });
}
