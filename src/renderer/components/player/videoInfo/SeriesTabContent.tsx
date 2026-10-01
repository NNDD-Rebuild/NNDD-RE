import { useState, useEffect, useRef } from 'react';
import type { MyListItem } from '@shared/types';
import { IpcChannel } from '@shared/types';
import { seriesUrl } from '@shared/utils/nicoUrl';
import { LazyThumbnail } from './LazyThumbnail';

/** シリーズタブ: シリーズ内の動画一覧 (ページ送り・後でみる追加・連続再生トグル) */
export function SeriesTabContent({
  seriesId,
  seriesTitle,
  currentVideoId,
  autoNext = false,
  onAutoNextChange,
  onPageLoaded
}: {
  seriesId: string;
  seriesTitle: string;
  currentVideoId: string;
  autoNext?: boolean;
  onAutoNextChange?: (v: boolean) => void;
  onPageLoaded?: (items: MyListItem[], page: number, totalPages: number, seriesId: string) => void;
}): JSX.Element {
  const [items, setItems] = useState<MyListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (msg: string): void => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMsg(msg);
    toastTimerRef.current = setTimeout(() => setToastMsg(null), 2500);
  };

  const fetchSeriesPage = (targetPage?: number): void => {
    setLoading(true);
    setError(null);
    window.nndd
      .invoke<{ name: string; items: MyListItem[]; page: number; totalPages: number }>(
        IpcChannel.SERIES_FETCH, seriesId, targetPage ? undefined : currentVideoId, targetPage
      )
      .then((r) => {
        setItems(r.items);
        setPage(r.page);
        setTotalPages(r.totalPages);
        onPageLoaded?.(r.items, r.page, r.totalPages, seriesId);
        if (targetPage) listRef.current?.scrollTo(0, 0);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchSeriesPage();
    return () => { if (toastTimerRef.current) clearTimeout(toastTimerRef.current); };
  }, [seriesId]);

  useEffect(() => {
    if (!loading && items.length > 0 && activeRef.current) {
      activeRef.current.scrollIntoView({ block: 'nearest' });
    }
  }, [loading, items, currentVideoId]);

  const handleAddWatchLater = (videoId: string): void => {
    setAddingId(videoId);
    window.nndd
      .invoke(IpcChannel.MYLIST_ADD_VIDEO_DEFLIST, videoId)
      .then(() => {
        setAddedIds((prev) => new Set(prev).add(videoId));
        showToast('後でみるに追加しました');
      })
      .catch(() => showToast('追加に失敗しました'))
      .finally(() => setAddingId(null));
  };

  const handleAddToMylist = (): void => {
    window.nndd
      .invoke(IpcChannel.MYLIST_ADD, {
        myListUrl: seriesUrl(seriesId),
        myListName: seriesTitle,
        isDir: false,
        unPlayVideoCount: 0,
        type: 'series',
        myListVideoIds: {}
      })
      .then(() => showToast('マイリストに追加しました'))
      .catch(() => showToast('追加に失敗しました'));
  };

  return (
    <div className="flex flex-col h-full min-h-0 relative">
      {toastMsg && (
        <div className="absolute bottom-2 left-2 right-2 z-10 px-3 py-1.5 rounded bg-nndd-accent text-white text-xs text-center shadow pointer-events-none">
          {toastMsg}
        </div>
      )}
      <div className="shrink-0 px-3 pt-2 pb-1 text-xs font-bold text-nndd-text truncate">
        {seriesTitle}
      </div>
      <div className="shrink-0 px-3 pb-2 border-b border-nndd-border flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoNext}
              onChange={(e) => onAutoNextChange?.(e.target.checked)}
              className="accent-nndd-accent"
            />
            <span className="text-xs text-nndd-subtext">連続再生</span>
          </label>
          <button
            onClick={handleAddToMylist}
            className="text-xs text-nndd-subtext hover:text-nndd-text px-1.5 py-0.5 rounded border border-nndd-border hover:bg-nndd-border/50 transition-colors"
          >
            ★ マイリストに追加
          </button>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center gap-1 ml-auto">
            <button
              onClick={() => fetchSeriesPage(page - 1)}
              disabled={loading || page <= 1}
              className="px-2 py-0.5 bg-nndd-border rounded hover:bg-nndd-accent disabled:opacity-40"
            >◀ 前</button>
            <span className="text-nndd-subtext px-2">{page} / {totalPages}</span>
            <button
              onClick={() => fetchSeriesPage(page + 1)}
              disabled={loading || page >= totalPages}
              className="px-2 py-0.5 bg-nndd-border rounded hover:bg-nndd-accent disabled:opacity-40"
            >次 ▶</button>
          </div>
        )}
      </div>
      <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto">
        {loading && (
          <div className="p-3 text-xs text-nndd-subtext">読込中…</div>
        )}
        {error && (
          <div className="p-3 text-xs text-red-500 dark:text-red-400">{error}</div>
        )}
        {items.map((item) => (
          <div
            ref={item.videoId === currentVideoId ? activeRef : undefined}
            key={item.videoId}
            className={[
              'flex items-center gap-2 px-2 py-1.5',
              item.videoId === currentVideoId ? 'bg-nndd-accent/20' : ''
            ].join(' ')}
          >
            <button
              onClick={() =>
                window.nndd.invoke(IpcChannel.VIDEO_OPEN_PLAYER, { videoId: item.videoId })
              }
              className="flex gap-2 flex-1 min-w-0 text-left hover:bg-nndd-border/50 rounded transition-colors"
            >
              {item.thumbnailUrl && (
                <LazyThumbnail url={item.thumbnailUrl} />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-xs text-nndd-text leading-tight line-clamp-2">
                  {item.title}
                </div>
                <div className="text-xs text-nndd-subtext mt-0.5">{item.length}</div>
              </div>
            </button>
            <button
              onClick={() => handleAddWatchLater(item.videoId)}
              disabled={addingId === item.videoId || addedIds.has(item.videoId)}
              title="後でみるに追加"
              className="shrink-0 w-6 h-6 flex items-center justify-center rounded hover:bg-nndd-border/70 text-nndd-subtext hover:text-nndd-text transition-colors disabled:opacity-40"
            >
              {addedIds.has(item.videoId) ? '✓' : '+'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
