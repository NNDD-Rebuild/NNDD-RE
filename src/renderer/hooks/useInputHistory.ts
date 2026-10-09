import { useCallback, useEffect, useState } from 'react';
import { IpcChannel, type IpcChannelValue } from '@shared/types';
import type { MyListHistoryEntry } from '@shared/utils/inputHistory';

/**
 * 入力欄の履歴 (直近10件、DB保存) の取得と追加。
 * 保存のON/OFF判定は main 側で行うので、OFFの間は候補が空のまま追加も無視される。
 */
function useInputHistory<T>(
  listChannel: IpcChannelValue,
  addChannel: IpcChannelValue
): { history: T[]; addHistory: (item: T) => Promise<void> } {
  const [history, setHistory] = useState<T[]>([]);

  const load = useCallback(async (): Promise<void> => {
    try {
      const list = await window.nndd.invoke<T[]>(listChannel);
      setHistory(Array.isArray(list) ? list : []);
    } catch {
      // 履歴は補助機能なので読めなくても何もしない
    }
  }, [listChannel]);

  useEffect(() => { void load(); }, [load]);

  const addHistory = useCallback(async (item: T): Promise<void> => {
    try {
      await window.nndd.invoke(addChannel, item);
      await load();
    } catch {
      // 履歴の保存失敗で本来の操作は止めない
    }
  }, [addChannel, load]);

  return { history, addHistory };
}

/** 検索タブの検索ワード履歴 */
export function useSearchHistory(): { history: string[]; addHistory: (word: string) => Promise<void> } {
  return useInputHistory<string>(IpcChannel.INPUT_HISTORY_SEARCH_LIST, IpcChannel.INPUT_HISTORY_SEARCH_ADD);
}

/** マイリストタブのURL入力欄の履歴 */
export function useMyListHistory(): {
  history: MyListHistoryEntry[];
  addHistory: (entry: MyListHistoryEntry) => Promise<void>;
} {
  return useInputHistory<MyListHistoryEntry>(
    IpcChannel.INPUT_HISTORY_MYLIST_LIST,
    IpcChannel.INPUT_HISTORY_MYLIST_ADD
  );
}
