import type { NNDDREVideo } from '@shared/types';
import {
  extractVideoId,
  formatDuration,
  isAudioOnlyVideo,
  thumbFallbackUrl,
  thumbPrimaryUrl,
  type LibraryItemHandlers,
  type SortCol
} from './libraryUtils';

/** ローカルライブラリのテーブル (リスト) 表示。見出しクリックで並び替え */
export function LibraryTableView({
  videos,
  selected,
  selectedVideoIds,
  onSort,
  sortIndicator,
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
  onSort: (col: SortCol) => void;
  sortIndicator: (col: SortCol) => string;
} & LibraryItemHandlers): JSX.Element {
  return (
    <table className="nndd-datagrid">
      <thead>
        <tr>
          <th className="w-6"></th>
          <th className="w-10"></th>
          <th className="cursor-pointer select-none hover:opacity-70" onClick={() => onSort('videoName')}>タイトル{sortIndicator('videoName')}</th>
          <th className="w-24 cursor-pointer select-none hover:opacity-70" onClick={() => onSort('time')}>時間{sortIndicator('time')}</th>
          <th className="w-20 cursor-pointer select-none hover:opacity-70" onClick={() => onSort('playCount')}>再生数{sortIndicator('playCount')}</th>
          <th className="w-32 cursor-pointer select-none hover:opacity-70" onClick={() => onSort('pubDate')}>投稿日{sortIndicator('pubDate')}</th>
          <th className="w-52">操作</th>
        </tr>
      </thead>
      <tbody>
        {videos.map((v) => (
          <tr
            key={v.id}
            draggable
            className={[
              selectedVideoIds.has(v.id) ? 'selected ring-1 ring-nndd-accent' : selected === v.id ? 'selected' : ''
            ].join(' ')}
            onClick={(e) => onClick(v, e)}
            onDoubleClick={() => onPlay(v)}
            onDragStart={(e) => onDragStart(e, v)}
            onContextMenu={(e) => onContextMenu(e, v)}
          >
            <td className="p-0.5 text-center">
              <button
                onClick={(e) => { e.stopPropagation(); void onToggleFavorite(v); }}
                title={v.isFavorite ? 'お気に入りから外す' : 'お気に入りに追加'}
                className={v.isFavorite ? 'text-yellow-400' : 'text-nndd-subtext hover:text-yellow-400'}
              >
                {v.isFavorite ? '★' : '☆'}
              </button>
            </td>
            <td className="p-0.5">
              <img
                src={thumbPrimaryUrl(v)}
                alt=""
                className="w-9 aspect-video object-cover rounded-sm"
                onError={(e) => {
                  const fb = thumbFallbackUrl(v);
                  if (e.currentTarget.src !== fb) e.currentTarget.src = fb;
                  else e.currentTarget.style.display = 'none';
                }}
              />
            </td>
            <td
              title={v.videoName}
              className="cursor-pointer hover:underline"
              onClick={(e) => { e.stopPropagation(); onPlay(v); }}
            >
              {v.videoName}
              {isAudioOnlyVideo(v) && (
                <span className="ml-1.5 text-[10px] px-1 py-0.5 rounded bg-purple-600 text-white" title="音声のみ">
                  ♪ 音声のみ
                </span>
              )}
            </td>
            <td>{formatDuration(v.time)}</td>
            <td>{v.playCount}</td>
            <td>{v.pubDate ? v.pubDate.toLocaleDateString('ja-JP') : '-'}</td>
            <td className="whitespace-nowrap">
              <button onClick={(e) => { e.stopPropagation(); onPlay(v); }} className="text-xs px-2 py-0.5 bg-nndd-accent text-white rounded mr-1">再生</button>
              <button onClick={(e) => { e.stopPropagation(); onOpenFolder(v); }} className="text-xs px-2 py-0.5 bg-nndd-border rounded mr-1">フォルダ</button>
              {extractVideoId(v.videoName) && (
                <button onClick={(e) => { e.stopPropagation(); onOpenNiconico(v); }} className="text-xs px-2 py-0.5 bg-nndd-border rounded mr-1" title="ニコニコ動画で開く">nico</button>
              )}
              <button onClick={(e) => { e.stopPropagation(); void onDelete(v); }} className="text-xs px-2 py-0.5 bg-nndd-border hover:bg-red-700 hover:text-white rounded">削除</button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
