import { useCallback, useEffect, useState } from 'react';
import { IpcChannel, type NgListItem } from '@shared/types';

/**
 * コメントNGリストの読み込み・追加・削除。
 * 他ウィンドウでの変更は NG_COMMENT_CHANGED を受けて再取得し、全ウィンドウで同期する。
 */
export function useNgList(): {
  ngList: NgListItem[];
  loaded: boolean;
  addNg: (item: NgListItem) => Promise<void>;
  removeNg: (item: NgListItem) => Promise<void>;
} {
  const [ngList, setNgList] = useState<NgListItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const load = (): void => {
      window.nndd
        .invoke<NgListItem[]>(IpcChannel.NG_LIST_COMMENT)
        .then((list) => setNgList(list ?? []))
        .catch(() => {})
        .finally(() => setLoaded(true));
    };
    load();
    return window.nndd.on(IpcChannel.NG_COMMENT_CHANGED, load);
  }, []);

  const addNg = useCallback(async (item: NgListItem): Promise<void> => {
    await window.nndd.invoke(IpcChannel.NG_ADD_COMMENT, item);
    setNgList((prev) =>
      prev.some((x) => x.type === item.type && x.value === item.value) ? prev : [...prev, item]
    );
  }, []);

  const removeNg = useCallback(async (item: NgListItem): Promise<void> => {
    await window.nndd.invoke(IpcChannel.NG_REMOVE_COMMENT, item);
    setNgList((prev) => prev.filter((x) => !(x.type === item.type && x.value === item.value)));
  }, []);

  return { ngList, loaded, addNg, removeNg };
}
