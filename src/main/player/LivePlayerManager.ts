import { spawn } from 'node:child_process';
import { BrowserWindow, shell, type Session, type WebContents } from 'electron';
import path from 'node:path';
import { is } from '@electron-toolkit/utils';
import { IpcChannel, type LiveCommentRange, type LiveEvent, type LiveStartResult } from '@shared/types';
import { getConfigStore } from '../config/ConfigStore';
import { createLogger } from '../util/Logger';
import { getDiscordRpcManager } from '../discord/DiscordRpcManager';
import { LiveSession, cookieMatches, type LiveStreamCookie } from '../nicovideo/live/LiveSession';

const log = createLogger('LivePlayerManager');

const NICO_URL_PATTERNS = ['https://*.nicovideo.jp/*'];

/**
 * 生放送プレイヤーウィンドウの管理。
 *
 * ウィンドウごとにメモリ上の専用 partition を使い、HLS 取得に必要な署名Cookie
 * (視聴WebSocket の stream.cookies) を webRequest でリクエストヘッダーへ付与する。
 * hls.js は withCredentials 無しで取得するため、Chromium の Cookie ストアに
 * 入れても送られない (HlsSessionInterceptor と同じ理由)。
 */
export class LivePlayerManager {
  private static instance: LivePlayerManager | null = null;

  /** partition セッション → そのウィンドウで視聴中の番組の stream.cookies */
  private readonly streamCookies = new WeakMap<Session, LiveStreamCookie[]>();
  /** webContents.id → 視聴セッション */
  private readonly sessions = new Map<number, LiveSession>();
  /**
   * 開いている生放送ウィンドウ → 表示中の番組。
   * requestedId は開くときに指定された ID (co/ch の場合もある)、programId は解決後の lv ID
   */
  private readonly windows = new Map<BrowserWindow, { requestedId: string; programId?: string }>();
  private seq = 0;

  static get(): LivePlayerManager {
    if (!this.instance) this.instance = new LivePlayerManager();
    return this.instance;
  }

  /**
   * 生放送プレイヤーを開く。
   * - 同じ番組を表示中のウィンドウがあれば、それを前面に出すだけ
   * - 設定 live.allowMultipleWindows が OFF なら、既存の生放送ウィンドウで番組を切り替える
   * - 設定 live.ncvEnabled が ON なら NCV も起動する (同じ番組を開き済みの場合と fromNcv の場合を除く)
   *   fromNcv は NCV 側から RE が呼ばれたことを示し、NCV を再び起動する相互起動ループを防ぐ
   */
  open(programId: string, opts?: { fromNcv?: boolean }): void {
    const same = [...this.windows].find(
      ([, v]) => v.requestedId === programId || v.programId === programId
    )?.[0];
    if (same) {
      this.focus(same);
      return;
    }
    // NCV 連携で開く場合 (RE から NCV を起動した / NCV から呼ばれた) は、コメントは NCV で見るため
    // コメントリストを浮動ウィンドウにせずタブ表示に固定する
    const ncv = opts?.fromNcv ? true : this.launchNcv(programId);
    const allowMultiple = getConfigStore().get('live')?.allowMultipleWindows ?? false;
    const reuse = allowMultiple ? undefined : [...this.windows.keys()][0];
    if (reuse) {
      // 読み込み直すと renderer が LIVE_START し直し、同じ webContents の旧セッションは startSession で止まる
      this.windows.set(reuse, { requestedId: programId });
      this.loadPage(reuse, programId, ncv);
      this.focus(reuse);
      return;
    }
    this.createWindow(programId, ncv);
  }

  /** NCV を起動して番組に接続させる。一枠設定 (allowMultipleWindows OFF) のときは起動済みの NCV を使い回す */
  private launchNcv(programId: string): boolean {
    const live = getConfigStore().get('live');
    const ncvPath = live?.ncvPath?.trim();
    if (!live?.ncvEnabled || !ncvPath) return false;
    const args = [`https://live.nicovideo.jp/watch/${programId}`];
    if (!live.allowMultipleWindows) args.push('/singleinstance');
    try {
      const child = spawn(ncvPath, args, { detached: true, stdio: 'ignore' });
      child.on('error', (e) => log.error('NCV launch failed:', e));
      child.unref();
      return true;
    } catch (e) {
      log.error('NCV launch failed:', e);
      return false;
    }
  }

  /**
   * その番組を視聴ウィンドウで開いているか。
   * 同じアカウントで同じ番組を別の場所から視聴すると、先の視聴が TAKEOVER で切断されるため、
   * ダウンロード・録画の前に確認する
   */
  isWatching(programId: string): boolean {
    return [...this.windows.values()].some((v) => v.requestedId === programId || v.programId === programId);
  }

  private focus(win: BrowserWindow): void {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }

  private loadPage(win: BrowserWindow, programId: string, ncv = false): void {
    const query: Record<string, string> = ncv ? { programId, ncv: '1' } : { programId };
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/live-player.html?${new URLSearchParams(query)}`);
    } else {
      void win.loadFile(path.join(__dirname, '../renderer/live-player.html'), { query });
    }
  }

  private createWindow(programId: string, ncv: boolean): void {
    const bgColor = getConfigStore().get('ui').theme === 'light' ? '#f0f0f0' : '#000000';
    const win = new BrowserWindow({
      width: 1280,
      height: 760,
      minWidth: 640,
      minHeight: 400,
      autoHideMenuBar: true,
      backgroundColor: bgColor,
      title: 'NNDD-RE Live',
      show: false,
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
        partition: `nndd-live-${Date.now()}-${this.seq++}`
      }
    });

    win.webContents.setWindowOpenHandler((details) => {
      void shell.openExternal(details.url);
      return { action: 'deny' };
    });
    this.setupSession(win.webContents.session);

    win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
      const src = sourceId?.split('/').pop() ?? '';
      const text = `[renderer] ${message} (${src}:${line})`;
      if (level >= 3) log.error(text);
      else if (level === 2) log.warn(text);
    });
    win.on('ready-to-show', () => win.show());
    this.windows.set(win, { requestedId: programId });
    // closed 後は webContents に触れないので、ID は先に控えておく
    const webContentsId = win.webContents.id;
    win.on('closed', () => {
      // レンダラー側の unmount は ×閉じ時に間に合わないことがあるため、Discord Presence はここでもクリアする
      void getDiscordRpcManager().clearActivity(webContentsId);
      this.windows.delete(win);
    });
    this.loadPage(win, programId, ncv);
  }

  /** 生放送プレイヤー (renderer) からの視聴開始要求 */
  async startSession(sender: WebContents, programId: string): Promise<LiveStartResult> {
    this.stopSession(sender.id);
    const ses = sender.session;
    const session = new LiveSession(
      programId,
      (ev: LiveEvent) => {
        if (!sender.isDestroyed()) sender.send(IpcChannel.LIVE_EVENT, ev);
      },
      (cookies) => this.streamCookies.set(ses, cookies)
    );
    this.sessions.set(sender.id, session);
    const id = sender.id;
    sender.once('destroyed', () => this.stopSession(id));
    try {
      const result = await session.start();
      // co/ch で開いた場合も、解決後の lv ID で同一番組判定できるよう記録する
      const win = BrowserWindow.fromWebContents(sender);
      const entry = win ? this.windows.get(win) : undefined;
      if (entry) entry.programId = result.program.programId;
      return result;
    } catch (e) {
      this.stopSession(id);
      throw e;
    }
  }

  stopSession(webContentsId: number): void {
    const s = this.sessions.get(webContentsId);
    if (!s) return;
    s.stop();
    this.sessions.delete(webContentsId);
  }

  fetchCommentsAround(webContentsId: number, vposMs: number): Promise<LiveCommentRange | null> {
    return this.sessions.get(webContentsId)?.fetchCommentsAround(vposMs) ?? Promise.resolve(null);
  }

  changeQuality(webContentsId: number, quality: string): void {
    this.sessions.get(webContentsId)?.changeQuality(quality);
  }

  setChasePlay(webContentsId: number, enabled: boolean): void {
    this.sessions.get(webContentsId)?.setChasePlay(enabled);
  }

  private setupSession(ses: Session): void {
    ses.webRequest.onBeforeSendHeaders({ urls: NICO_URL_PATTERNS }, (details, callback) => {
      const cookies = this.streamCookies.get(ses);
      if (!cookies || cookies.length === 0) {
        callback({ requestHeaders: details.requestHeaders });
        return;
      }
      const url = new URL(details.url);
      const header = cookies
        .filter((c) => cookieMatches(c, url))
        .map((c) => `${c.name}=${c.value}`)
        .join('; ');
      callback({
        requestHeaders: header ? { ...details.requestHeaders, Cookie: header } : details.requestHeaders
      });
    });
    // renderer (file:// / dev server) から CDN への取得を CORS で弾かれないようにする
    ses.webRequest.onHeadersReceived({ urls: NICO_URL_PATTERNS }, (details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'access-control-allow-origin': ['*']
        }
      });
    });
  }
}
