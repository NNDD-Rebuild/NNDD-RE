import fs from 'node:fs';
import path from 'node:path';
import { ipcMain, BrowserWindow, nativeTheme } from 'electron';
import { IpcChannel } from '@shared/types';
import {
  getConfigStore,
  DEFAULT_CONFIG,
  type ConfigKey,
  type ConfigTopLevelKey
} from '../../config/ConfigStore';
import { autoConfigureAllowedRoots } from '../../player/LocalVideoProtocol';
import { getDiscordRpcManager } from '../../discord/DiscordRpcManager';
import { createLogger, setLogLevel } from '../../util/Logger';
import type { IpcHandlerContext } from './context';

const log = createLogger('IPC');

/**
 * NnddConfig (ConfigStore.ts) に定義が無いが、renderer が CONFIG_GET / CONFIG_SET で使っているキー。
 * NnddConfig に追加したら、ここから外す。
 */
const RENDERER_EXTRA_CONFIG_KEYS = [
  'history.showWatchedBadge',
  'player.autoNextFolder',
  'player.pastCommentMaxCount',
  'ui.librarySortCol',
  'ui.librarySortDir'
] as const;

type RendererExtraConfigKey = (typeof RENDERER_EXTRA_CONFIG_KEYS)[number];

/** CONFIG_GET / CONFIG_SET で受け付けるキー */
type IpcConfigKey = ConfigKey | RendererExtraConfigKey;

/**
 * renderer から渡されたキーが設定として存在するか。
 * 既定値 (DEFAULT_CONFIG) をドット区切りでたどれるキーと、RENDERER_EXTRA_CONFIG_KEYS だけを許可する。
 * 配列の要素やプリミティブ値の内側 ('libraryRoot.length' など)、__proto__ などは通さない。
 * NnddConfig で省略可能 (?:) かつ既定値に無いキーも通らない (renderer からは使っていない)。
 */
function isIpcConfigKey(key: unknown): key is IpcConfigKey {
  if (typeof key !== 'string' || key === '') return false;
  if ((RENDERER_EXTRA_CONFIG_KEYS as readonly string[]).includes(key)) return true;
  let node: unknown = DEFAULT_CONFIG;
  for (const seg of key.split('.')) {
    if (node === null || typeof node !== 'object' || Array.isArray(node)) return false;
    if (!Object.prototype.hasOwnProperty.call(node, seg)) return false;
    node = (node as Record<string, unknown>)[seg];
  }
  return true;
}

function isTopLevelKey(key: IpcConfigKey): key is ConfigTopLevelKey {
  return !key.includes('.');
}

/** 設定 (CONFIG_*)。CONFIG_SET は一部キーの変更を各機能へ即時反映する */
export function registerConfigHandlers(ctx: IpcHandlerContext): void {
  const { library, liveFollowNotifier } = ctx;

  ipcMain.handle(IpcChannel.CONFIG_GET_ALL, () => {
    return getConfigStore().store;
  });

  ipcMain.handle(IpcChannel.CONFIG_GET, (_e, key: unknown) => {
    if (!isIpcConfigKey(key)) {
      log.warn('CONFIG_GET: unknown config key, ignored:', key);
      return undefined;
    }
    const store = getConfigStore();
    return isTopLevelKey(key) ? store.get(key) : store.get(key);
  });

  ipcMain.handle(IpcChannel.CONFIG_SET, (e, key: unknown, value: unknown) => {
    if (!isIpcConfigKey(key)) {
      log.warn('CONFIG_SET: unknown config key, ignored:', key);
      return false;
    }
    getConfigStore().set(key, value);
    if (key === 'ui.theme') {
      const bgColor = value === 'light' ? '#f0f0f0' : '#1e1e1e';
      BrowserWindow.fromWebContents(e.sender)?.setBackgroundColor(bgColor);
      nativeTheme.themeSource = value === 'light' ? 'light' : 'dark';
    }
    if (key === 'logLevel') {
      setLogLevel(value as 'standard' | 'verbose');
    }
    if (key === 'live.followNotify' || key === 'live.followNotifyIntervalMin') {
      liveFollowNotifier.apply();
    }
    if (key.startsWith('discordRpc.')) {
      void getDiscordRpcManager().onConfigChanged();
    }
    if (key === 'libraryRoot') {
      const dir = typeof value === 'string' && value ? value : library.defaultVideoDir;
      library.videoDir = dir;
      fs.mkdirSync(dir, { recursive: true });
      const cacheRoot = getConfigStore().get('cacheRoot');
      const extraPaths = [library.libraryDir, library.rootDir, dir];
      if (cacheRoot) extraPaths.push(path.join(String(cacheRoot), 'cache', 'movie'));
      autoConfigureAllowedRoots(extraPaths);
    }
    return true;
  });
}
