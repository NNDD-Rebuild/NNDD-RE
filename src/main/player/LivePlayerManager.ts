import { BrowserWindow, shell, type Session, type WebContents } from 'electron';
import path from 'node:path';
import { is } from '@electron-toolkit/utils';
import { IpcChannel, type LiveEvent, type LiveStartResult } from '@shared/types';
import { getConfigStore } from '../config/ConfigStore';
import { createLogger } from '../util/Logger';
import { LiveSession, type LiveStreamCookie } from '../nicovideo/live/LiveSession';

const log = createLogger('LivePlayerManager');

const NICO_URL_PATTERNS = ['https://*.nicovideo.jp/*'];

/** Cookie の domain/path が URL に合うか (RFC6265 の簡易版) */
function cookieMatches(c: LiveStreamCookie, url: URL): boolean {
  if (c.secure && url.protocol !== 'https:') return false;
  if (c.domain) {
    const d = c.domain.replace(/^\./, '');
    if (url.hostname !== d && !url.hostname.endsWith(`.${d}`)) return false;
  }
  return !c.path || url.pathname.startsWith(c.path);
}

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
  private seq = 0;

  static get(): LivePlayerManager {
    if (!this.instance) this.instance = new LivePlayerManager();
    return this.instance;
  }

  open(programId: string): void {
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

    const query = { programId };
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/live-player.html?${new URLSearchParams(query)}`);
    } else {
      void win.loadFile(path.join(__dirname, '../renderer/live-player.html'), { query });
    }
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
      const program = await session.start();
      return { program };
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

  changeQuality(webContentsId: number, quality: string): void {
    this.sessions.get(webContentsId)?.changeQuality(quality);
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
