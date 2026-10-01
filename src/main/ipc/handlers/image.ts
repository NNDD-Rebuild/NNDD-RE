import { ipcMain } from 'electron';
import { IpcChannel } from '@shared/types';
import { getConfigStore } from '../../config/ConfigStore';
import { NicoContext } from '../../nicovideo/NicoContext';
import { ImageCache } from '../../util/ImageCache';

/** 画像取得・画像キャッシュ (IMAGE_*) */
export function registerImageHandlers(): void {
  ipcMain.handle(IpcChannel.IMAGE_FETCH, async (_e, url: string) => {
    if (!url) return url;
    const ctx = NicoContext.get();
    return ImageCache.getOrFetch(url, ctx.http);
  });

  // 画像キャッシュ操作
  ipcMain.handle(IpcChannel.IMAGE_CACHE_INFO, () => {
    return ImageCache.info();
  });
  ipcMain.handle(IpcChannel.IMAGE_CACHE_CLEAR, () => {
    ImageCache.clear();
    return true;
  });
  ipcMain.handle(IpcChannel.IMAGE_CACHE_ENABLED_SET, (_e, enabled: boolean) => {
    ImageCache.setEnabled(enabled);
    getConfigStore().set('imageCache.enabled', enabled);
    return true;
  });
  ipcMain.handle(IpcChannel.IMAGE_CACHE_MAX_SIZE_SET, (_e, maxSizeMb: number) => {
    ImageCache.setMaxSizeMb(maxSizeMb);
    getConfigStore().set('imageCache.maxSizeMb', maxSizeMb);
    return true;
  });
}
