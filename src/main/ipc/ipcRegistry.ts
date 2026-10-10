import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { trackIpcCall } from '../telemetry/ipcEvents';

/**
 * ipcMain.handle に登録されたハンドラを記録し、HTTP (ブラウザ版プレイヤー) からも
 * 同じ実装を呼べるようにするレジストリ。
 *
 * registerIpcHandlers の先頭で installIpcRegistry() を呼ぶこと (それ以前に登録された
 * ハンドラは記録されない)。
 */
type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

const handlers = new Map<string, Handler>();
let installed = false;

export function installIpcRegistry(): void {
  if (installed) return;
  installed = true;

  const origHandle = ipcMain.handle.bind(ipcMain);
  const origRemove = ipcMain.removeHandler.bind(ipcMain);

  ipcMain.handle = ((channel: string, listener: Handler) => {
    // 匿名統計 (同意時のみ送信) の計測点もここに集約する。HTTP 経由の呼び出しも同じ関数を通る
    const wrapped: Handler = (event, ...args) => {
      const result = listener(event, ...args);
      trackIpcCall(channel, args, result);
      return result;
    };
    handlers.set(channel, wrapped);
    return origHandle(channel, wrapped);
  }) as typeof ipcMain.handle;

  ipcMain.removeHandler = ((channel: string) => {
    handlers.delete(channel);
    return origRemove(channel);
  }) as typeof ipcMain.removeHandler;
}

export function hasRegisteredHandler(channel: string): boolean {
  return handlers.has(channel);
}

/**
 * 登録済みハンドラを呼ぶ。event.sender を使うハンドラは呼べない
 * (HTTP からは呼ばせない前提でホワイトリスト側で除外すること)。
 */
export async function invokeRegisteredHandler(
  channel: string,
  args: unknown[]
): Promise<unknown> {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`no handler: ${channel}`);
  const fakeEvent = { sender: undefined } as unknown as IpcMainInvokeEvent;
  return handler(fakeEvent, ...args);
}
