import { ipcMain, type IpcMainInvokeEvent } from 'electron';

/**
 * ipcMain.handle に登録されたハンドラを記録し、HTTP (ブラウザ版プレイヤー) からも
 * 同じ実装を呼べるようにするレジストリ。
 *
 * registerIpcHandlers の先頭で installIpcRegistry() を呼ぶこと (それ以前に登録された
 * ハンドラは記録されない)。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (event: IpcMainInvokeEvent, ...args: any[]) => unknown;

const handlers = new Map<string, Handler>();
let installed = false;

export function installIpcRegistry(): void {
  if (installed) return;
  installed = true;

  const origHandle = ipcMain.handle.bind(ipcMain);
  const origRemove = ipcMain.removeHandler.bind(ipcMain);

  ipcMain.handle = ((channel: string, listener: Handler) => {
    handlers.set(channel, listener);
    return origHandle(channel, listener);
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
