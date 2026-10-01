import os from 'node:os';
import { ipcMain } from 'electron';
import { IpcChannel } from '@shared/types';
import { getConfigStore } from '../../config/ConfigStore';
import { NnddHttpServer } from '../../server/NnddHttpServer';
import { LanLibraryClient } from '../../server/LanLibraryClient';
import { createLogger } from '../../util/Logger';
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

  // 自動起動
  if (getConfigStore().get('httpServer').enabled) {
    runtimeHttpServer = new NnddHttpServer(library);
    runtimeHttpServer.start().then(({ port }) => {
      log.info('HTTP server auto-started on port', port);
    }).catch((e) => {
      log.warn('HTTP server auto-start failed:', e);
      runtimeHttpServer = null;
    });
  }

  ipcMain.handle(IpcChannel.HTTPD_START, async () => {
    if (runtimeHttpServer) return { port: runtimeHttpServer.getPort(), running: true };
    runtimeHttpServer = new NnddHttpServer(library);
    const { port } = await runtimeHttpServer.start();
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
      let lanIp: string | undefined;
      if (runtimeHttpServer.getAllowExternal()) {
        lanIp = getLanIp();
      }
      return { running: true, port, lanIp };
    }
    return { running: false };
  });

  // --- LANライブラリ (本家NNDD互換クライアント) ---
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

function getLanIp(): string | undefined {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (
        net.family === 'IPv4' &&
        !net.internal &&
        !net.address.startsWith('169.254.')
      ) {
        return net.address;
      }
    }
  }
  return undefined;
}
