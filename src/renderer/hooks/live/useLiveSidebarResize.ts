import { useState } from 'react';
import type { Dispatch, MouseEvent as ReactMouseEvent, SetStateAction } from 'react';
import { IpcChannel } from '@shared/types';

/** サイドパネル幅 (通常プレイヤー PlayerApp と同じ範囲) */
const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 700;
const SIDEBAR_DEFAULT = 320;

export interface LiveSidebarResize {
  /** サイドパネルの幅 (通常プレイヤーと共通の設定 player.sidebarWidth) */
  sidebarWidth: number;
  /** 設定から読み込んだ幅を反映する */
  setSidebarWidth: Dispatch<SetStateAction<number>>;
  isSidebarDragging: boolean;
  onSidebarDividerMouseDown: (e: ReactMouseEvent) => void;
}

/**
 * サイドパネル境界のドラッグで幅を変える (PlayerApp と同じ挙動、幅は設定に保存)。
 * 保存済みの幅の読み込みは呼び出し側で行う。
 */
export function useLiveSidebarResize(): LiveSidebarResize {
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT);
  const [isSidebarDragging, setIsSidebarDragging] = useState(false);

  /** サイドパネル境界のドラッグで幅を変える (PlayerApp と同じ挙動、幅は設定に保存) */
  const onSidebarDividerMouseDown = (e: ReactMouseEvent): void => {
    const startX = e.clientX;
    const startW = sidebarWidth;
    setIsSidebarDragging(true);
    e.preventDefault();
    const widthAt = (x: number): number => Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, startW + (startX - x)));
    const onMove = (ev: MouseEvent): void => setSidebarWidth(widthAt(ev.clientX));
    const onUp = (ev: MouseEvent): void => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setIsSidebarDragging(false);
      void window.nndd
        .invoke(IpcChannel.CONFIG_SET, 'player.sidebarWidth', widthAt(ev.clientX))
        .catch(() => {});
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return { sidebarWidth, setSidebarWidth, isSidebarDragging, onSidebarDividerMouseDown };
}
