import { IpcChannel } from '@shared/types';
import type { VideoCardData } from '../common/VideoCard';
import { ContinuousPlayButton } from '../common/ContinuousPlayButton';

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
  totalItems
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
      {loadingAll && (
        <span className="text-nndd-subtext animate-pulse">
          全件読込中… ({loadedCount.toLocaleString()}/{totalItems.toLocaleString()}件)
        </span>
      )}
      <span className="text-nndd-subtext">{filteredItems.length} 件</span>
    </div>
  );
}
