import type { NNDDREVideo } from '@shared/types';
import {
  extractVideoId,
  formatDuration,
  isAudioOnlyVideo,
  thumbFallbackUrl,
  thumbPrimaryUrl,
  type LibraryItemHandlers
} from './libraryUtils';

/** ローカルライブラリのグリッド表示 */
export function LibraryGridView({
  videos,
  selected,
  selectedVideoIds,
  onClick,
  onPlay,
  onDragStart,
  onContextMenu,
  onToggleFavorite,
  onOpenFolder,
  onOpenNiconico,
  onDelete
}: {
  videos: NNDDREVideo[];
  selected: number | null;
  selectedVideoIds: Set<number>;
} & LibraryItemHandlers): JSX.Element {
  return (
    <div className="p-3 grid grid-cols-6 gap-3">
      {videos.map((v) => (
        <div
          key={v.id}
          draggable
          className={[
            'flex flex-col cursor-pointer rounded overflow-hidden border',
            selectedVideoIds.has(v.id)
              ? 'border-nndd-accent ring-2 ring-nndd-accent'
              : selected === v.id
              ? 'border-nndd-accent'
              : 'border-nndd-border hover:border-nndd-accent'
          ].join(' ')}
          onClick={(e) => onClick(v, e)}
          onDoubleClick={onPlay && (() => onPlay(v))}
          onDragStart={(e) => onDragStart(e, v)}
          onContextMenu={(e) => onContextMenu(e, v)}
        >
          <div className="relative bg-black aspect-video overflow-hidden w-full">
            <img
              src={thumbPrimaryUrl(v)}
              alt=""
              className="absolute inset-0 w-full h-full object-cover"
              onError={(e) => {
                const fb = thumbFallbackUrl(v);
                if (e.currentTarget.src !== fb) e.currentTarget.src = fb;
                else e.currentTarget.style.display = 'none';
              }}
            />
            {v.time > 0 && (
              <span className="absolute bottom-1 right-1 bg-black/70 text-white text-[10px] px-1 rounded">
                {formatDuration(v.time)}
              </span>
            )}
            {isAudioOnlyVideo(v) && (
              <span className="absolute left-1 top-1 bg-purple-600 text-white text-[10px] px-1 rounded" title="音声のみ">
                ♪ 音声のみ
              </span>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); void onToggleFavorite(v); }}
              title={v.isFavorite ? 'お気に入りから外す' : 'お気に入りに追加'}
              className={[
                'absolute right-1 top-1 text-base leading-none drop-shadow',
                v.isFavorite ? 'text-yellow-400' : 'text-white/70 hover:text-yellow-400'
              ].join(' ')}
            >
              {v.isFavorite ? '★' : '☆'}
            </button>
          </div>
          <div className="p-1.5 bg-nndd-panel flex-1 flex flex-col gap-0.5">
            <div
              className={`text-xs line-clamp-2 leading-tight${onPlay ? ' cursor-pointer hover:underline' : ''}`}
              title={v.videoName}
              onClick={onPlay && ((e) => { e.stopPropagation(); onPlay(v); })}
            >
              {v.videoName}
            </div>
            <div className="text-[10px] text-nndd-subtext mt-auto">
              {v.pubDate ? v.pubDate.toLocaleDateString('ja-JP') : '-'}
            </div>
            <div className="flex gap-1 mt-1 flex-wrap">
              {onPlay && (
                <button onClick={(e) => { e.stopPropagation(); onPlay(v); }} className="text-xs px-2 py-0.5 bg-nndd-accent text-white rounded">再生</button>
              )}
              <button onClick={(e) => { e.stopPropagation(); onOpenFolder(v); }} className="text-xs px-2 py-0.5 bg-nndd-border rounded">フォルダ</button>
              {extractVideoId(v.videoName) && (
                <button onClick={(e) => { e.stopPropagation(); onOpenNiconico(v); }} className="text-xs px-2 py-0.5 bg-nndd-border rounded" title="ニコニコ動画で開く">nico</button>
              )}
              <button onClick={(e) => { e.stopPropagation(); void onDelete(v); }} className="text-xs px-2 py-0.5 bg-nndd-border hover:bg-red-700 hover:text-white rounded">削除</button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
