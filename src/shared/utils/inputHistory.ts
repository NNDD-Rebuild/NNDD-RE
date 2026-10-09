/** 入力履歴の保持件数 (本家NNDDの検索履歴・マイリスト履歴と同じ) */
export const INPUT_HISTORY_MAX = 10;

export interface MyListHistoryEntry {
  name: string;
  url: string;
}
