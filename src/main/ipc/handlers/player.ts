import { ipcMain, BrowserWindow, WebContentsView, session, screen } from 'electron';
import { IpcChannel } from '@shared/types';
import type { DiscordActivityInfo } from '@shared/types';
import { NICO_COOKIE_DOMAIN, NicoApi } from '@shared/constants';
import { watchUrl } from '@shared/utils/nicoUrl';
import { NicoContext } from '../../nicovideo/NicoContext';
import { getDiscordRpcManager } from '../../discord/DiscordRpcManager';
import { createLogger } from '../../util/Logger';

const log = createLogger('IPC');

/**
 * プレイヤー窓まわり: Discord Rich Presence (DISCORD_RPC_*)・
 * niconico モードの WebContentsView (PLAYER_NICONICO_*)・窓の高さ調整 (PLAYER_WINDOW_*)。
 */
export function registerPlayerHandlers(): void {
  // --- Discord Rich Presence ---
  ipcMain.handle(IpcChannel.DISCORD_RPC_STATUS, () => {
    return getDiscordRpcManager().status();
  });
  ipcMain.on(IpcChannel.DISCORD_RPC_SET_ACTIVITY, (e, info: DiscordActivityInfo) => {
    void getDiscordRpcManager().setActivity(info, e.sender.id);
  });
  ipcMain.on(IpcChannel.DISCORD_RPC_CLEAR_ACTIVITY, (e) => {
    void getDiscordRpcManager().clearActivity(e.sender.id);
  });

  // niconicoモード: WebContentsView管理 (windowごとに1つ)
  interface NicoBounds { x: number; y: number; width: number; height: number }
  interface NiconicoEntry { view: WebContentsView; bounds: NicoBounds | null }
  const niconicoViews = new Map<number, NiconicoEntry>();

  // プレイヤー要素に合わせてzoom + view位置オフセットでヘッダーをウィンドウ外へ追い出す
  // PlayerPresenter は React SPA が後から注入するため、最大 retries 回リトライする
  const fitPlayerToView = async (entry: NiconicoEntry, retries = 8, delayMs = 1500): Promise<void> => {
    if (!entry.bounds || entry.bounds.width <= 0) return;
    try {
      const rect = await entry.view.webContents.executeJavaScript(`
        (() => {
          const el = document.querySelector('[class*="PlayerPresenter"]');
          if (!el) return null;
          const r = el.getBoundingClientRect();
          // プレイヤー要素本体の幅（zoom 反映前）
          const nativeWidth = el.scrollWidth || el.offsetWidth;
          return {
            x: r.left + window.scrollX,
            y: r.top + window.scrollY,
            w: r.width,
            h: r.height,
            nativeW: nativeWidth
          };
        })()
      `);
      if (!rect || rect.nativeW <= 0) {
        // 要素未生成 → リトライ
        if (retries > 0) {
          setTimeout(() => { void fitPlayerToView(entry, retries - 1, delayMs); }, delayMs);
        }
        return;
      }
      const { x, y, width, height } = entry.bounds;
      const MARGIN = 8;
      const LEFT_MARGIN = -30; // 左側マージン調整: 0 = 詰まる、正数で右に移動、負数で左に詰まる
      // プレイヤー要素本体がコンテナにぴったり収まるように zoom を計算
      // zoomScale: 1.0 = 標準、0.9 = 10%小さく、1.1 = 10%大きく
      const zoomScale = 0.97;
      const zoom = ((width - MARGIN) / rect.nativeW) * zoomScale;
      entry.view.webContents.setZoomFactor(zoom);
      // プレイヤー右端をdiv右端に揃える
      const xOff = Math.max(0, Math.round((rect.x + rect.w) * zoom - width) - LEFT_MARGIN);
      const yOff = Math.round(rect.y * zoom);
      log.verbose('fitPlayerToView:', {
        'nativeW (player)': rect.nativeW,
        'entry.bounds.width': width,
        'baseZoom': (width - MARGIN) / rect.nativeW,
        'zoomScale': zoomScale,
        'calculatedZoom': zoom
      });
      entry.view.setBounds({ x: x - xOff, y: y - yOff, width: width + xOff, height: height + yOff });
    } catch (e) { log.error('fitPlayerToView error:', e); }
  };

  ipcMain.on(IpcChannel.PLAYER_NICONICO_INIT, (e, { videoId }: { videoId: string }) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return;
    const existing = niconicoViews.get(win.id);
    if (existing) {
      try { win.contentView.removeChildView(existing.view); } catch { /* 既に外れている場合は何もしない */ }
      existing.view.webContents.close();
    }
    const view = new WebContentsView({
      webPreferences: { partition: 'persist:niconico', contextIsolation: true }
    });
    const entry: NiconicoEntry = { view, bounds: null };
    win.contentView.addChildView(view);

    // NicoContext の Cookie (user_session 等) を persist:niconico session に注入してログイン状態を引き継ぐ
    void (async (): Promise<void> => {
      try {
        const ctx = NicoContext.get();
        const nicoSes = session.fromPartition('persist:niconico');
        const cookies = await ctx.cookieStore.rawJar.getCookies(NicoApi.TOP);
        for (const c of cookies) {
          await nicoSes.cookies.set({
            url: NicoApi.WWW_BASE,
            name: c.key,
            value: c.value,
            domain: c.domain ?? NICO_COOKIE_DOMAIN,
            path: c.path ?? '/',
            secure: Boolean(c.secure),
            httpOnly: Boolean(c.httpOnly),
            ...(c.expires && c.expires !== 'Infinity'
              ? { expirationDate: Math.floor((c.expires instanceof Date ? c.expires : new Date(c.expires as string)).getTime() / 1000) }
              : {})
          });
        }
      } catch (e) {
        log.warn('PLAYER_NICONICO_INIT: cookie injection failed:', e);
      }
    })();

    // did-finish-load 後もSPAの遅延レンダリングがあるので1.5s遅らせてリトライ開始
    view.webContents.on('did-finish-load', () => {
      setTimeout(() => { void fitPlayerToView(entry); }, 1500);
    });
    view.webContents.loadURL(watchUrl(videoId));
    niconicoViews.set(win.id, entry);

    // niconicoプレイヤー内の requestFullscreen() を拾ってviewをリサイズ
    view.webContents.on('enter-html-full-screen', () => {
      const [w, h] = win.getContentSize();
      view.setBounds({ x: 0, y: 0, width: w, height: h });
      e.sender.send(IpcChannel.PLAYER_NICONICO_FULLSCREEN, true);
    });
    view.webContents.on('leave-html-full-screen', () => {
      // 元のboundsに戻す
      if (entry.bounds) view.setBounds(entry.bounds);
      e.sender.send(IpcChannel.PLAYER_NICONICO_FULLSCREEN, false);
    });

    // ウィンドウ × 閉じ時に WebContentsView を確実に破棄 (音が残るのを防ぐ)
    win.once('closed', () => {
      try { entry.view.webContents.close(); } catch { /* 破棄済みなら何もしない */ }
      niconicoViews.delete(win.id);
    });
  });

  ipcMain.handle(IpcChannel.PLAYER_WINDOW_ADJUST_HEIGHT, (e, deltaPx: number) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const delta = Math.round(Number(deltaPx) || 0);
    if (!win || delta === 0 || win.isFullScreen() || win.isMaximized()) return 0;
    const [w, h] = win.getContentSize();
    win.setContentSize(w, Math.max(1, h + delta));
    // 最小サイズ等で OS/Electron に補正されることがあるため、実際の変化量を返す
    // (呼び出し側はこの値で元に戻す)
    const actualHeight = win.getContentSize()[1];
    // 伸ばした結果ウィンドウ下端が画面外に出る場合は上へずらす
    if (delta > 0) {
      const bounds = win.getBounds();
      const area = screen.getDisplayMatching(bounds).workArea;
      const overflow = bounds.y + bounds.height - (area.y + area.height);
      if (overflow > 0) {
        win.setPosition(bounds.x, Math.max(area.y, bounds.y - overflow));
      }
    }
    return actualHeight - h;
  });

  ipcMain.on(IpcChannel.PLAYER_NICONICO_RESIZE, (e, bounds: NicoBounds) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return;
    const entry = niconicoViews.get(win.id);
    if (entry && bounds.width > 0 && bounds.height > 0) {
      entry.bounds = { x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.round(bounds.width), height: Math.round(bounds.height) };
      // 初期配置はdiv境界そのまま (fitPlayerToViewで補正される)
      entry.view.setBounds(entry.bounds);
      void fitPlayerToView(entry);
    }
  });

  ipcMain.on(IpcChannel.PLAYER_NICONICO_DESTROY, (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return;
    const entry = niconicoViews.get(win.id);
    if (entry) {
      try { win.contentView.removeChildView(entry.view); } catch { /* 既に外れている場合は何もしない */ }
      entry.view.webContents.close();
      niconicoViews.delete(win.id);
    }
  });
}
