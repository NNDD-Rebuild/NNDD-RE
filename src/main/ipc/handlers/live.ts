import { BrowserWindow, dialog, ipcMain } from 'electron';
import { IpcChannel } from '@shared/types';
import type {
  LiveAkashicApiRequest,
  LiveAnimeParams,
  LiveCommentWindowMessage,
  LiveProgramListResult,
  LiveRecordReserveRequest,
  LiveRankingParams,
  LiveRecentParams,
  LiveSearchParams
} from '@shared/types';
import { LivePlayerManager } from '../../player/LivePlayerManager';
import type { LiveRecordScheduler } from '../../nicovideo/live/LiveRecordScheduler';
import { sendAkashicApi } from '../../nicovideo/live/AkashicApi';
import { LiveCommentWindowManager } from '../../player/LiveCommentWindowManager';
import {
  activateTimeshift,
  cancelTimeshiftReservations,
  fetchLiveWatchPage,
  normalizeLiveId,
  reserveTimeshift
} from '../../nicovideo/live/LiveWatchPage';
import { fetchAnimeLivePrograms } from '../../nicovideo/live/LiveAnimeClient';
import {
  fetchFollowingPrograms,
  fetchLiveRanking,
  fetchRecentPrograms,
  fetchTimeshiftReservations,
  searchPrograms
} from '../../nicovideo/live/LiveListClient';

export type LiveRecordChoice = 'fromStart' | 'now' | 'cancel';

/**
 * 録画の開始前の確認。プレミアム会員で追っかけ再生が使える放送中の番組は、放送開始からの録画も選べる。
 * 選べない番組は確認せず 'now' を返す。win が無ければ親ウィンドウなしでダイアログを出す
 */
export async function askLiveRecordMode(programId: string, win?: BrowserWindow | null): Promise<LiveRecordChoice> {
  const id = normalizeLiveId(programId);
  if (!id) throw new Error('番組IDが不正です');
  let canChase = false;
  try {
    const page = await fetchLiveWatchPage(id);
    canChase = page.program.status === 'ON_AIR' && page.program.chasePlayEnabled && page.accountType === 'premium';
  } catch {
    // 確認のための取得に失敗しても、今からの録画は試せる (失敗はダウンロード側で報告される)
    return 'now';
  }
  if (!canChase) return 'now';
  const options = {
    type: 'question' as const,
    title: '録画',
    message: 'この番組は放送開始から録画できます',
    detail:
      '「最初から録画」は追っかけ再生で放送開始からの映像を取得します (プレミアム会員のみ)。' +
      '放送が長いと時間と容量がかかります。\n「今から録画」は今の位置から番組の終了か停止まで録画します。',
    buttons: ['最初から録画', '今から録画', 'キャンセル'],
    defaultId: 0,
    cancelId: 2,
    noLink: true
  };
  const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
  return response === 0 ? 'fromStart' : response === 1 ? 'now' : 'cancel';
}

/** ニコニコ生放送 (LIVE_*) */
export function registerLiveHandlers(recordScheduler: LiveRecordScheduler): void {
  // --- 生放送 視聴フロー調査 PoC ---
  ipcMain.handle(IpcChannel.LIVE_POC_RUN, async (_e, programId: string) => {
    const { runLivePoc } = await import('../../nicovideo/live/LivePoc');
    return runLivePoc(programId);
  });

  // --- 生放送 ---
  // 録画の開始前の確認
  ipcMain.handle(IpcChannel.LIVE_RECORD_ASK, (e, programId: string) =>
    askLiveRecordMode(String(programId ?? ''), BrowserWindow.fromWebContents(e.sender))
  );

  // 録画予約 (放送予定の番組を開始時刻に自動録画)
  ipcMain.handle(IpcChannel.LIVE_RECORD_RESERVE, (_e, req: LiveRecordReserveRequest) => {
    recordScheduler.reserve(req);
  });
  ipcMain.handle(IpcChannel.LIVE_RECORD_UNRESERVE, (_e, programId: string) => {
    recordScheduler.unreserve(String(programId ?? ''));
  });
  ipcMain.handle(IpcChannel.LIVE_RECORD_RESERVATIONS, (): LiveProgramListResult => {
    const programs = recordScheduler.listAsPrograms();
    return { programs, total: programs.length };
  });

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
  ipcMain.handle(IpcChannel.LIVE_ANIME, (_e, params: LiveAnimeParams) => fetchAnimeLivePrograms(params));
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
  ipcMain.handle(IpcChannel.LIVE_ANSWER_ENQUETE, (e, index: number) => {
    LivePlayerManager.get().answerEnquete(e.sender.id, Number(index));
  });

  ipcMain.handle(IpcChannel.LIVE_SET_CHASE_PLAY, (e, enabled: boolean) => {
    LivePlayerManager.get().setChasePlay(e.sender.id, Boolean(enabled));
  });
}
