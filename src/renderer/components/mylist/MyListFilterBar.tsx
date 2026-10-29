import { IpcChannel } from '@shared/types';
import type { VideoCardData } from '../common/VideoCard';
import { ContinuousPlayButton } from '../common/ContinuousPlayButton';
import { MYLIST_SORT_OPTIONS, type MylistSort, type MylistSortKey } from './mylistUtils';

/** 一覧上部のバー: 連続再生 / タイトル絞り込み / 全件読込の進捗 / 件数 */
export function MyListFilterBar({
  loading,
  filteredItems,
  selectedIds,
  searchText,
  onSearchTextChange,
  onSearchConfirm,
  loadingAll,
  loadedCount,
  totalItems,
  sort,
  onSortChange
}: {
  loading: boolean;
  filteredItems: VideoCardData[];
  selectedIds: Set<string>;
  searchText: string;
  onSearchTextChange: (value: string) => void;
  onSearchConfirm: () => void;
  loadingAll: boolean;
  loadedCount: number;
  totalItems: number;
  /** 指定時のみ並び順の選択を出す (マイリスト用。プレイリストは手動の並びなので出さない) */
  sort?: MylistSort;
  onSortChange?: (sort: MylistSort) => void;
}): JSX.Element {
  return (
    <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-nndd-border bg-nndd-panel text-xs">
      <ContinuousPlayButton
        disabled={loading || filteredItems.length === 0}
        onPlay={(audioOnly) => {
          if (filteredItems.length === 0) return;
          const videoIds = filteredItems.map((it) => it.videoId);
          const startIdx = selectedIds.size > 0
            ? filteredItems.findIndex((it) => selectedIds.has(it.videoId))
            : 0;
          window.nndd.invoke(IpcChannel.VIDEO_OPEN_PLAYER, {
            videoId: videoIds[startIdx >= 0 ? startIdx : 0],
            searchPlaylist: videoIds,
            audioOnly: audioOnly || undefined,
          });
        }}
      />
      <input
        value={searchText}
        onChange={(e) => onSearchTextChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') onSearchConfirm(); }}
        placeholder="タイトルで絞り込み"
        className="bg-nndd-bg border border-nndd-border px-2 py-1 text-xs"
      />
      {sort && onSortChange && (
        <>
          <select
            value={sort.key}
            onChange={(e) => onSortChange({ ...sort, key: e.target.value as MylistSortKey })}
            title="並び順 (マイリストごとに記憶します)"
            className="bg-nndd-bg border border-nndd-border px-1 py-1 text-xs"
          >
            {MYLIST_SORT_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>{o.label}</option>
            ))}
          </select>
          <button
            onClick={() => onSortChange({ ...sort, desc: !sort.desc })}
            title={sort.desc ? '降順 (クリックで昇順)' : '昇順 (クリックで降順)'}
            className="px-2 py-1 bg-nndd-border rounded hover:bg-nndd-accent hover:text-white"
          >
            {sort.desc ? '▼' : '▲'}
          </button>
        </>
      )}
      {loadingAll && (
        <span className="text-nndd-subtext animate-pulse">
          全件読込中… ({loadedCount.toLocaleString()}/{totalItems.toLocaleString()}件)
        </span>
      )}
      <span className="text-nndd-subtext">{filteredItems.length} 件</span>
    </div>
  );
}
