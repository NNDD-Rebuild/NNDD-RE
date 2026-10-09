/** 入力履歴の保持件数 (本家NNDDの検索履歴・マイリスト履歴と同じ) */
export const INPUT_HISTORY_MAX = 10;

/** 履歴の先頭に item を足す。同じ項目は先頭に繰り上げ、max 件を超えた分は捨てる */
export function pushHistory<T>(
  list: readonly T[],
  item: T,
  isSame: (a: T, b: T) => boolean,
  max: number = INPUT_HISTORY_MAX
): T[] {
  return [item, ...list.filter((x) => !isSame(x, item))].slice(0, max);
}

/** 履歴に入れる検索ワードの同一判定 */
export const isSameSearchWord = (a: string, b: string): boolean => a === b;

export interface MyListHistoryEntry {
  name: string;
  url: string;
}

/** 履歴に入れるマイリストの同一判定 (URL が同じなら同じ) */
export const isSameMyListEntry = (a: MyListHistoryEntry, b: MyListHistoryEntry): boolean => a.url === b.url;
