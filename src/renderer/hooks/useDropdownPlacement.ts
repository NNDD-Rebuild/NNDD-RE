import { useEffect, useState } from 'react';

export interface DropdownPlacement {
  top: number;
  left: number;
  maxHeight: number;
  placement: 'up' | 'down';
}

// text-base(16px, line-height 24px) + py-1.5(上下各6px) の実測見積もり
const ITEM_HEIGHT = 36;
const LIST_PADDING = 8;
const GAP = 4;
const EDGE_MARGIN = 8;
const MIN_MENU_WIDTH = 96;
// 項目数が多い(再生速度8択等)場合に上方向へ大きく伸びすぎないよう上限を設ける。
// 再生速度8択 (8 * ITEM_HEIGHT + LIST_PADDING = 296px) が丸ごと収まる値にして、
// 初期表示でスクロールしないと最後の項目が見えない状態を避ける。
const MAX_MENU_HEIGHT = 300;

const INITIAL_PLACEMENT: DropdownPlacement = {
  top: 0,
  left: 0,
  maxHeight: ITEM_HEIGHT,
  placement: 'down'
};

/**
 * ドロップダウンメニューの表示位置を計算する。
 * ボタン矩形とビューポートサイズから、下に十分なスペースがなければ上方向に開く。
 * メニュー自体は zoom CSS を適用しない (position:fixed の top/left が zoom 倍率で
 * 再スケールされ座標がズレるため) 前提で、見積もりも素のpx値のまま計算する。
 * ボタン側の getBoundingClientRect() は zoom 適用後の実座標をそのまま返すので、
 * ボタン位置の取得自体はズーム有無に関わらず問題ない。
 */
export function useDropdownPlacement(
  anchorRef: React.RefObject<HTMLElement>,
  open: boolean,
  itemCount: number,
  options?: { minWidth?: number }
): DropdownPlacement {
  const minWidth = options?.minWidth ?? MIN_MENU_WIDTH;
  const [placement, setPlacement] = useState<DropdownPlacement>(INITIAL_PLACEMENT);

  useEffect(() => {
    if (!open) return;

    const recompute = (): void => {
      const el = anchorRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const estimatedHeight = Math.min(
        itemCount * ITEM_HEIGHT + LIST_PADDING,
        MAX_MENU_HEIGHT
      );

      const spaceBelow = window.innerHeight - rect.bottom - EDGE_MARGIN;
      const spaceAbove = rect.top - EDGE_MARGIN;

      const openUp = spaceBelow < estimatedHeight && spaceAbove > spaceBelow;

      const top = openUp
        ? Math.max(EDGE_MARGIN, rect.top - GAP - Math.min(estimatedHeight, spaceAbove))
        : rect.bottom + GAP;

      const maxHeight = openUp
        ? Math.min(estimatedHeight, spaceAbove)
        : Math.min(estimatedHeight, Math.max(spaceBelow, ITEM_HEIGHT));

      const menuWidth = Math.max(rect.width, minWidth);
      const left = Math.min(
        Math.max(EDGE_MARGIN, rect.left),
        window.innerWidth - menuWidth - EDGE_MARGIN
      );

      setPlacement({ top, left, maxHeight, placement: openUp ? 'up' : 'down' });
    };

    recompute();
    window.addEventListener('resize', recompute);
    window.addEventListener('scroll', recompute, true);
    return () => {
      window.removeEventListener('resize', recompute);
      window.removeEventListener('scroll', recompute, true);
    };
  }, [anchorRef, open, itemCount, minWidth]);

  return placement;
}
