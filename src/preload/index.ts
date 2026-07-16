import { contextBridge, ipcRenderer } from 'electron';
import { electronAPI } from '@electron-toolkit/preload';
import { IpcChannel, IpcChannelValue } from '@shared/types';

/**
 * レンダラー側に公開する API。
 * チャネル名のホワイトリスト化で安全性を確保する。
 */
const allowedChannels = new Set<string>(Object.values(IpcChannel));

const api = {
  invoke<T = unknown>(channel: IpcChannelValue, ...args: unknown[]): Promise<T> {
    if (!allowedChannels.has(channel)) {
      return Promise.reject(new Error(`IPC channel not allowed: ${channel}`));
    }
    return ipcRenderer.invoke(channel, ...args);
  },

  on(channel: IpcChannelValue, listener: (...args: unknown[]) => void): () => void {
    if (!allowedChannels.has(channel)) {
      throw new Error(`IPC channel not allowed: ${channel}`);
    }
    const wrapped = (_e: unknown, ...args: unknown[]): void => listener(...args);
    ipcRenderer.on(channel, wrapped);
    return () => {
      ipcRenderer.removeListener(channel, wrapped);
    };
  },

  send(channel: IpcChannelValue, ...args: unknown[]): void {
    if (!allowedChannels.has(channel)) {
      throw new Error(`IPC channel not allowed: ${channel}`);
    }
    ipcRenderer.send(channel, ...args);
  },

  channels: IpcChannel
};

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI);
    contextBridge.exposeInMainWorld('nndd', api);
  } catch (error) {
    console.error('contextBridge.exposeInMainWorld failed:', error);
  }
} else {
  // sandbox: false の場合のフォールバック
  (window as unknown as { electron: typeof electronAPI }).electron = electronAPI;
  (window as unknown as { nndd: typeof api }).nndd = api;
}

export type NnddPreloadApi = typeof api;
