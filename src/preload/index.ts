import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { electronAPI } from '@electron-toolkit/preload';
import { IpcChannel, IpcChannelValue } from '@shared/types';

/**
 * レンダラー側に公開する API。
 * チャネル名のホワイトリスト化で安全性を確保する。
 */
const allowedChannels = new Set<string>(Object.values(IpcChannel));

function assertAllowed(channel: string): void {
  if (!allowedChannels.has(channel)) {
    throw new Error(`IPC channel not allowed: ${channel}`);
  }
}

const api = {
  async invoke<T = unknown>(channel: IpcChannelValue, ...args: unknown[]): Promise<T> {
    assertAllowed(channel);
    return ipcRenderer.invoke(channel, ...args);
  },

  /**
   * 引数の型は listener の注釈から推論する。main 側の webContents.send は型付けされておらず
   * チャンネル別の型マップを置いても送信側を検証できないため、invoke<T> と同じく呼び出し側の宣言に任せる。
   */
  on<A extends unknown[] = unknown[]>(
    channel: IpcChannelValue,
    listener: (...args: A) => void
  ): () => void {
    assertAllowed(channel);
    const wrapped = (_e: IpcRendererEvent, ...args: unknown[]): void => listener(...(args as A));
    ipcRenderer.on(channel, wrapped);
    return () => {
      ipcRenderer.removeListener(channel, wrapped);
    };
  },

  send(channel: IpcChannelValue, ...args: unknown[]): void {
    assertAllowed(channel);
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
  // contextIsolation: false のときは preload とページが同じ window を共有するので直接代入する。
  // node 側 tsconfig は DOM lib を持たないため window ではなく globalThis 経由で書く。
  const g = globalThis as unknown as { electron: typeof electronAPI; nndd: typeof api };
  g.electron = electronAPI;
  g.nndd = api;
}

export type NnddPreloadApi = typeof api;
