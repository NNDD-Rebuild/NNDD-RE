import { useCallback, useEffect, useState } from 'react';
import { IpcChannel } from '@shared/types';

/**
 * NGタグ (ライブラリのタグ一覧に出さないタグ) の読み込み・追加・削除。
 * 変更は NG_TAG_CHANGED を受けて再取得し、全ウィンドウで同期する。
 */
export function useNgTags(): {
  ngTags: string[];
  hideTag: (tag: string) => Promise<void>;
  showTag: (tag: string) => Promise<void>;
} {
  const [ngTags, setNgTags] = useState<string[]>([]);

  useEffect(() => {
    const load = (): void => {
      window.nndd
        .invoke<string[]>(IpcChannel.NG_LIST_TAG)
        .then((list) => setNgTags(list ?? []))
        .catch(() => {});
    };
    load();
    return window.nndd.on(IpcChannel.NG_TAG_CHANGED, load);
  }, []);

  const hideTag = useCallback(async (tag: string): Promise<void> => {
    await window.nndd.invoke(IpcChannel.NG_ADD_TAG, tag);
  }, []);

  const showTag = useCallback(async (tag: string): Promise<void> => {
    await window.nndd.invoke(IpcChannel.NG_REMOVE_TAG, tag);
  }, []);

  return { ngTags, hideTag, showTag };
}
