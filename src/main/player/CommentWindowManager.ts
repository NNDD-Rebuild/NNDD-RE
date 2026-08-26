import { BrowserWindow } from 'electron';
import path from 'node:path';
import { is } from '@electron-toolkit/utils';
import { IpcChannel } from '@shared/types';
import type { NNDDREComment } from '@shared/types';
import { createLogger } from '../util/Logger';
import { getConfigStore } from '../config/ConfigStore';

const log = createLogger('CommentWindowManager');

export interface CommentWindowInitData {
  videoId: string;
  title: string;
  comments: NNDDREComment[];
  /** ローカルコメントXMLパス (過去コメントタブで使用) */
  localCommentXmlPath?: string;
  /** ニコニコ市場情報HTMLパス (旧NNDDファイル) */
  ichibaHtmlPath?: string;
}

/**
 * コメント一覧専用の別 BrowserWindow を管理する。
 * プレイヤーウィンドウ 1 つに対して 1 つのコメントウィンドウ。
 */
export class CommentWindowManager {
  private static instance: CommentWindowManager | null = null;
  static get(): CommentWindowManager {
    if (!this.instance) this.instance = new CommentWindowManager();
    return this.instance;
  }

  private win: BrowserWindow | null = null;
  /** シーク中継先 (プレイヤーウィンドウ) */
  private playerWin: BrowserWindow | null = null;
  /** ready-to-show 前に届いた init データをバッファ */
  private pendingInit: CommentWindowInitData | null = null;
  /** renderer 側 IPC リスナー登録完了 (COMMENT_WINDOW_READY 受信済み) か */
  private ready = false;

  /**
   * コメントウィンドウを開く。既存なら再利用してデータを更新。
   */
  open(playerWin: BrowserWindow, data: CommentWindowInitData): void {
    this.playerWin = playerWin;
    getConfigStore().set('player.commentWindowAutoOpen', true);

    if (this.win && !this.win.isDestroyed()) {
      // 既存ウィンドウに新データを送信してフォーカス (位置は維持)
      this.win.webContents.send(IpcChannel.COMMENT_WINDOW_INIT, data);
      this.win.focus();
      return;
    }

    this.ready = false;
    this.pendingInit = data;

    // 保存済みboundsがあればそれを使う。なければプレイヤーウィンドウの右隣に配置
    const playerBounds = playerWin.getBounds();
    const savedBounds = getConfigStore().get('player.commentWindowBounds') as
      | { width: number; height: number; x: number; y: number; maximized?: boolean }
      | undefined;
    const winX = savedBounds?.x ?? playerBounds.x + playerBounds.width;
    const winY = savedBounds?.y ?? playerBounds.y;
    const winW = savedBounds?.width ?? 540;
    const winH = savedBounds?.height ?? (playerBounds.height > 0 ? playerBounds.height : 760);
    const shouldMaximize = savedBounds?.maximized === true;

    const bgColor = getConfigStore().get('ui').theme === 'light' ? '#f0f0f0' : '#1e1e1e';
    const win = new BrowserWindow({
      width: winW,
      height: winH,
      x: winX,
      y: winY,
      minWidth: 280,
      minHeight: 300,
      autoHideMenuBar: true,
      backgroundColor: bgColor,
      title: `コメント一覧 — ${data.title}`,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false
      }
    });

    // close イベント時の getBounds() は Windows DWM の都合で y がズレることがある。
    // move/resize で安定した復元サイズ (getNormalBounds) を追跡し、close 時はそれを使う。
    // 最大化中は getBounds() が画面全体を返すため getNormalBounds() で復元座標を取得する。
    let latestBounds = { x: winX, y: winY, width: winW, height: winH };
    win.on('move', () => {
      if (win.isDestroyed() || win.isMinimized()) return;
      latestBounds = win.getNormalBounds();
    });
    win.on('resize', () => {
      if (win.isDestroyed() || win.isMinimized()) return;
      latestBounds = win.getNormalBounds();
    });

    win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
      const tag = ['verbose', 'info', 'warn', 'error'][level] ?? 'info';
      const src = sourceId?.split('/').pop() ?? '';
      log[tag === 'error' ? 'error' : tag === 'warn' ? 'warn' : 'info'](
        `[comment-renderer:${tag}] ${message} (${src}:${line})`
      );
    });

    // ready-to-show は「初回描画完了」のタイミングで発火するが、React 側の
    // useEffect (IPC リスナー登録) 完了より先に発火することがある (特に Linux)。
    // そのため初期化データの送信は renderer からの COMMENT_WINDOW_READY 通知を待つ。
    win.on('ready-to-show', () => {
      if (shouldMaximize) win.maximize();
      win.show();
    });

    win.on('close', () => {
      try {
        getConfigStore().set('player.commentWindowBounds', {
          width: latestBounds.width,
          height: latestBounds.height,
          x: latestBounds.x,
          y: latestBounds.y,
          maximized: win.isMaximized()
        });
      } catch {
        // ignore
      }
    });

    win.on('closed', () => {
      log.verbose('comment window closed');
      getConfigStore().set('player.commentWindowAutoOpen', false);
      this.win = null;
      this.playerWin = null;
    });

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/comment.html`);
    } else {
      win.loadFile(path.join(__dirname, '../renderer/comment.html'));
    }

    this.win = win;
  }

  /** renderer 側の IPC リスナー登録完了通知を受けて、保留中の初期化データを送信する */
  notifyReady(): void {
    this.ready = true;
    if (this.win && !this.win.isDestroyed() && this.pendingInit) {
      this.win.webContents.send(IpcChannel.COMMENT_WINDOW_INIT, this.pendingInit);
      this.pendingInit = null;
    }
  }

  /**
   * コメント配列を更新する。
   * renderer 側の準備 (COMMENT_WINDOW_READY) が済むまでは送信してもリスナー未登録で
   * ロストするため、保留中の初期化データがあればそちらを更新するに留める。
   */
  pushComments(comments: NNDDREComment[]): void {
    if (!this.ready) {
      if (this.pendingInit) this.pendingInit.comments = comments;
      return;
    }
    if (this.win && !this.win.isDestroyed()) {
      this.win.webContents.send(IpcChannel.COMMENT_WINDOW_PUSH, comments);
    }
  }

  /** 再生位置を更新する */
  pushTime(timeSec: number): void {
    if (!this.ready) return;
    if (this.win && !this.win.isDestroyed()) {
      this.win.webContents.send(IpcChannel.COMMENT_WINDOW_TIME, timeSec);
    }
  }

  /** コメントウィンドウからのシーク要求をプレイヤーに中継する */
  relaySeek(timeSec: number): void {
    if (this.playerWin && !this.playerWin.isDestroyed()) {
      this.playerWin.webContents.send(IpcChannel.PLAYER_SEEK, timeSec);
    }
  }

  /** コメントウィンドウからの過去コメント配列をプレイヤーに中継する */
  relayPastComments(comments: import('@shared/types').NNDDREComment[] | null): void {
    if (this.playerWin && !this.playerWin.isDestroyed()) {
      this.playerWin.webContents.send(IpcChannel.PLAYER_PAST_COMMENTS, comments);
    }
  }

  close(): void {
    if (this.win && !this.win.isDestroyed()) {
      this.win.close();
    }
    this.win = null;
    this.playerWin = null;
  }

  isOpen(): boolean {
    return !!this.win && !this.win.isDestroyed();
  }
}
