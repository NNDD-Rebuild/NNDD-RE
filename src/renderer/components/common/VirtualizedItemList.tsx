import React, { useEffect, useRef, useState } from 'react';
import { measureElement, observeElementRect, useVirtualizer } from '@tanstack/react-virtual';

/**
 * Ranking/Search/Follow/MyList 共通の仮想化リスト。
 * grid: `grid-cols-[repeat(auto-fill,minmax(260px,1fr))]` 相当をJSで再現 (列数をコンテナ幅から算出)。
 * list: 縦1列。
 * 行の高さは初期値を概算し、実測 (measureElement) で自動補正する。
 */

const GRID_MIN_CARD_WIDTH = 260;
const GRID_GAP = 12; // gap-3
const GRID_TEXT_BLOCK_HEIGHT = 100; // サムネ下 (padding + title2行 + stats + actions) の概算
const LIST_ROW_HEIGHT = 96; // サムネ w-32 (72px) + padding 概算
const LIST_GAP = 4; // gap-1

interface VirtualizedItemListProps<T> {
  items: T[];
  layout: 'grid' | 'list';
  getKey: (item: T) => string;
  renderItem: (item: T) => React.ReactNode;
  /** 既存のスクロールコンテナ (overflow-auto) の ref をそのまま渡す */
  scrollElementRef: React.RefObject<HTMLDivElement>;
}

export function VirtualizedItemList<T>({
  items,
  layout,
  getKey,
  renderItem,
  scrollElementRef
}: VirtualizedItemListProps<T>): JSX.Element | null {
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const el = scrollElementRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setContainerWidth(w);
    });
    ro.observe(el);
    setContainerWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [scrollElementRef]);

  const gap = layout === 'grid' ? GRID_GAP : LIST_GAP;
  const columnCount = layout === 'grid'
    ? Math.max(1, Math.floor((containerWidth + gap) / (GRID_MIN_CARD_WIDTH + gap)))
    : 1;

  const cardWidth = layout === 'grid' && columnCount > 0 && containerWidth > 0
    ? (containerWidth - gap * (columnCount - 1)) / columnCount
    : GRID_MIN_CARD_WIDTH;
  const estimatedRowHeight = layout === 'grid'
    ? Math.round((cardWidth * 9) / 16) + GRID_TEXT_BLOCK_HEIGHT + gap
    : LIST_ROW_HEIGHT + gap;

  const rowCount = Math.ceil(items.length / columnCount);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollElementRef.current,
    estimateSize: () => estimatedRowHeight,
    overscan: 3,
    // タブが display:none で非表示化されると ResizeObserver が 0x0 を通知することがあり、
    // これをそのまま反映すると復帰時に実測キャッシュが壊れてスクロール位置がズレる (#タブ復帰時スクロール位置ズレ)。
    // 0x0 通知は無視し、直前の正しいサイズを保持する。
    observeElementRect: (instance, cb) => observeElementRect(instance, (rect) => {
      if (rect.width === 0 || rect.height === 0) return;
      cb(rect);
    }),
    // 上記と同じ理由で、行 (measureElement) 側にも 0x0 が個別に届く。
    // ここを素通しすると itemSizeCache が 0 で上書きされ、復帰直後に大きな delta が
    // 発生して scrollAdjustments が暴走し、スクロール位置が全く関係ない場所へ飛ぶ
    // (#タブ復帰時スクロール位置ズレ)。0 実測値は破棄し、直前の実測値 (なければ概算値) を返す。
    measureElement: (el, entry, instance) => {
      const size = measureElement(el, entry, instance);
      if (size === 0) {
        const index = instance.indexFromElement(el);
        const key = instance.options.getItemKey(index);
        const cached = instance.itemSizeCache.get(key);
        return cached && cached > 0 ? cached : instance.options.estimateSize(index);
      }
      return size;
    }
  });

  // コンテナ幅計測前は描画しない (列数0での誤描画を避ける)
  if (containerWidth === 0 || items.length === 0) return null;

  const gridStyle: React.CSSProperties = layout === 'grid'
    ? { display: 'grid', gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`, gap: `${GRID_GAP}px` }
    : { display: 'flex', flexDirection: 'column', gap: `${LIST_GAP}px` };

  return (
    <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
      {virtualizer.getVirtualItems().map((virtualRow) => {
        const startIdx = virtualRow.index * columnCount;
        const rowItems = items.slice(startIdx, startIdx + columnCount);
        return (
          <div
            key={virtualRow.key}
            data-index={virtualRow.index}
            ref={virtualizer.measureElement}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${virtualRow.start}px)`,
              paddingBottom: `${gap}px`,
              ...gridStyle
            }}
          >
            {rowItems.map((item) => (
              <React.Fragment key={getKey(item)}>{renderItem(item)}</React.Fragment>
            ))}
          </div>
        );
      })}
    </div>
  );
}
