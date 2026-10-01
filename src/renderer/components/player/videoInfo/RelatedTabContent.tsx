import { useState, useEffect, useRef } from 'react';
import type { MyListItem } from '@shared/types';
import { IpcChannel } from '@shared/types';
import { LazyThumbnail } from './LazyThumbnail';

/** 関連動画タブ: 関連動画一覧と連続再生トグル */
export function RelatedTabContent({
  videoId,
  autoNext = false,
  onAutoNextChange,
  onLoaded
}: {
  videoId: string;
  autoNext?: boolean;
  onAutoNextChange?: (v: boolean) => void;
  onLoaded?: (items: MyListItem[]) => void;
}): JSX.Element {
  const [items, setItems] = useState<MyListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 取得中に次の動画へ切り替わった場合、前の動画の関連動画で一覧と連続再生の候補 (onLoaded) を上書きしない。
  // タブを閉じても最新動画の結果は onLoaded へ届けるため、アンマウントでは無効化しない
  const seqRef = useRef(0);

  useEffect(() => {
    const seq = ++seqRef.current;
    setLoading(true);
    setError(null);
    window.nndd
      .invoke<MyListItem[]>(IpcChannel.VIDEO_GET_RELATED, videoId)
      .then((r) => {
        if (seq !== seqRef.current) return;
        setItems(r);
        onLoaded?.(r);
      })
      .catch((e: unknown) => {
        if (seq === seqRef.current) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (seq === seqRef.current) setLoading(false);
      });
  // videoId が変わるたびに再取得。onLoaded は親のコールバック(再生成される可能性あり)なので依存に含めない
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 px-3 py-2 border-b border-nndd-border">
        <label className="flex items-center gap-1 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={autoNext}
            onChange={(e) => onAutoNextChange?.(e.target.checked)}
            className="accent-nndd-accent"
          />
          <span className="text-xs text-nndd-subtext">連続再生</span>
        </label>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading && (
          <div className="p-3 text-xs text-nndd-subtext">読込中…</div>
        )}
        {error && (
          <div className="p-3 text-xs text-red-500 dark:text-red-400">{error}</div>
        )}
        {!loading && !error && items.length === 0 && (
          <div className="p-3 text-xs text-nndd-subtext">関連動画がありません</div>
        )}
        {items.map((item) => (
          <div key={item.videoId} className="flex items-center gap-2 px-2 py-1.5">
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
                <div className="text-xs text-nndd-subtext mt-0.5">
                  {item.length} ・ 再生 {item.viewCount.toLocaleString()}
                </div>
              </div>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
