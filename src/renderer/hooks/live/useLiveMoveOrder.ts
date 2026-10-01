import { useCallback, useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { LiveMoveOrder } from '@shared/types';
import { IpcChannel } from '@shared/types';

export interface LiveMoveOrderOptions {
  /** 放送者からの移動指示 (LiveEvent moveOrder で受け取る) */
  moveOrder: LiveMoveOrder | null;
  setMoveOrder: Dispatch<SetStateAction<LiveMoveOrder | null>>;
  /** 設定 live.autoFollowMoveOrder とその読み込み中フラグ */
  autoFollowMoveOrder: boolean;
  autoFollowLoading: boolean;
}

export interface LiveMoveOrderControl {
  /** 自動移動する時刻 (unix ms)。自動移動しない場合は null */
  moveDeadline: number | null;
  /** 移動指示に従う */
  followMoveOrder: (order: LiveMoveOrder) => void;
  /** 移動指示を閉じる (従わない) */
  dismissMoveOrder: () => void;
}

/**
 * 放送者からの移動指示への追従。
 * 自動で従う設定なら、指定の待ち時間 (最短 5 秒) の後に移動する。
 */
export function useLiveMoveOrder({
  moveOrder,
  setMoveOrder,
  autoFollowMoveOrder,
  autoFollowLoading
}: LiveMoveOrderOptions): LiveMoveOrderControl {
  /** 自動移動する時刻 (unix ms)。自動移動しない場合は null */
  const [moveDeadline, setMoveDeadline] = useState<number | null>(null);

  /** 移動指示に従う。番組ならこのプレイヤーで開き、それ以外の URL は外部ブラウザで開く */
  const followMoveOrder = useCallback((order: LiveMoveOrder): void => {
    setMoveOrder(null);
    setMoveDeadline(null);
    const lv = order.target.match(/(?:^|\/watch\/)((?:lv|co|ch)\d+)\b/);
    if (lv) void window.nndd.invoke(IpcChannel.LIVE_OPEN_PLAYER, lv[1]).catch(() => {});
    else if (/^https?:\/\//.test(order.target)) void window.nndd.invoke(IpcChannel.SYS_OPEN_PATH, order.target);
    // setMoveOrder は state の setter で不変。分割前と同じくマウント時の関数を使い続ける
  }, []);

  // 自動で従う設定なら、指定の待ち時間 (最短 5 秒。中止できるように) の後に移動する
  useEffect(() => {
    if (!moveOrder || autoFollowLoading || !autoFollowMoveOrder) {
      setMoveDeadline(null);
      return;
    }
    const wait = Math.max(moveOrder.waitMs, 5000);
    setMoveDeadline(Date.now() + wait);
    const timer = window.setTimeout(() => followMoveOrder(moveOrder), wait);
    return () => window.clearTimeout(timer);
  }, [moveOrder, autoFollowMoveOrder, autoFollowLoading, followMoveOrder]);

  const dismissMoveOrder = (): void => {
    setMoveOrder(null);
    setMoveDeadline(null);
  };

  return { moveDeadline, followMoveOrder, dismissMoveOrder };
}
