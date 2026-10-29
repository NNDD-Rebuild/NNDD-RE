import { useCallback, useEffect, useState } from 'react';
import { IpcChannel } from '@shared/types';

const KEY = 'player.permitOnly';
const LOCAL_EVENT = 'nndd:permitOnly';

/**
 * 「許可IDのみ表示」の状態。コメント一覧のチェックと、動画上に流すコメントの描画 (別のフック) で
 * 同じ値を即座に共有するため、useConfig ではなくこのフックを使う。
 * 同じウィンドウ内は LOCAL_EVENT、別ウィンドウは NG_COMMENT_CHANGED (設定変更時にメイン側が通知) で同期する。
 */
export function usePermitOnly(): [boolean, (next: boolean) => void] {
  const [permitOnly, setValue] = useState(false);

  useEffect(() => {
    const load = (): void => {
      window.nndd
        .invoke<boolean>(IpcChannel.CONFIG_GET, KEY)
        .then((v) => setValue(v === true))
        .catch(() => {});
    };
    const onLocal = (e: Event): void => setValue((e as CustomEvent<boolean>).detail === true);
    load();
    window.addEventListener(LOCAL_EVENT, onLocal);
    const off = window.nndd.on(IpcChannel.NG_COMMENT_CHANGED, load);
    return () => {
      window.removeEventListener(LOCAL_EVENT, onLocal);
      off();
    };
  }, []);

  const set = useCallback((next: boolean): void => {
    setValue(next);
    window.dispatchEvent(new CustomEvent(LOCAL_EVENT, { detail: next }));
    void window.nndd.invoke(IpcChannel.CONFIG_SET, KEY, next).catch(() => {});
  }, []);

  return [permitOnly, set];
}
