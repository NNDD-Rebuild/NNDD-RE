import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import type { WatchPageInfo } from '@shared/types';
import type { PlayInfo } from './playerUtils';

/** 視聴履歴記録: 再生開始から 10 秒経過した時点で 1 度だけ書き込む */
const HISTORY_RECORD_THRESHOLD_SEC = 10;

/**
 * 視聴履歴の記録。
 * 動画ごとに実視聴時間 (open〜close間の経過時間からpause時間を除いたもの) を計測し、
 * 動画切替・ウィンドウクローズ時に HISTORY_RECORD_THRESHOLD_SEC 秒以上なら HISTORY_ADD する。
 */
export function useWatchHistory({
  currentVideoId,
  watch,
  video,
  playInfoRef
}: {
  currentVideoId: string | undefined;
  watch: WatchPageInfo | null;
  video: HTMLVideoElement | null;
  playInfoRef: MutableRefObject<PlayInfo | null>;
}): void {
  /** 実視聴時間計測用セッション (open〜close間の経過時間からpause時間を除いて算出) */
  const watchSessionRef = useRef<{
    videoId: string;
    title: string;
    thumbnailUrl: string;
    isLocal: boolean;
    openedAtMs: number;
    pausedMs: number;
    pauseStartedAtMs: number | null;
  } | null>(null);

  /** 進行中セッションを確定し、HISTORY_RECORD_THRESHOLD_SEC 秒以上視聴していれば履歴に記録 */
  const flushWatchSession = useCallback((): void => {
    const s = watchSessionRef.current;
    watchSessionRef.current = null;
    if (!s) return;
    let pausedMs = s.pausedMs;
    if (s.pauseStartedAtMs != null) {
      pausedMs += Date.now() - s.pauseStartedAtMs;
    }
    const watchSeconds = (Date.now() - s.openedAtMs - pausedMs) / 1000;
    if (watchSeconds < HISTORY_RECORD_THRESHOLD_SEC) return;
    window.nndd
      .invoke(window.nndd.channels.HISTORY_ADD, {
        videoId: s.videoId,
        title: s.title,
        thumbnailUrl: s.thumbnailUrl,
        isLocal: s.isLocal,
        watchSeconds
      })
      .catch((e) => console.warn('history add failed', e));
  }, []);

  // 動画切替のたびに実視聴時間セッションを開始/確定 (open〜closeの経過時間 - pause時間)
  useEffect(() => {
    if (!currentVideoId) return;
    const info = playInfoRef.current;
    const now = Date.now();
    watchSessionRef.current = {
      videoId: currentVideoId,
      title: info?.title ?? currentVideoId,
      thumbnailUrl: info?.thumbnailUrl ?? '',
      isLocal: info?.isLocal ?? false,
      openedAtMs: now,
      pausedMs: 0,
      // ストリームURL取得・コメント取得等のロード待ちは「再生していない」時間として除外するため
      // 初期状態はpause中扱いにし、実際のplayイベントで計測を開始する
      pauseStartedAtMs: now
    };
    return () => flushWatchSession();
  }, [currentVideoId, flushWatchSession]);

  // videoId確定〜WatchPageInfo取得完了までのタイムラグで暫定タイトル (videoIdそのまま) が
  // セッションに固定されてしまうのを防ぐため、watch確定時にタイトル/サムネを同期する
  useEffect(() => {
    const s = watchSessionRef.current;
    const info = playInfoRef.current;
    if (s && info && s.videoId === info.videoId) {
      s.title = info.title;
      s.thumbnailUrl = info.thumbnailUrl;
      s.isLocal = info.isLocal;
    }
  }, [watch]);

  // pause中は視聴時間としてカウントしない
  useEffect(() => {
    if (!video) return;
    const onPause = (): void => {
      const s = watchSessionRef.current;
      if (s && s.pauseStartedAtMs == null) s.pauseStartedAtMs = Date.now();
    };
    const onPlay = (): void => {
      const s = watchSessionRef.current;
      if (s && s.pauseStartedAtMs != null) {
        s.pausedMs += Date.now() - s.pauseStartedAtMs;
        s.pauseStartedAtMs = null;
      }
    };
    video.addEventListener('pause', onPause);
    video.addEventListener('play', onPlay);
    return () => {
      video.removeEventListener('pause', onPause);
      video.removeEventListener('play', onPlay);
    };
  }, [video]);

  // ウィンドウを閉じる際の保険 (unmount cleanupが間に合わない場合に備える)
  useEffect(() => {
    window.addEventListener('beforeunload', flushWatchSession);
    return () => window.removeEventListener('beforeunload', flushWatchSession);
  }, [flushWatchSession]);
}
