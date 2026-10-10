import { ipcMain } from 'electron';
import { IpcChannel } from '@shared/types';
import { getConfigStore } from '../../config/ConfigStore';
import { NnddHttpServer } from '../../server/NnddHttpServer';
import { LanLibraryClient } from '../../server/LanLibraryClient';
import fs from 'node:fs';
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
export function registerHttpHandlers(ctx: IpcHandlerContext): void {
  const { library } = ctx;

  // --- HTTPサーバー制御 ---
  let runtimeHttpServer: NnddHttpServer | null = null;

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
      // 設定画面の URL・QR は getAccessUrls と同じ優先順位の先頭を使う (Tailscale の 100.x を LAN と取り違えない)
      const lanIp = bindMode === 'lan' ? runtimeHttpServer.getAccessHosts()[0] : undefined;
      const tailscaleIp = bindMode === 'tailscale' ? runtimeHttpServer.getAccessHosts()[0] : undefined;
      return {
        running: true,
        port,
        lanIp,
        bindMode,
        tailscaleIp,
        waitingForTailscale: runtimeHttpServer.isWaitingForTailscale(),
        exposure: runtimeHttpServer.getExposureStatus() ?? undefined
      };
    }
    return { running: false };
  });

  // アクセストークン (表示・QR 用。再生成すると旧トークンは即無効)
  ipcMain.handle(IpcChannel.HTTPD_TOKEN_GET, () => ({ token: SecretStore.getOrCreateAccessToken() }));
  ipcMain.handle(IpcChannel.HTTPD_TOKEN_REGENERATE, () => ({ token: SecretStore.regenerateAccessToken() }));

  // --- Tailscale サイドカー (独立端末) ---
  const nodeRunning = (): boolean =>
    runtimeHttpServer !== null && runtimeHttpServer.getBindMode() === 'tailscale-node';

  ipcMain.handle(IpcChannel.TAILSCALE_STATUS, () => ({
    ...SidecarInstaller.status(),
    hasAuthKey: SecretStore.get('tailscaleAuthKey') !== null,
    hasLogin: fs.existsSync(SidecarInstaller.stateDir()),
    exposure: nodeRunning() ? runtimeHttpServer?.getExposureStatus() ?? null : null
  }));
  ipcMain.handle(IpcChannel.TAILSCALE_INSTALL, async (event) => {
    await SidecarInstaller.install((pct) => {
      event.sender.send(IpcChannel.BINARY_INSTALL_PROGRESS, { tool: 'tailscale', pct });
    });
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
  const lanClient = (cfg: { address: string; port: number }): LanLibraryClient =>
    new LanLibraryClient(cfg.address, cfg.port, SecretStore.get('remoteNnddToken') ?? undefined);

  // 接続先のアクセストークン (設定には保存せず SecretStore へ。空文字で削除)
  ipcMain.handle(IpcChannel.LAN_TOKEN_STATUS, () => ({ hasToken: SecretStore.get('remoteNnddToken') !== null }));
  ipcMain.handle(IpcChannel.LAN_TOKEN_SET, (_e, token: unknown) => {
    const t = typeof token === 'string' ? token.trim() : '';
    if (t) SecretStore.set('remoteNnddToken', t);
    else SecretStore.delete('remoteNnddToken');
    return { hasToken: t.length > 0 };
  });
  ipcMain.handle(IpcChannel.LAN_STATUS, async () => {
    const cfg = getConfigStore().get('remoteNndd');
    if (!cfg.enabled || !cfg.address) return { reachable: false };
    const client = lanClient(cfg);
    const reachable = await client.ping();
    return { reachable };
  });

  ipcMain.handle(IpcChannel.LAN_LIBRARY_LIST, async () => {
    const cfg = getConfigStore().get('remoteNndd');
    if (!cfg.enabled || !cfg.address) return [];
    const client = lanClient(cfg);
    return await client.getVideoIdList();
  });

  ipcMain.handle(IpcChannel.LAN_VIDEO_STREAM, async (_e, videoId: string) => {
    const cfg = getConfigStore().get('remoteNndd');
    if (!cfg.enabled || !cfg.address) return null;
    const client = lanClient(cfg);
    return await client.getVideoById(videoId);
  });
}
