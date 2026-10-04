import { BrowserWindow, ipcMain } from 'electron';
import {
  IpcChannel,
  type HonkeImportProgress,
  type HonkeImportSelection,
  type HonkeImportSource
} from '@shared/types';
import { HonkeImporter } from '../../import/HonkeImporter';
import type { IpcHandlerContext } from './context';

function broadcast(channel: string, payload?: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

/** 本家NNDDからのインポート (HONKE_*) */
export function registerHonkeImportHandlers(ctx: IpcHandlerContext): void {
  const createImporter = (): HonkeImporter =>
    new HonkeImporter({
      library: ctx.library,
      enqueueDownload: (videoId) => ctx.dlManager.enqueue({ videoId }),
      onProgress: (p: HonkeImportProgress) => broadcast(IpcChannel.HONKE_PROGRESS, p),
      onNgChanged: () => broadcast(IpcChannel.NG_COMMENT_CHANGED)
    });

  ipcMain.handle(IpcChannel.HONKE_DETECT, () => HonkeImporter.detect());

  ipcMain.handle(IpcChannel.HONKE_RESOLVE, (_e, picked: string) => HonkeImporter.resolve(picked));

  ipcMain.handle(IpcChannel.HONKE_PREVIEW, (_e, source: HonkeImportSource) =>
    createImporter().preview(source)
  );

  ipcMain.handle(IpcChannel.HONKE_APPLY, (_e, selection: HonkeImportSelection) =>
    createImporter().apply(selection)
  );
}
