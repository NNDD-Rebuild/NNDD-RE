import { useCallback, useEffect, useState } from 'react';
import { IpcChannel } from '@shared/types';
import {
  isSameMyListEntry,
  isSameSearchWord,
  pushHistory,
  type MyListHistoryEntry
} from '@shared/utils/inputHistory';

/**
 * 入力欄の履歴 (直近10件) を config に保存・読み込みする。
 * enabledKey が false の間は追加せず、候補も出さない。
 */
function useInputHistory<T>(
  listKey: string,
  enabledKey: string,
  isSame: (a: T, b: T) => boolean
): { history: T[]; addHistory: (item: T) => Promise<void> } {
  const [history, setHistory] = useState<T[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const enabled = await window.nndd.invoke<boolean>(IpcChannel.CONFIG_GET, enabledKey);
        const list = await window.nndd.invoke<T[]>(IpcChannel.CONFIG_GET, listKey);
        if (!cancelled) setHistory(enabled && Array.isArray(list) ? list : []);
      } catch {
        // 履歴は補助機能なので読めなくても何もしない
      }
    })();
    return () => { cancelled = true; };
  }, [listKey, enabledKey]);

  const addHistory = useCallback(async (item: T): Promise<void> => {
    try {
      const enabled = await window.nndd.invoke<boolean>(IpcChannel.CONFIG_GET, enabledKey);
      if (!enabled) return;
      const list = await window.nndd.invoke<T[]>(IpcChannel.CONFIG_GET, listKey);
      const next = pushHistory(Array.isArray(list) ? list : [], item, isSame);
      await window.nndd.invoke(IpcChannel.CONFIG_SET, listKey, next);
      setHistory(next);
    } catch {
      // 履歴の保存失敗で本来の操作は止めない
    }
  }, [listKey, enabledKey, isSame]);

  return { history, addHistory };
}

/** 検索タブの検索ワード履歴 */
export function useSearchHistory(): { history: string[]; addHistory: (word: string) => Promise<void> } {
  return useInputHistory<string>('searchHistory', 'saveSearchHistory', isSameSearchWord);
}

/** マイリストタブのURL入力欄の履歴 */
export function useMyListHistory(): {
  history: MyListHistoryEntry[];
  addHistory: (entry: MyListHistoryEntry) => Promise<void>;
} {
  return useInputHistory<MyListHistoryEntry>('myListHistory', 'saveMyListHistory', isSameMyListEntry);
}
