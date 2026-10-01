import { useCallback, useEffect, useRef, useState } from 'react';

const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 700;

/**
 * プレイヤー右側サイドバー (動画情報ペイン) の幅をドラッグで変更する。
 * 幅は設定 `player.sidebarWidth` に保存・復元する。
 */
export function useSidebarResize(): {
  sidebarWidth: number;
  isSidebarDragging: boolean;
  handleTabsOverflow: (neededWidth: number) => void;
  onSidebarDividerMouseDown: (e: React.MouseEvent) => void;
} {
  const [sidebarWidth, setSidebarWidth] = useState(320);
  // 保存値の復元 or 手動リサイズが一度でも起きたら true。true になった後は
  // handleTabsOverflow による自動拡大を止める (フォント差でタブ幅計算が変わる
  // 環境 (例: Linux) で、保存済みの幅を毎起動自動的に押し広げてしまうのを防ぐため)
  const sidebarUserSetRef = useRef(false);
  const [isSidebarDragging, setIsSidebarDragging] = useState(false);
  const sidebarDragging = useRef(false);
  const sidebarDragStartX = useRef(0);
  const sidebarDragStartW = useRef(320);

  // 保存済み幅のロード
  useEffect(() => {
    window.nndd
      .invoke<number>(window.nndd.channels.CONFIG_GET, 'player.sidebarWidth')
      .then((w) => {
        if (w && w > 0) {
          setSidebarWidth(w);
          sidebarUserSetRef.current = true;
        }
      })
      .catch(() => {});
  }, []);

  // タブバーが収まらない時、スクロールでなくペイン幅拡大で対応 (縮小方向へは動かさない)。
  // ただし保存値の復元後・手動リサイズ後は対象外 (毎起動押し広げるのを防ぐ)
  const handleTabsOverflow = useCallback((neededWidth: number): void => {
    if (sidebarUserSetRef.current) return;
    const w = Math.min(SIDEBAR_MAX, neededWidth + 8);
    setSidebarWidth((prev) => Math.max(prev, w));
  }, []);

  const onSidebarDividerMouseDown = useCallback((e: React.MouseEvent): void => {
    sidebarDragging.current = true;
    setIsSidebarDragging(true);
    sidebarDragStartX.current = e.clientX;
    sidebarDragStartW.current = sidebarWidth;
    e.preventDefault();
  }, [sidebarWidth]);

  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      if (!sidebarDragging.current) return;
      const dx = sidebarDragStartX.current - e.clientX; // 左ドラッグ → 幅増加
      const w = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, sidebarDragStartW.current + dx));
      setSidebarWidth(w);
    };
    const onUp = (e: MouseEvent): void => {
      if (!sidebarDragging.current) return;
      sidebarDragging.current = false;
      setIsSidebarDragging(false);
      sidebarUserSetRef.current = true;
      const dx = sidebarDragStartX.current - e.clientX;
      const w = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, sidebarDragStartW.current + dx));
      window.nndd
        .invoke(window.nndd.channels.CONFIG_SET, 'player.sidebarWidth', w)
        .catch(() => {});
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  return { sidebarWidth, isSidebarDragging, handleTabsOverflow, onSidebarDividerMouseDown };
}
