import { BrowserWindow, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { CommentWindowManager } from './CommentWindowManager';
import { is } from '@electron-toolkit/utils';
import { getConfigStore } from '../config/ConfigStore';
import { VideoFileSuffix } from '@shared/constants';
import type { OpenPlayerParams, PlayerLocalFiles } from '@shared/types';
import { createLogger } from '../util/Logger';
import { setupHlsSessionInterceptor } from './HlsSessionInterceptor';
import { registerProtocolHandlerForSession } from './LocalVideoProtocol';
import { findNicowariFiles, NICOWARI_MARK } from '../library/NicowariSwf';
import { getDiscordRpcManager } from '../discord/DiscordRpcManager';

const log = createLogger('PlayerManager');

export type { OpenPlayerParams };

/**
 * 動画プレイヤーウィンドウの管理。
 * 元: src/org/mineap/nndd/player/PlayerManager.as
 *   プレイヤーは 1 ウィンドウのみ。開いていれば常にそれを再利用する
 *   (hideWatchHistory の切替時だけ partition が変わるため作り直す)。
 */
export class PlayerManager {
  private static instance: PlayerManager | null = null;

  private windows = new Map<number, BrowserWindow>();

  static get(): PlayerManager {
    if (!this.instance) this.instance = new PlayerManager();
    return this.instance;
  }

  /** window ごとの hideWatchHistory 状態 (partition分離判定用) */
  private windowHideHistory = new WeakMap<BrowserWindow, boolean>();

  /**
   * プレイヤーウィンドウを開く。既存ウィンドウがあれば再利用して新しい動画パラメータを送信。
   */
  open(params: OpenPlayerParams): BrowserWindow {
    params = this.applyAudioOnlyDetection(params);
    const config = getConfigStore();
    const hideHistory = config.get('hideWatchHistory') ?? false;

    if (this.windows.size > 0) {
      const [, existing] = [...this.windows.entries()][0];
      const existingHideHistory = this.windowHideHistory.get(existing) ?? false;
      // hideWatchHistory 状態が切り替わったら既存windowを閉じて新規作成する。
      // partition が違う (Cookie分離 or 共有) ため再利用不可。
      if (existingHideHistory !== hideHistory) {
        log.info(`hideWatchHistory 切替 (${existingHideHistory} → ${hideHistory}), 既存プレイヤーを閉じて再生成`);
        existing.close();
      } else {
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
    }

    const bgColor = config.get('ui').theme === 'light' ? '#f0f0f0' : '#000000';

    const isMini = !!params.audioOnly;
    // hideWatchHistory=ON時は Cookie を共有しない一時partitionを使う。
    // persist: プレフィックス無し = メモリセッション (アプリ再起動やwindow破棄で消える)。
    // これで default session の nicovideo.jp Cookie が player の HLS リクエストに送られなくなり、
    // guest access-rights で発行された CloudFront URL が uid 不整合で 403 になるのを回避する。
    const partition = hideHistory ? `nndd-guest-${Date.now()}` : undefined;
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
        webviewTag: true,
        ...(partition ? { partition } : {})
      }
    });
    this.windowHideHistory.set(win, hideHistory);

    // 概要欄等のリンクを新規BrowserWindowで開こうとするとハンドラ未設定でクラッシュしうるため、
    // 既定の新規ウィンドウ生成を拒否し外部ブラウザで開く。
    // ただし Document Picture-in-Picture (ミニプレイヤー) は disposition: 'picture-in-picture' で
    // 来るため、これは許可しないと about:blank が外部ブラウザで開いてしまう。
    win.webContents.setWindowOpenHandler((details) => {
      // Electronの型定義が Document Picture-in-Picture の disposition 値に未対応のためキャスト
      if ((details.disposition as string) === 'picture-in-picture') {
        return { action: 'allow' };
      }
      void shell.openExternal(details.url);
      return { action: 'deny' };
    });

    // 'native' モード用: hls.js → ニコニコCDN直接アクセスに必要なCookie/CORS処理
    setupHlsSessionInterceptor(win.webContents.session, hideHistory);
    // partition (hideWatchHistory=ON) はdefaultSessionと別セッションのため、
    // nndd-re-local:// プロトコルを個別に登録しないとローカル再生が失敗する。
    if (partition) {
      registerProtocolHandlerForSession(win.webContents.session);
    }

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
    // closed 後は webContents に触れないので、ID は先に控えておく
    const webContentsId = win.webContents.id;
    win.on('closed', () => {
      // レンダラー側の unmount は ×閉じ時に間に合わないことがあるため、Discord Presence はここでもクリアする
      void getDiscordRpcManager().clearActivity(webContentsId);
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
   * localPath の拡張子が .m4a (音声のみDL済みファイル) なら audioOnly を強制する。
   */
  private applyAudioOnlyDetection(params: OpenPlayerParams): OpenPlayerParams {
    if (params.localPath && path.extname(params.localPath).toLowerCase() === '.m4a') {
      return { ...params, audioOnly: true, audioOnlyDetected: !params.audioOnly };
    }
    return params;
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
  resolveLocalFiles(videoPath: string): PlayerLocalFiles {
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
    let nicowari: string[] = [];
    try {
      const entries = fs.readdirSync(dir).filter((name) => name.includes(NICOWARI_MARK));
      nicowari = findNicowariFiles(videoPath, entries);
    } catch {
      // フォルダが読めなければニコ割なし扱い
    }
    return {
      commentXml: pick(VideoFileSuffix.COMMENT_XML),
      ownerCommentXml,
      thumbInfoXml,
      thumbImage,
      ichibaHtml: pick(VideoFileSuffix.ICHIBA_INFO_HTML),
      nowCommentJson: pick(VideoFileSuffix.NOW_COMMENT_JSON),
      nicowari
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
