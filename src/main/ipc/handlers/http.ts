import { ipcMain } from 'electron';
import { IpcChannel } from '@shared/types';
import { getConfigStore } from '../../config/ConfigStore';
import { NnddHttpServer } from '../../server/NnddHttpServer';
import { LanLibraryClient } from '../../server/LanLibraryClient';
import fs from 'node:fs';
import { detectTailscaleIps, getAccessUrls, isTailscaleIp } from '../../server/ServerStats';
import { SecretStore } from '../../server/SecretStore';
import { SidecarInstaller } from '../../server/tailscale/SidecarInstaller';
import { createLogger } from '../../util/Logger';
import { isHeadless } from '../../util/headless';
import { startHeadlessDashboard } from '../../server/headlessDashboard';
import type { IpcHandlerContext } from './context';

const log = createLogger('IPC');

/**
 * 内蔵 HTTP サーバー (HTTPD_*。設定で有効なら登録時に自動起動)・
 * LAN ライブラリ (LAN_*、本家NNDD互換クライアント)。
 */
/** 内蔵HTTPサーバー (起動中なら)。アプリ終了時に止められるようモジュール内で保持する */
let runtimeHttpServer: NnddHttpServer | null = null;

/**
 * アプリ終了時に内蔵HTTPサーバーと Tailscale への公開 (serve の設定・サイドカー) を止める。
 * 止めないと tailscale serve の設定が残り、次回起動で「別の用途で使用中」と誤判定されうる。
 */
export async function shutdownHttpServer(): Promise<void> {
  const server = runtimeHttpServer;
  runtimeHttpServer = null;
  if (server) await server.stop();
}

export function registerHttpHandlers(ctx: IpcHandlerContext): void {
  const { library } = ctx;

  // --- HTTPサーバー制御 ---

  // 自動起動 (ヘッドレス時は設定を書き換えず enabled を強制 true 扱い)
  if (isHeadless || getConfigStore().get('httpServer').enabled) {
    runtimeHttpServer = new NnddHttpServer(library);
    const server = runtimeHttpServer;
    server.start().then(({ port }) => {
      log.info('HTTP server auto-started on port', port);
      if (isHeadless) startHeadlessDashboard(server);
    }).catch((e) => {
      log.warn('HTTP server auto-start failed:', e);
      runtimeHttpServer = null;
    });
  }

  ipcMain.handle(IpcChannel.HTTPD_START, async () => {
    if (runtimeHttpServer) return { port: runtimeHttpServer.getPort(), running: true };
    // start() が失敗 (ポート使用中など) したときに停止済みのインスタンスを残さない
    const server = new NnddHttpServer(library);
    const { port } = await server.start();
    runtimeHttpServer = server;
    return { port, running: true };
  });
  ipcMain.handle(IpcChannel.HTTPD_STOP, async () => {
    if (runtimeHttpServer) {
      await runtimeHttpServer.stop();
      runtimeHttpServer = null;
    }
    return { running: false };
  });
  ipcMain.handle(IpcChannel.HTTPD_STATUS, () => {
    if (runtimeHttpServer) {
      const port = runtimeHttpServer.getPort();
      const bindMode = runtimeHttpServer.getBindMode();
      // LAN 内の IP (loopback 以外は 0.0.0.0 で待ち受ける)。独立端末のときも LAN 内の IP から入れる
      const lanIp =
        bindMode !== 'loopback'
          ? getAccessUrls(port, 'lan').map((u) => new URL(u).hostname).find((h) => h !== '127.0.0.1' && !isTailscaleIp(h))
          : undefined;
      // LAN 公開のときは、同じPCの Tailscale (導入済みなら) 経由でも届く。その URL も画面に出す
      const tailscaleIp = bindMode === 'lan' ? detectTailscaleIps()[0] : undefined;
      return {
        running: true,
        port,
        lanIp,
        bindMode,
        tailscaleIp,
        exposure: runtimeHttpServer.getExposureStatus() ?? undefined
      };
    }
    return { running: false };
  });

  // --- Tailscale サイドカー (独立端末) ---
  const nodeRunning = (): boolean =>
    runtimeHttpServer !== null && runtimeHttpServer.getBindMode() === 'tailscale-node';

  ipcMain.handle(IpcChannel.TAILSCALE_STATUS, () => ({
    ...SidecarInstaller.status(),
    hasAuthKey: SecretStore.get('tailscaleAuthKey') !== null,
    hasLogin: fs.existsSync(SidecarInstaller.stateDir()),
    exposure: nodeRunning() ? runtimeHttpServer?.getExposureStatus() ?? null : null
  }));
  let sidecarInstalling = false;
  ipcMain.handle(IpcChannel.TAILSCALE_INSTALL, async (event) => {
    if (nodeRunning()) throw new Error('内蔵HTTPサーバーを停止してから取得・更新してください');
    if (sidecarInstalling) throw new Error('取得中です');
    sidecarInstalling = true;
    try {
      await SidecarInstaller.install((pct) => {
        event.sender.send(IpcChannel.BINARY_INSTALL_PROGRESS, { tool: 'tailscale', pct });
      });
    } finally {
      sidecarInstalling = false;
    }
    return SidecarInstaller.status();
  });
  ipcMain.handle(IpcChannel.TAILSCALE_UNINSTALL, () => {
    if (nodeRunning()) throw new Error('内蔵HTTPサーバーを停止してから削除してください');
    SidecarInstaller.uninstall();
    return SidecarInstaller.status();
  });
  // Auth key は使い捨て。SecretStore に置き、ログインできたらサイドカーの起動処理が消す (空文字で削除)
  ipcMain.handle(IpcChannel.TAILSCALE_AUTHKEY_SET, (_e, key: unknown) => {
    const k = typeof key === 'string' ? key.trim() : '';
    if (k) SecretStore.set('tailscaleAuthKey', k);
    else SecretStore.delete('tailscaleAuthKey');
    return { hasAuthKey: k.length > 0 };
  });
  // tailnet からログアウトして (端末を削除) 状態を消す。サーバーが動いていなければ状態だけ消す
  ipcMain.handle(IpcChannel.TAILSCALE_LOGOUT, async () => {
    const loggedOut = nodeRunning() ? await runtimeHttpServer!.logoutExposure() : false;
    if (!loggedOut) SidecarInstaller.removeState();
    SecretStore.delete('tailscaleAuthKey');
    return { loggedOut };
  });

  // --- LANライブラリ (リモートNNDD参照) ---
  ipcMain.handle(IpcChannel.LAN_STATUS, async () => {
    const cfg = getConfigStore().get('remoteNndd');
    if (!cfg.enabled || !cfg.address) return { reachable: false };
    const client = new LanLibraryClient(cfg.address, cfg.port);
    const reachable = await client.ping();
    return { reachable };
  });

  ipcMain.handle(IpcChannel.LAN_LIBRARY_LIST, async () => {
    const cfg = getConfigStore().get('remoteNndd');
    if (!cfg.enabled || !cfg.address) return [];
    const client = new LanLibraryClient(cfg.address, cfg.port);
    return await client.getVideoIdList();
  });

  ipcMain.handle(IpcChannel.LAN_VIDEO_STREAM, async (_e, videoId: string) => {
    const cfg = getConfigStore().get('remoteNndd');
    if (!cfg.enabled || !cfg.address) return null;
    const client = new LanLibraryClient(cfg.address, cfg.port);
    return await client.getVideoById(videoId);
  });
}
