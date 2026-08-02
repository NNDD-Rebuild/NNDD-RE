import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState
} from 'react';
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
  /** src切替後に復元すべき再生位置 (キャッシュ完了によるURL切替、および画質変更時のシーク位置維持に使用) */
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
  /** ミニプレイヤー (Document Picture-in-Picture) のON/OFF通知 */
  onPipChange?: (inPip: boolean) => void;
}

export interface VideoPlayerHandle {
  /** Document Picture-in-Picture 対応環境かどうか */
  pipSupported: boolean;
  /** video + コメントオーバーレイをまとめてミニプレイヤー化/解除する */
  togglePip: () => Promise<void>;
}

/**
 * 動画プレイヤー本体。
 * 元: VideoPlayer.mxml の canvas_video + SWFLoader の責務を担う。
 *
 *  - HLS (master.m3u8) は hls.js でストリーミング
 *  - mp4/flv のローカル/HTTPは <video> 直接
 *  - 上に CommentOverlay を被せる
 */
export const VideoPlayer = forwardRef<VideoPlayerHandle, Props>(function VideoPlayer(
  {
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
    audioOnly,
    onPipChange
  },
  ref
) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const mpegtsRef = useRef<mpegts.Player | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 再生回数カウント済みフラグ (src が変わるたびにリセット)
  const playCountedRef = useRef(false);
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;
  const onPipChangeRef = useRef(onPipChange);
  onPipChangeRef.current = onPipChange;

  // Document Picture-in-Picture: containerRef (video + コメントcanvas) をまるごと
  // 別ウィンドウへ移動する。ノードを移動するだけなので再生状態・WebGLコンテキストは維持される。
  const pipWindowRef = useRef<Window | null>(null);
  const pipPlaceholderRef = useRef<Comment | null>(null);

  const restoreFromPip = (closeWindow: boolean): void => {
    const container = containerRef.current;
    const placeholder = pipPlaceholderRef.current;
    if (container && placeholder?.parentNode) {
      placeholder.parentNode.replaceChild(container, placeholder);
    }
    pipPlaceholderRef.current = null;
    const pipWindow = pipWindowRef.current;
    pipWindowRef.current = null;
    if (closeWindow) pipWindow?.close();
    onPipChangeRef.current?.(false);
  };

  useImperativeHandle(
    ref,
    () => ({
      pipSupported: typeof window !== 'undefined' && 'documentPictureInPicture' in window,
      togglePip: async () => {
        const container = containerRef.current;
        const dpip = window.documentPictureInPicture;
        if (!container || !dpip) return;
        if (pipWindowRef.current) {
          restoreFromPip(true);
          return;
        }
        const rect = container.getBoundingClientRect();
        const pipWindow = await dpip.requestWindow({
          width: Math.max(240, Math.round(rect.width) || 480),
          height: Math.max(135, Math.round(rect.height) || 270)
        });

        // Tailwind等のスタイルをコピーしないと、コメントオーバーレイの絶対配置が崩れる
        [...document.styleSheets].forEach((styleSheet) => {
          try {
            const cssRules = [...styleSheet.cssRules].map((rule) => rule.cssText).join('');
            const style = pipWindow.document.createElement('style');
            style.textContent = cssRules;
            pipWindow.document.head.appendChild(style);
          } catch {
            if (styleSheet.href) {
              const link = pipWindow.document.createElement('link');
              link.rel = 'stylesheet';
              link.type = styleSheet.type;
              link.media = styleSheet.media.mediaText;
              link.href = styleSheet.href;
              pipWindow.document.head.appendChild(link);
            }
          }
        });
        pipWindow.document.body.style.margin = '0';
        pipWindow.document.body.style.overflow = 'hidden';
        pipWindow.document.body.style.background = '#000';

        const placeholder = document.createComment('nndd-pip-placeholder');
        container.parentNode?.insertBefore(placeholder, container);
        pipPlaceholderRef.current = placeholder;
        pipWindow.document.body.append(container);
        pipWindowRef.current = pipWindow;
        onPipChangeRef.current?.(true);

        pipWindow.addEventListener('pagehide', () => restoreFromPip(false), { once: true });
      }
    }),
    []
  );

  // アンマウント時、PiP中なら物理DOM位置を先に元へ戻してからReact側の削除を通す。
  // useLayoutEffect のクリーンアップはReactが自身のDOM除去処理を行う前に同期実行されるため、
  // これを怠ると「PiPウィンドウにある要素を、実際の親ではない場所からremoveChildしようとして
  // 例外になる」事故を防げる。
  useLayoutEffect(() => {
    return () => {
      if (pipWindowRef.current) restoreFromPip(true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      // pendingSeekRef のリセットは実際にシークを適用した後に行う (React.StrictMode の
      // 二重effect実行で1回目が先に消費してしまい、2回目 (実際に残る方) でシークされなくなるのを防ぐ)
      const resumeAt = pendingSeekRef?.current ?? 0;

      // hls.js でストリーミング (Chromium/Electronはこちらが常に対応。
      // canPlayType('application/vnd.apple.mpegurl')はEnvironmentによって
      // 誤ってtrueを返すことがあるため、native HLSより優先する)
      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          maxBufferLength: 60,
          ...(resumeAt > 0 ? { startPosition: resumeAt } : {})
        });
        hlsRef.current = hls;
        hls.attachMedia(video);
        hls.loadSource(src);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          video.play().catch(() => {});
          if (pendingSeekRef && resumeAt > 0) pendingSeekRef.current = 0;
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
      }
      // Safari 等 hls.js 非対応ブラウザは native HLS にフォールバック
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = src;
        if (resumeAt > 0) {
          video.addEventListener('loadedmetadata', () => {
            video.currentTime = resumeAt;
            if (pendingSeekRef) pendingSeekRef.current = 0;
          }, { once: true });
        }
        video.addEventListener('error', () => {
          const code = video.error?.code ?? 0;
          const msg = video.error?.message ?? 'unknown error';
          setError(`再生エラー (code=${code}): ${msg}`);
          onVideoError?.(code, msg);
        }, { once: true });
        video.play().catch(() => {});
        return;
      }
      setError('HLS は非対応ブラウザです');
    } else if (/\.flv(\?|$)/i.test(src) && mpegts.isSupported()) {
      const player = mpegts.createPlayer({ type: 'flv', url: src });
      mpegtsRef.current = player;
      player.attachMediaElement(video);
      player.load();
      Promise.resolve(player.play()).catch(() => {});
      // mpegts.js の ERROR は非対応コーデックのフレーム毎など短時間に連発しうる。
      // player.on() に once 相当がないため手動ガードし、onVideoError の連続発火
      // (→ handleVideoError の再取得ループ) を防ぐ。
      let errorReported = false;
      player.on(mpegts.Events.ERROR, (type: string, _detail: object) => {
        if (errorReported) return;
        errorReported = true;
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
        video.addEventListener('loadedmetadata', () => {
          video.currentTime = seekTo;
          pendingSeekRef.current = 0;
        }, { once: true });
      }
      video.play().catch(() => {});
    }
  }, [src, isHls]);

  return (
    <div ref={containerRef} className={`relative bg-black ${className ?? ''}`}>
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
});
