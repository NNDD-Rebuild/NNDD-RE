import { useEffect, useRef, useState } from 'react';
import { observeElementRect, useVirtualizer } from '@tanstack/react-virtual';
import type { LiveListItem } from '@shared/types';

export type { LiveListItem };

const ROW_HEIGHT = 22;

function formatVpos(ms: number): string {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

interface Props {
  items: LiveListItem[];
  /** 再生位置までに含まれる件数 (items[currentIndex - 1] が直近に流れたコメント) */
  currentIndex: number;
  /** 行クリックでその時刻へシークする (シークできない放送では undefined) */
  onSeek?: (vposMs: number) => void;
  className?: string;
}

/**
 * 生放送のコメントリスト。
 * 番組開始からの全コメントを時刻順に並べ (仮想スクロール)、再生位置の行へ自動で追従する。
 * 手でスクロールすると追従を止め、「現在位置へ」で再開する。
 */
export function LiveCommentList({ items, currentIndex, onSeek, className }: Props): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
    getItemKey: (i) => items[i]?.key ?? i,
    // 全画面中は display:none になり 0x0 が通知される。反映すると復帰時にスクロール位置が壊れるので無視する
    observeElementRect: (instance, cb) =>
      observeElementRect(instance, (rect) => {
        if (rect.width === 0 || rect.height === 0) return;
        cb(rect);
      })
  });

  // 再生位置 (直近に流れたコメント) が見えるよう追従する
  useEffect(() => {
    if (!follow || currentIndex <= 0) return;
    virtualizer.scrollToIndex(Math.min(currentIndex, items.length) - 1, { align: 'end' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [follow, currentIndex, items.length]);

  /** ユーザー操作によるスクロールでは追従を止める (プログラムからの scrollToIndex とは区別する) */
  const stopFollow = (): void => {
    if (follow) setFollow(false);
  };

  return (
    <div className={`relative flex flex-col min-h-0 ${className ?? ''}`}>
      <div
        ref={scrollRef}
        onWheel={stopFollow}
        onTouchMove={stopFollow}
        onKeyDown={stopFollow}
        onMouseDown={(e) => {
          // スクロールバーのドラッグ (リスト要素の外側 = スクロールバー領域) も手動スクロール扱い
          if (e.target === scrollRef.current) stopFollow();
        }}
        tabIndex={0}
        className="flex-1 min-h-0 overflow-y-auto text-xs select-text outline-none"
      >
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
          {virtualizer.getVirtualItems().map((v) => {
            const item = items[v.index];
            if (!item) return null;
            const future = v.index >= currentIndex;
            const style: React.CSSProperties = {
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: ROW_HEIGHT,
              transform: `translateY(${v.start}px)`
            };
            const time = (
              <span className="shrink-0 w-14 text-right text-neutral-500 tabular-nums">
                {formatVpos(item.vposMs)}
              </span>
            );
            if (item.notice) {
              return (
                <div
                  key={item.key}
                  style={style}
                  className="flex items-center gap-2 px-2 border-b border-neutral-900 bg-neutral-900 text-amber-300"
                  title={item.notice.text}
                >
                  {time}
                  <span className="truncate">{item.notice.text}</span>
                </div>
              );
            }
            const c = item.comment!;
            return (
              <div
                key={item.key}
                style={style}
                onDoubleClick={onSeek ? () => onSeek(item.vposMs) : undefined}
                className={[
                  'flex items-center gap-2 px-2 border-b border-neutral-900',
                  onSeek ? 'cursor-pointer hover:bg-neutral-800' : '',
                  !c.isShow ? 'text-neutral-600' : future ? 'text-neutral-500' : ''
                ].join(' ')}
                title={onSeek ? `${c.text}\n(ダブルクリックでこの位置へ)` : c.text}
              >
                {time}
                <span className="shrink-0 w-12 text-right text-neutral-500 tabular-nums">{c.no || ''}</span>
                <span className="truncate">{c.text}</span>
              </div>
            );
          })}
        </div>
      </div>
      {!follow && (
        <button
          onClick={() => setFollow(true)}
          className="absolute bottom-2 right-3 px-2 py-1 rounded text-xs bg-neutral-700 hover:bg-neutral-600 shadow"
        >
          現在位置へ
        </button>
      )}
    </div>
  );
}
