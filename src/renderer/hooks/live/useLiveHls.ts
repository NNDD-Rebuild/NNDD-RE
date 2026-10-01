import { useEffect } from 'react';
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react';
import Hls from 'hls.js';

export interface LiveHlsOptions {
  videoRef: RefObject<HTMLVideoElement>;
  /** 生成した Hls を入れる (vpos の算出・ライブ位置へのシークで使う) */
  hlsRef: MutableRefObject<Hls | null>;
  /** HLS の URL。変わるたびに Hls を作り直す */
  streamUri: string;
  isTimeshiftRef: MutableRefObject<boolean>;
  setStateMessage: Dispatch<SetStateAction<string>>;
}

/**
 * 生放送の HLS 再生。hls.js が使えない環境では video 要素に直接 URL を渡す。
 * 致命的なメディアエラーは 5 秒に 1 回まで recoverMediaError で復旧を試みる。
 */
export function useLiveHls({ videoRef, hlsRef, streamUri, isTimeshiftRef, setStateMessage }: LiveHlsOptions): void {
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !streamUri) return;
    if (!Hls.isSupported()) {
      video.src = streamUri;
      void video.play().catch(() => {});
      return;
    }
    const hls = new Hls({ lowLatencyMode: !isTimeshiftRef.current, enableWorker: true });
    hlsRef.current = hls;
    let lastMediaRecovery = 0;
    hls.on(Hls.Events.ERROR, (_ev, data) => {
      if (!data.fatal) return;
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR && Date.now() - lastMediaRecovery > 5000) {
        lastMediaRecovery = Date.now();
        hls.recoverMediaError();
        return;
      }
      console.error('hls fatal error', data.type, data.details);
      setStateMessage(`映像の読み込みに失敗しました (${data.details})`);
    });
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      void video.play().catch(() => {});
    });
    hls.attachMedia(video);
    hls.loadSource(streamUri);
    return () => {
      hls.destroy();
      if (hlsRef.current === hls) hlsRef.current = null;
    };
    // videoRef / hlsRef / isTimeshiftRef は ref、setStateMessage は state の setter で不変。分割前と同じく streamUri だけで作り直す
  }, [streamUri]);
}
