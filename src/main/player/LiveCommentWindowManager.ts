import { BrowserWindow, type WebContents } from 'electron';
import path from 'node:path';
import { is } from '@electron-toolkit/utils';
import { IpcChannel, type LiveCommentWindowEvent, type LiveCommentWindowMessage } from '@shared/types';
import { getConfigStore } from '../config/ConfigStore';
import { createLogger } from '../util/Logger';

const log = createLogger('LiveCommentWindowManager');

interface Pair {
  player: WebContents;
  win: BrowserWindow;
}

/**
 * 生放送のコメントウィンドウ (フロート) の管理。生放送プレイヤー 1 つにつき 1 つ。
 *
 * コメントのデータはプレイヤー側が持ち、このクラスは中継だけを行う:
 *   プレイヤー → LIVE_COMMENT_WINDOW_PUSH → コメントウィンドウ
 *   コメントウィンドウ (準備完了・シーク) / ウィンドウを閉じた → LIVE_COMMENT_WINDOW_EVENT → プレイヤー
 */
export class LiveCommentWindowManager {
  private static instance: LiveCommentWindowManager | null = null;
  static get(): LiveCommentWindowManager {
    if (!this.instance) this.instance = new LiveCommentWindowManager();
    return this.instance;
  }

  /** プレイヤーの webContents.id → ペア */
  private readonly byPlayer = new Map<number, Pair>();
  /** コメントウィンドウの webContents.id → プレイヤーの webContents.id */
  private readonly playerOf = new Map<number, number>();

  open(player: WebContents): void {
    const existing = this.byPlayer.get(player.id);
    if (existing && !existing.win.isDestroyed()) {
      existing.win.show();
      existing.win.focus();
      // プレイヤーが番組を切り替えて読み込み直した場合に備え、全件を送り直してもらう
      this.sendToPlayer(player, { type: 'ready' });
      return;
    }

    const config = getConfigStore();
    const live = config.get('live');
    const playerWin = BrowserWindow.fromWebContents(player);
    const pb = playerWin?.getBounds();
    const saved = live?.commentWindowBounds;
    const bounds = saved ?? {
      // 初回はプレイヤーの右隣
      x: pb ? pb.x + pb.width : undefined,
      y: pb?.y,
      width: 420,
      height: pb?.height ?? 700
    };

    const win = new BrowserWindow({
      ...bounds,
      minWidth: 280,
      minHeight: 200,
      autoHideMenuBar: true,
      alwaysOnTop: live?.commentWindowOnTop ?? true,
      backgroundColor: config.get('ui').theme === 'light' ? '#f0f0f0' : '#1e1e1e',
      title: 'コメント一覧 - NNDD-RE Live',
      show: false,
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false
      }
    });
    const pair: Pair = { player, win };
    const winId = win.webContents.id;
    this.byPlayer.set(player.id, pair);
    this.playerOf.set(winId, player.id);

    // close 時の getBounds() はずれることがあるため、移動・リサイズのたびに記録しておく
    let latest = win.getNormalBounds();
    const track = (): void => {
      if (!win.isDestroyed() && !win.isMinimized()) latest = win.getNormalBounds();
    };
    win.on('move', track);
    win.on('resize', track);
    win.on('close', () => {
      config.set('live.commentWindowBounds', latest);
    });
    win.on('closed', () => {
      this.byPlayer.delete(player.id);
      this.playerOf.delete(winId);
      this.sendToPlayer(player, { type: 'closed' });
    });
    win.on('ready-to-show', () => win.show());
    win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
      if (level >= 2) log.warn(`[renderer] ${message} (${sourceId?.split('/').pop() ?? ''}:${line})`);
    });

    // プレイヤーが閉じたらコメントウィンドウも閉じる
    player.once('destroyed', () => this.close(player.id));

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/live-comment.html`);
    } else {
      void win.loadFile(path.join(__dirname, '../renderer/live-comment.html'));
    }
  }

  close(playerId: number): void {
    const pair = this.byPlayer.get(playerId);
    if (pair && !pair.win.isDestroyed()) pair.win.close();
  }

  /** プレイヤー → コメントウィンドウ */
  push(playerId: number, msg: LiveCommentWindowMessage): void {
    const pair = this.byPlayer.get(playerId);
    if (pair && !pair.win.isDestroyed()) pair.win.webContents.send(IpcChannel.LIVE_COMMENT_WINDOW_PUSH, msg);
  }

  /** コメントウィンドウ → プレイヤー */
  fromCommentWindow(commentWindowId: number, ev: LiveCommentWindowEvent): void {
    const playerId = this.playerOf.get(commentWindowId);
    const pair = playerId !== undefined ? this.byPlayer.get(playerId) : undefined;
    if (pair) this.sendToPlayer(pair.player, ev);
  }

  setOnTop(commentWindowId: number, onTop: boolean): void {
    const playerId = this.playerOf.get(commentWindowId);
    const pair = playerId !== undefined ? this.byPlayer.get(playerId) : undefined;
    if (pair && !pair.win.isDestroyed()) pair.win.setAlwaysOnTop(onTop);
    getConfigStore().set('live.commentWindowOnTop', onTop);
  }

  private sendToPlayer(player: WebContents, ev: LiveCommentWindowEvent): void {
    if (!player.isDestroyed()) player.send(IpcChannel.LIVE_COMMENT_WINDOW_EVENT, ev);
  }
}
