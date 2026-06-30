import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import mpegts from 'mpegts.js';
import type { NNDDREComment } from '@shared/types';
import { IpcChannel } from '@shared/types';
import { CommentOverlay } from './CommentOverlay';
import type { CommentRenderConfig } from './CommentRenderer';

interface Props {
  src: string;
  isHls?: boolean;
  comments: NNDDREComment[];
  commentConfig?: Partial<CommentRenderConfig>;
  loading?: boolean;
  videoRefCallback?: (el: HTMLVideoElement | null) => void;
  /** src切替後に復元すべき再生位置 (nndd-stream → nndd-re-local 自動切替時に使用) */
  pendingSeekRef?: React.MutableRefObject<number>;
  /** 再生回数カウント用の動画ID (10秒再生で+1) */
  videoId?: string;
  className?: string;
  /** 再生エラー時コールバック (code: MediaError.code) */
  onVideoError?: (code: number, message: string) => void;
  /** 動画終了時コールバック */
  onEnded?: () => void;
  /** 音声のみ再生モード (映像非表示) */
  audioOnly?: boolean;
}

/**
 * 動画プレイヤー本体。
 * 元: VideoPlayer.mxml の canvas_video + SWFLoader の責務を担う。
 *
 *  - HLS (master.m3u8) は hls.js でストリーミング
 *  - mp4/flv のローカル/HTTPは <video> 直接
 *  - 上に CommentOverlay を被せる
 */
export function VideoPlayer({
  src,
  isHls,
  comments,
  commentConfig,
  loading,
  videoRefCallback,
  pendingSeekRef,
  videoId,
  className,
  onVideoError,
  onEnded,
  audioOnly
}: Props): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const mpegtsRef = useRef<mpegts.Player | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 再生回数カウント済みフラグ (src が変わるたびにリセット)
  const playCountedRef = useRef(false);
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;

  useEffect(() => {
    if (videoRefCallback) videoRefCallback(videoRef.current);
    return () => videoRefCallback?.(null);
  }, [videoRefCallback]);

  // src変更時にカウントフラグリセット
  useEffect(() => {
    playCountedRef.current = false;
  }, [src]);

  // 10秒以上再生したら playCount +1
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const onPlay = (): void => {
      if (playCountedRef.current) return;
      timer = setTimeout(() => {
        if (!playCountedRef.current && !video.paused) {
          playCountedRef.current = true;
          window.nndd.invoke(IpcChannel.VIDEO_INCREMENT_PLAY_COUNT, videoId);
        }
      }, 10000);
    };
    const onPause = (): void => {
      if (timer) { clearTimeout(timer); timer = null; }
    };
    const onEndedInternal = (): void => {
      if (timer) { clearTimeout(timer); timer = null; }
      onEndedRef.current?.();
    };

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('ended', onEndedInternal);
    return () => {
      if (timer) clearTimeout(timer);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('ended', onEndedInternal);
    };
  }, [videoId, src]);

  useEffect(() => {
    const video = videoRef.current;
    console.log('[VideoPlayer] src effect:', src, 'video:', video);
    if (!video || !src) return;
    setError(null);

    if (mpegtsRef.current) {
      mpegtsRef.current.destroy();
      mpegtsRef.current = null;
    }

    const isHlsResolved = isHls ?? /\.m3u8(\?|$)/i.test(src);

    if (isHlsResolved) {
      // Safari 互換ブラウザは native HLS
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = src;
        video.play().catch(() => {});
        return;
      }
      // hls.js でストリーミング
      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          maxBufferLength: 60
        });
        hlsRef.current = hls;
        hls.attachMedia(video);
        hls.loadSource(src);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          video.play().catch(() => {});
        });
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (data.fatal) {
            setError(`HLS error: ${data.type} / ${data.details}`);
          }
        });
        return () => {
          hls.destroy();
          hlsRef.current = null;
        };
      } else {
        setError('HLS は非対応ブラウザです');
      }
    } else if (/\.flv(\?|$)/i.test(src) && mpegts.isSupported()) {
      const player = mpegts.createPlayer({ type: 'flv', url: src });
      mpegtsRef.current = player;
      player.attachMediaElement(video);
      player.load();
      Promise.resolve(player.play()).catch(() => {});
      player.on(mpegts.Events.ERROR, (type: string, _detail: object) => {
        const msg = `FLV error: ${type}`;
        setError(msg);
        onVideoError?.(4, msg);
      });
      return () => {
        player.destroy();
        mpegtsRef.current = null;
      };
    } else {
      // ローカル / 通常MP4
      console.log('[VideoPlayer] setting video.src:', src);
      video.src = src;
      video.addEventListener('error', (e) => {
        const code = video.error?.code ?? 0;
        const msg = video.error?.message ?? 'unknown error';
        console.error('[VideoPlayer] video error: code=' + code + ' msg=' + msg, e);
        setError(`再生エラー (code=${code}): ${msg}`);
        onVideoError?.(code, msg);
      }, { once: true });
      if (pendingSeekRef && pendingSeekRef.current > 0) {
        const seekTo = pendingSeekRef.current;
        pendingSeekRef.current = 0;
        video.addEventListener('loadedmetadata', () => {
          video.currentTime = seekTo;
        }, { once: true });
      }
      video.play().catch(() => {});
    }
  }, [src, isHls]);

  return (
    <div className={`relative bg-black ${className ?? ''}`}>
      <video
        ref={videoRef}
        className="w-full h-full bg-black"
        style={audioOnly ? { display: 'none' } : undefined}
        playsInline
        autoPlay
        controls={false}
      />
      <CommentOverlay
        videoRef={videoRef}
        comments={comments}
        config={commentConfig}
      />
      {(loading || error) && (
        <div className="absolute inset-0 flex items-center justify-center text-white bg-black/70 text-sm">
          {error ?? '読み込み中...'}
        </div>
      )}
    </div>
  );
}
