import { useEffect, useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { LiveCommentWindowEvent } from '@shared/types';
import { IpcChannel } from '@shared/types';
import { pushToCommentWindow } from './liveCommentUtils';

export type LiveCommentDisplay = 'side' | 'window';

export interface LiveCommentWindowOptions {
  /** 今映っている映像の vpos (1/100秒) を返す関数 */
  currentVposRef: MutableRefObject<() => number>;
  /** コメントウィンドウ (フロート) が開いて snapshot 送信済みか */
  commentWindowOpenRef: MutableRefObject<boolean>;
  /** コメントウィンドウへ全件 (snapshot) を送る */
  sendSnapshotRef: MutableRefObject<() => void>;
  /** コメントウィンドウからのシーク要求用 (最新の関数を入れておく) */
  seekToVposRef: MutableRefObject<(vposMs: number) => void>;
  /** 表示方式の初期値 (設定 live.commentListDisplay) と、その読み込み中フラグ */
  defaultCommentDisplay: LiveCommentDisplay;
  commentDisplayLoading: boolean;
}

export interface LiveCommentWindow {
  /** 今映っている位置 (番組の vpos 基準、ms)。コメントリストの現在位置表示に使う */
  positionMs: number;
  /** コメントリストの表示方式 (side: タブ表示 / window: 浮動ウィンドウ)。設定を読み込むまでは null */
  commentDisplay: LiveCommentDisplay | null;
  setCommentDisplay: Dispatch<SetStateAction<LiveCommentDisplay | null>>;
}

/**
 * コメントリストの再生位置の追跡と、コメントウィンドウ (フロート) の開閉・イベント受信。
 */
export function useLiveCommentWindow({
  currentVposRef,
  commentWindowOpenRef,
  sendSnapshotRef,
  seekToVposRef,
  defaultCommentDisplay,
  commentDisplayLoading
}: LiveCommentWindowOptions): LiveCommentWindow {
  /** 今映っている位置 (番組の vpos 基準、ms)。コメントリストの現在位置表示に使う */
  const [positionMs, setPositionMs] = useState(0);
  const [commentDisplay, setCommentDisplay] = useState<LiveCommentDisplay | null>(null);

  // ---- コメントリストの再生位置 ----
  useEffect(() => {
    const t = window.setInterval(() => {
      const nowMs = currentVposRef.current() * 10;
      // 小さな変化では再描画しない (コメントリストの現在位置は 0.5 秒単位で十分)
      setPositionMs((prev) => (Math.abs(prev - nowMs) >= 400 ? nowMs : prev));
      if (commentWindowOpenRef.current) pushToCommentWindow({ type: 'position', vposMs: nowMs });
    }, 500);
    return () => window.clearInterval(t);
  }, []);

  // ---- コメントウィンドウ (フロート) ----
  // 設定の既定値を読み込めたら表示場所を決める
  useEffect(() => {
    if (!commentDisplayLoading && commentDisplay === null) setCommentDisplay(defaultCommentDisplay);
  }, [commentDisplayLoading, defaultCommentDisplay, commentDisplay]);

  useEffect(() => {
    if (commentDisplay === 'window') {
      void window.nndd.invoke(IpcChannel.LIVE_COMMENT_WINDOW_OPEN).catch(() => {});
    } else if (commentDisplay === 'side') {
      commentWindowOpenRef.current = false;
      void window.nndd.invoke(IpcChannel.LIVE_COMMENT_WINDOW_CLOSE).catch(() => {});
    }
  }, [commentDisplay]);

  useEffect(() => {
    const off = window.nndd.on(IpcChannel.LIVE_COMMENT_WINDOW_EVENT, (...args: unknown[]) => {
      const ev = args[0] as LiveCommentWindowEvent;
      switch (ev.type) {
        case 'ready':
          // コメントウィンドウの準備ができたら全件を送り、以降は差分を送る
          commentWindowOpenRef.current = true;
          sendSnapshotRef.current();
          break;
        case 'seek':
          seekToVposRef.current(ev.vposMs);
          break;
        case 'closed':
          commentWindowOpenRef.current = false;
          setCommentDisplay('side');
          break;
      }
    });
    return off;
  }, []);

  return { positionMs, commentDisplay, setCommentDisplay };
}
