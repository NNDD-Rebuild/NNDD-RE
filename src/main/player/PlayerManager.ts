import { BrowserWindow } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { CommentWindowManager } from './CommentWindowManager';
import { is } from '@electron-toolkit/utils';
import { getConfigStore } from '../config/ConfigStore';
import { VideoFileSuffix } from '@shared/constants';
import { createLogger } from '../util/Logger';
import { setupHlsSessionInterceptor } from './HlsSessionInterceptor';

const log = createLogger('PlayerManager');

/**
 * 動画プレイヤー起動情報。
 *  - videoId 指定: ニコニコの動画をストリーミングする (master.m3u8経由)
 *  - localPath 指定: ローカルファイルを再生
 */
export interface OpenPlayerParams {
  /** ニコニコ動画ID (sm12345 等) — オンライン再生時のみ */
  videoId?: string;
  /** ローカル動画ファイルパス — ローカル再生時 */
  localPath?: string;
  /** フォルダ連続再生用: ソート済みローカルパス一覧 */
  folderPlaylist?: string[];
  /** 検索結果連続再生用: videoId の配列 */
  searchPlaylist?: string[];
  /** LANライブラリのHTTPストリーミングURL (例: http://192.168.x.x:12345/NNDDServer/sm123) */
  streamUrl?: string;
  /** ローカル再生時の付帯ファイル群 (コメントXML, サムネ画像など) */
  localFiles?: {
    commentXml?: string;
    ownerCommentXml?: string;
    thumbInfoXml?: string;
    thumbImage?: string;
    /** ニコニコ市場情報HTML (廃止済み、旧NNDDからの互換ファイル) */
    ichibaHtml?: string;
    /** 今コメント no 配列JSON (ストリーミング時と同等の今コメ再現用) */
    nowCommentJson?: string;
  };
  /** 自動再生による遷移か (true なら最小化中のウィンドウを前面に出さない) */
  autoNext?: boolean;
  /** 音声のみ再生モード */
  audioOnly?: boolean;
  /** レジューム再生開始秒数 (VIDEO_OPEN_PLAYER ハンドラが DB から解決してセット) */
  resumeSec?: number;
}

/**
 * 動画プレイヤーウィンドウの管理。
 * 元: src/org/mineap/nndd/player/PlayerManager.as
 *   最大 10 プレイヤーまで同時起動可能 (元AS3版と同じ上限)。
 */
export class PlayerManager {
  private static MAX_WINDOWS = 10;
  private static instance: PlayerManager | null = null;

  private windows = new Map<number, BrowserWindow>();

  static get(): PlayerManager {
    if (!this.instance) this.instance = new PlayerManager();
    return this.instance;
  }

  /**
   * プレイヤーウィンドウを開く。既存ウィンドウがあれば再利用して新しい動画パラメータを送信。
   */
  open(params: OpenPlayerParams): BrowserWindow {
    if (this.windows.size > 0) {
      const [, existing] = [...this.windows.entries()][0];
      const resolved: OpenPlayerParams = { ...params };
      if (resolved.localPath && !resolved.localFiles) {
        resolved.localFiles = this.resolveLocalFiles(resolved.localPath);
      }
      if (params.audioOnly) {
        existing.setMinimumSize(300, 100);
        existing.setSize(1100, 120);
      } else {
        existing.setMinimumSize(640, 400);
        if (existing.getSize()[1] < 400) {
          existing.setSize(1440, 900);
        }
      }
      existing.webContents.send('nndd:player:init', resolved);
      if (!params.autoNext || !existing.isMinimized()) {
        existing.show();
        existing.focus();
      }
      return existing;
    }

    const config = getConfigStore();
    const bgColor = config.get('ui').theme === 'light' ? '#f0f0f0' : '#000000';

    const isMini = !!params.audioOnly;
    const win = new BrowserWindow({
      width: isMini ? 1100 : 1440,
      height: isMini ? 120 : 900,
      minWidth: isMini ? 300 : 640,
      minHeight: isMini ? 100 : 400,
      autoHideMenuBar: true,
      backgroundColor: bgColor,
      title: 'NNDD-RE Player',
      show: false,
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: true
      }
    });

    // 'native' モード用: hls.js → ニコニコCDN直接アクセスに必要なCookie/CORS処理
    setupHlsSessionInterceptor(win.webContents.session);

    // ローカル再生時、付帯ファイル群を自動探索
    const resolved: OpenPlayerParams = { ...params };
    if (resolved.localPath && !resolved.localFiles) {
      resolved.localFiles = this.resolveLocalFiles(resolved.localPath);
    }

    // レンダラーのコンソールログをメインプロセスのログに転送
    win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
      const tag = ['verbose', 'info', 'warn', 'error'][level] ?? 'info';
      const src = sourceId?.split('/').pop() ?? '';
      log[tag === 'error' ? 'error' : tag === 'warn' ? 'warn' : 'info'](
        `[renderer:${tag}] ${message} (${src}:${line})`
      );
    });

    win.on('ready-to-show', () => {
      win.show();
      // 起動パラメータを renderer に渡す
      win.webContents.send('nndd:player:init', resolved);
    });
    // BrowserWindow レベルのフルスクリーン（OSボタン）を renderer に通知
    win.on('enter-full-screen', () => {
      win.webContents.send('nndd:player:window:fullscreen', true);
    });
    win.on('leave-full-screen', () => {
      win.webContents.send('nndd:player:window:fullscreen', false);
    });
    win.on('closed', () => {
      CommentWindowManager.get().close();
      this.windows.delete(win.id);
    });

    // 開発時は dev server, それ以外は out/renderer/player.html
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/player.html`);
    } else {
      win.loadFile(path.join(__dirname, '../renderer/player.html'));
    }

    this.windows.set(win.id, win);
    return win;
  }

  /**
   * 動画ファイルのフルパスから、NNDD 互換の付帯ファイル群を探索。
   *   `title - [id].mp4` の隣にある
   *     `title - [id].xml` (コメント)
   *     `title - [id][Owner].xml` (投コメ)
   *     `title - [id][ThumbInfo].xml` (動画情報)
   *     `title - [id].jpg` (サムネ)
   *   旧形式 `[id]title.mp4` も後方互換で対応。
   */
  private resolveLocalFiles(videoPath: string): OpenPlayerParams['localFiles'] {
    const dir = path.dirname(videoPath);
    const base = path.basename(videoPath).replace(/\.[^.]+$/, '');
    const pick = (suffix: string): string | undefined => {
      const p = path.join(dir, `${base}${suffix}`);
      return fs.existsSync(p) ? p : undefined;
    };
    // ThumbInfo XML を優先、なければ旧 [info].txt にフォールバック
    const thumbInfoXml =
      pick(VideoFileSuffix.THUMB_INFO_XML) ??
      pick(VideoFileSuffix.INFO_TXT_LEGACY);
    // 投コメは新形式 [Owner].xml を優先、なければ旧 [owner].xml
    const ownerCommentXml =
      pick(VideoFileSuffix.OWNER_COMMENT_XML) ??
      pick(VideoFileSuffix.OWNER_COMMENT_XML_LEGACY);
    const thumbImage =
      pick(VideoFileSuffix.THUMB_IMAGE) ??
      pick(VideoFileSuffix.THUMB_IMAGE_LEGACY);
    return {
      commentXml: pick(VideoFileSuffix.COMMENT_XML),
      ownerCommentXml,
      thumbInfoXml,
      thumbImage,
      ichibaHtml: pick(VideoFileSuffix.ICHIBA_INFO_HTML),
      nowCommentJson: pick(VideoFileSuffix.NOW_COMMENT_JSON)
    };
  }

  closeAll(): void {
    for (const w of this.windows.values()) {
      try {
        w.close();
      } catch {
        // ignore
      }
    }
    this.windows.clear();
  }

  count(): number {
    return this.windows.size;
  }
}
