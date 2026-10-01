import { useCallback, useEffect, useRef } from 'react';
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react';
import type { LiveCommentRange, LiveProgramInfo, LiveStartResult } from '@shared/types';
import { IpcChannel } from '@shared/types';

/**
 * 周辺取得モード: 再生位置の前後この範囲 (ms) のコメントが無ければ取得する。
 * main 側 (LiveSession.fetchCommentsAround) は 1 回の取得でこれより広い範囲 (60 秒前〜300 秒後) を取る
 */
const AROUND_NEED_BEFORE_MS = 30_000;
const AROUND_NEED_AFTER_MS = 60_000;

export interface LiveAroundFetchOptions {
  videoRef: RefObject<HTMLVideoElement>;
  programRef: MutableRefObject<LiveProgramInfo | null>;
  isTimeshiftRef: MutableRefObject<boolean>;
  commentFetchModeRef: MutableRefObject<LiveStartResult['commentFetchMode']>;
  /** 視聴開始 (接続) した時刻 (unix ms)。これ以降のコメントは生コメントで届く */
  connectedAtRef: MutableRefObject<number>;
  /** 今映っている映像の vpos (1/100秒) を返す関数 */
  currentVposRef: MutableRefObject<() => number>;
  setArchiveLoading: Dispatch<SetStateAction<boolean>>;
}

/**
 * 周辺取得モード (コメントが多い番組) で、再生位置の前後のコメントを必要に応じて取得するフック。
 * 2 秒ごとと、シーク完了時に確認する。
 */
export function useLiveAroundFetch({
  videoRef,
  programRef,
  isTimeshiftRef,
  commentFetchModeRef,
  connectedAtRef,
  currentVposRef,
  setArchiveLoading
}: LiveAroundFetchOptions): void {
  /** 周辺取得モード: 取得済みの範囲 (vpos ms) と取得中フラグ */
  const loadedRangesRef = useRef<LiveCommentRange[]>([]);
  const aroundFetchingRef = useRef(false);

  /**
   * 周辺取得モード (コメントが多い番組): 再生位置の前後のコメントが未取得なら取得する。
   * シーク時と、再生が取得済み範囲の端に近づいたときに呼ばれる
   */
  const ensureCommentsAround = useCallback(async (): Promise<void> => {
    if (commentFetchModeRef.current !== 'seek' || aroundFetchingRef.current) return;
    const base = programRef.current?.vposBaseTimeMs;
    if (!base) return;
    const pos = currentVposRef.current() * 10;
    const needFrom = pos - AROUND_NEED_BEFORE_MS;
    // 放送中は接続した時刻より後のコメントは生コメントで届くので、そこまでで足りる
    const needTo = isTimeshiftRef.current
      ? pos + AROUND_NEED_AFTER_MS
      : Math.min(pos + AROUND_NEED_AFTER_MS, connectedAtRef.current - base);
    if (needTo <= needFrom) return;
    const covered = loadedRangesRef.current.some((r) => r.fromVposMs <= needFrom && r.toVposMs >= needTo);
    if (covered) return;
    aroundFetchingRef.current = true;
    setArchiveLoading(true);
    try {
      const range = await window.nndd.invoke<LiveCommentRange | null>(
        IpcChannel.LIVE_FETCH_COMMENTS_AROUND,
        Math.max(0, pos)
      );
      if (range) loadedRangesRef.current.push(range);
    } catch (e) {
      console.warn('fetch comments around failed', e);
    } finally {
      aroundFetchingRef.current = false;
      setArchiveLoading(false);
    }
    // 引数は ref と state の setter で不変。分割前と同じくマウント時の関数を使い続ける
  }, []);

  useEffect(() => {
    const t = window.setInterval(() => void ensureCommentsAround(), 2000);
    const video = videoRef.current;
    const onSeeked = (): void => void ensureCommentsAround();
    video?.addEventListener('seeked', onSeeked);
    return () => {
      window.clearInterval(t);
      video?.removeEventListener('seeked', onSeeked);
    };
  }, [ensureCommentsAround]);
}
