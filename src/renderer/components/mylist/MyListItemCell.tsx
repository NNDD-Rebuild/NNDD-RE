import type { DownloadKind } from '@shared/types/download';
import { VideoCard, type VideoCardData } from '../common/VideoCard';

/**
 * 右ペイン一覧の 1 アイテム (グリッド / リスト両対応)。
 * クリックで選択 (Shift/Ctrl は親の onItemClick が処理)。
 * プレイリスト表示中のみ ▲▼ 並び替えボタンを出す。
 */
export function MyListItemCell({
  item: it,
  index: idx,
  itemCount,
  displayMode,
  isSelected,
  isPlaylist,
  isDownloaded,
  isWatched,
  onItemClick,
  onMove,
  onPlay,
  onDownload,
  onNiconico,
  onPlayAudioOnly,
  onRemove
}: {
  item: VideoCardData;
  /** 絞り込み前の items 内での位置 (見つからなければ -1)。並び替えボタン用 */
  index: number;
  itemCount: number;
  displayMode: 'grid' | 'list';
  isSelected: boolean;
  isPlaylist: boolean;
  isDownloaded: boolean;
  isWatched: boolean;
  onItemClick: (videoId: string, e: React.MouseEvent) => void;
  onMove: (index: number, dir: -1 | 1) => void;
  onPlay: (videoId: string) => void;
  onDownload: (videoId: string, kind?: DownloadKind) => void;
  onNiconico: (videoId: string) => void;
  onPlayAudioOnly: (videoId: string) => void;
  onRemove: ((videoId: string) => void) | undefined;
}): JSX.Element {
  if (displayMode === 'grid') {
    return (
      <div
        onClick={(e) => onItemClick(it.videoId, e)}
        className={[
          'relative rounded cursor-pointer',
          isSelected ? 'ring-2 ring-nndd-accent' : ''
        ].join(' ')}
      >
        <VideoCard
          data={it}
          onPlay={onPlay}
          onDownload={onDownload}
          onNiconico={onNiconico}
          onPlayAudioOnly={onPlayAudioOnly}
          isDownloaded={isDownloaded}
          isWatched={isWatched}
          onRemove={onRemove}
        />
        {isPlaylist && (
          <div className="absolute left-1 top-1 flex flex-col gap-0.5 z-10">
            <button
              onClick={(e) => { e.stopPropagation(); onMove(idx, -1); }}
              disabled={idx <= 0}
              className="w-5 h-5 text-xs bg-black/60 text-white rounded disabled:opacity-30"
              title="上へ"
            >▲</button>
            <button
              onClick={(e) => { e.stopPropagation(); onMove(idx, 1); }}
              disabled={idx === itemCount - 1}
              className="w-5 h-5 text-xs bg-black/60 text-white rounded disabled:opacity-30"
              title="下へ"
            >▼</button>
          </div>
        )}
      </div>
    );
  }
  return (
    <div
      className={[
        'flex items-center gap-1 rounded',
        isSelected ? 'ring-2 ring-nndd-accent' : ''
      ].join(' ')}
    >
      {isPlaylist && (
        <div className="flex flex-col gap-0.5 shrink-0">
          <button
            onClick={() => onMove(idx, -1)}
            disabled={idx <= 0}
            className="w-5 h-4 text-xs bg-nndd-border rounded disabled:opacity-30"
            title="上へ"
          >▲</button>
          <button
            onClick={() => onMove(idx, 1)}
            disabled={idx === itemCount - 1}
            className="w-5 h-4 text-xs bg-nndd-border rounded disabled:opacity-30"
            title="下へ"
          >▼</button>
        </div>
      )}
      <div
        className="flex-1 min-w-0 cursor-pointer"
        onClick={(e) => onItemClick(it.videoId, e)}
      >
        <VideoCard
          data={it}
          layout="list"
          onPlay={onPlay}
          onDownload={onDownload}
          onNiconico={onNiconico}
          onPlayAudioOnly={onPlayAudioOnly}
          isDownloaded={isDownloaded}
          isWatched={isWatched}
          onRemove={onRemove}
        />
      </div>
    </div>
  );
}
