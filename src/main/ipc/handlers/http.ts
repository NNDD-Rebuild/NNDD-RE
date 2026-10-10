import { ipcMain } from 'electron';
import { IpcChannel } from '@shared/types';
import { getConfigStore } from '../../config/ConfigStore';
import { NnddHttpServer } from '../../server/NnddHttpServer';
import { LanLibraryClient } from '../../server/LanLibraryClient';
import { SecretStore } from '../../server/SecretStore';
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
        waitingForTailscale: runtimeHttpServer.isWaitingForTailscale()
      };
    }
    return { running: false };
  });

  // アクセストークン (表示・QR 用。再生成すると旧トークンは即無効)
  ipcMain.handle(IpcChannel.HTTPD_TOKEN_GET, () => ({ token: SecretStore.getOrCreateAccessToken() }));
  ipcMain.handle(IpcChannel.HTTPD_TOKEN_REGENERATE, () => ({ token: SecretStore.regenerateAccessToken() }));

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
