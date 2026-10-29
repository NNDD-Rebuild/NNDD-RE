import { NNDDRESearchSortType, NNDDRESearchType } from '@shared/types';
import type { NNDDRESearchSortTypeValue, NNDDRESearchTypeValue } from '@shared/types';

export const SEARCH_TYPE_OPTIONS: { value: NNDDRESearchTypeValue; label: string }[] = [
  { value: NNDDRESearchType.KEYWORD, label: 'キーワード' },
  { value: NNDDRESearchType.TAG, label: 'タグ完全一致' }
];

export const SEARCH_SORT_OPTIONS: { value: NNDDRESearchSortTypeValue; label: string }[] = [
  { value: NNDDRESearchSortType.VIEW_COUNT_DESC, label: '再生数 多い順' },
  { value: NNDDRESearchSortType.COMMENT_COUNT_DESC, label: 'コメ多い順' },
  { value: NNDDRESearchSortType.MYLIST_COUNT_DESC, label: 'マイリス多い順' },
  { value: NNDDRESearchSortType.LIKE_COUNT_DESC, label: 'いいね多い順' },
  { value: NNDDRESearchSortType.REGISTERED_AT_DESC, label: '新着順' },
  { value: NNDDRESearchSortType.REGISTERED_AT_ASC, label: '古い順' },
  { value: NNDDRESearchSortType.LAST_COMMENT_DESC, label: 'コメント新しい順' },
  { value: NNDDRESearchSortType.LAST_COMMENT_ASC, label: 'コメント古い順' },
  { value: NNDDRESearchSortType.LENGTH_ASC, label: '長さ短い順' },
  { value: NNDDRESearchSortType.LENGTH_DESC, label: '長さ長い順' }
];
