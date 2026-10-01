import { useEffect, useRef, type MutableRefObject } from 'react';
import type { WatchPageInfo } from '@shared/types';
import { IpcChannel } from '@shared/types';
import { pickDefaultQualityId, type PlayInfo, type PreloadEntry, type StreamUrlResult } from './playerUtils';

/** レジューム保存: これ未満の視聴では保存しない */
const RESUME_MIN_WATCH_SEC = 30;
/** レジューム保存: 終了間際 (残りこの秒数以下) は見終わったとみなしクリア */
const RESUME_SKIP_END_SEC = 15;
/** レジューム保存の間引き間隔 */
const RESUME_SAVE_INTERVAL_MS = 5000;

/**
 * 250ms ごとの定期処理 (マウント時に1回だけ登録)。
 *  - コメントウィンドウへ再生位置をプッシュ
 *  - レジューム位置の保存 / 終了間際のクリア
 *  - 残り5秒で次の動画をプリロード (preloadRef に格納し、initStreaming が消費する)
 *
 * 渡す値はすべて ref か、ref だけを読む関数であること (タイマーはマウント時の値を握り続けるため)。
 */
export function usePlaybackTicker({
  videoElementRef,
  audioOnlyRef,
  isLocalRef,
  playInfoRef,
  resumeFinishedRef,
  preloadRef,
  defaultQualityRef,
  getNextVideoId
}: {
  videoElementRef: MutableRefObject<HTMLVideoElement | null>;
  audioOnlyRef: MutableRefObject<boolean>;
  isLocalRef: MutableRefObject<boolean>;
  playInfoRef: MutableRefObject<PlayInfo | null>;
  /** レジューム位置クリア (終了間際判定) を1回だけ発行するためのフラグ */
  resumeFinishedRef: MutableRefObject<boolean>;
  preloadRef: MutableRefObject<PreloadEntry | null>;
  defaultQualityRef: MutableRefObject<'highest' | number>;
  getNextVideoId: () => string | null;
}): void {
  /** レジューム位置保存の間引きタイマー */
  const lastResumeSaveAtRef = useRef(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      const v = videoElementRef.current;
      const t = v?.currentTime ?? 0;
      window.nndd.send(IpcChannel.COMMENT_WINDOW_TIME, t);

      if (v && v.duration > 0 && !audioOnlyRef.current) {
        const now = Date.now();
        if (now - lastResumeSaveAtRef.current >= RESUME_SAVE_INTERVAL_MS) {
          lastResumeSaveAtRef.current = now;
          const info = playInfoRef.current;
          const remaining = v.duration - t;
          if (info?.videoId && t >= RESUME_MIN_WATCH_SEC) {
            if (remaining <= RESUME_SKIP_END_SEC) {
              if (!resumeFinishedRef.current) {
                resumeFinishedRef.current = true;
                window.nndd.invoke(IpcChannel.RESUME_CLEAR, info.videoId).catch(() => {});
              }
            } else {
              window.nndd
                .invoke(IpcChannel.RESUME_SAVE, {
                  videoKey: info.videoId,
                  positionSec: t,
                  durationSec: v.duration
                })
                .catch(() => {});
            }
          }
        }
      }

      if (v && !isLocalRef.current && preloadRef.current === null && v.duration > 0) {
        const remaining = v.duration - t;
        if (remaining > 0 && remaining <= 5) {
          const nextId = getNextVideoId();
          if (nextId) {
            // 取得中の目印。initStreaming が消費 (null 化) した後に結果が届いた場合は
            // 書き戻さない (古いプリロードが残って次回のプリロードを塞ぐのを防ぐ)
            const pending: PreloadEntry = { videoId: nextId };
            preloadRef.current = pending;
            (async () => {
              try {
                const watchInfo = await window.nndd.invoke<WatchPageInfo>(
                  window.nndd.channels.VIDEO_GET_WATCH_INFO, nextId
                );
                const avail = watchInfo.domandVideos
                  .filter((q) => q.isAvailable)
                  .sort((a, b) => b.qualityLevel - a.qualityLevel);
                const qualityId = pickDefaultQualityId(avail, defaultQualityRef.current);
                const stream = await window.nndd.invoke<StreamUrlResult>(
                  window.nndd.channels.VIDEO_GET_STREAM_URL, nextId, watchInfo, audioOnlyRef.current, qualityId
                );
                if (preloadRef.current !== pending) return;
                if (!stream.error) {
                  preloadRef.current = { videoId: nextId, watchInfo, stream };
                } else {
                  preloadRef.current = null;
                }
              } catch {
                if (preloadRef.current === pending) preloadRef.current = null;
              }
            })();
          }
        }
      }
    }, 250);
    return () => window.clearInterval(id);
  }, []);
}
