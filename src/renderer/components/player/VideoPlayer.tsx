import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
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
  /** コメント合成 Picture-in-Picture のON/OFF通知 */
  onPipChange?: (inPip: boolean) => void;
  /** video要素クリック時のカスタム処理。指定時はデフォルトの再生/一時停止トグルの代わりに呼ばれる
   * (スマホブラウザ版: 1回目のタップで操作バー表示、2回目のタップで再生/一時停止) */
  onVideoClick?: () => void;
}

export interface VideoPlayerHandle {
  /** 映像+コメントを合成した Picture-in-Picture を開始/終了する */
  togglePip: () => Promise<void>;
}

/** PiP 用に合成する映像の最大幅 (px)。大きいほど綺麗だが合成コストが上がる */
const PIP_MAX_WIDTH = 1280;

/**
 * 動画プレイヤー本体。
 * 元: VideoPlayer.mxml の canvas_video + SWFLoader の責務を担う。
 *
 *  - HLS (master.m3u8) は hls.js でストリーミング
 *  - mp4/flv のローカル/HTTPは <video> 直接
 *  - 上に CommentOverlay を被せる
 */
export const VideoPlayer = forwardRef<VideoPlayerHandle, Props>(function VideoPlayer({
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
  onPipChange,
  onVideoClick
}: Props, ref) {
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
  // PiP 中は本画面を「PiP 中」表示にして二重表示を避ける
  const [inPip, setInPip] = useState(false);

  // コメント合成 Picture-in-Picture:
  // Electron は Document PiP を扱えない (ウィンドウが即破棄される) ため、
  // 映像とコメント canvas を1枚の canvas へ毎フレーム合成し、captureStream した
  // 非表示 <video> を Chromium 標準の PiP に載せる。音声は元の video がそのまま鳴らす。
  const pipCleanupRef = useRef<(() => void) | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      togglePip: async () => {
        if (pipCleanupRef.current) {
          // 終了は proxy の leavepictureinpicture で後始末される
          if (document.pictureInPictureElement) await document.exitPictureInPicture();
          else pipCleanupRef.current();
          return;
        }
        const video = videoRef.current;
        const container = containerRef.current;
        if (!video || !container) return;

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const fitSize = (): void => {
          const vw = video.videoWidth || 1280;
          const vh = video.videoHeight || 720;
          const scale = Math.min(1, PIP_MAX_WIDTH / vw);
          const w = Math.round(vw * scale);
          const h = Math.round(vh * scale);
          if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
          }
        };
        fitSize();

        let stopped = false;
        let rafId: number | null = null;
        const draw = (): void => {
          if (stopped) return;
          fitSize();
          ctx.fillStyle = '#000';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          if (!audioOnly && video.readyState >= 2) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          }
          // コメント canvas は映像の描画矩形に合わせて配置されているため、全面に重ねればよい
          container.querySelectorAll('canvas').forEach((c) => {
            if (c.style.visibility === 'hidden' || c.width === 0 || c.height === 0) return;
            ctx.globalAlpha = parseFloat(c.style.opacity || '1') || 1;
            try {
              ctx.drawImage(c, 0, 0, canvas.width, canvas.height);
            } catch {
              /* コンテキストロスト中などは次フレームで再試行 */
            }
            ctx.globalAlpha = 1;
          });
          // コメントの WebGL canvas は描画と同じフレーム内でないと読めないことがあるため rAF で回す
          rafId = requestAnimationFrame(draw);
        };

        const proxy = document.createElement('video');
        proxy.muted = true;
        proxy.playsInline = true;
        // PiP に載せるだけで画面には出さない
        proxy.style.cssText =
          'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none;';

        const session = 'mediaSession' in navigator ? navigator.mediaSession : null;
        const syncState = (): void => {
          if (session) session.playbackState = video.paused ? 'paused' : 'playing';
        };
        const cleanup = (): void => {
          if (stopped) return;
          stopped = true;
          if (rafId !== null) cancelAnimationFrame(rafId);
          video.removeEventListener('play', syncState);
          video.removeEventListener('pause', syncState);
          if (session) {
            session.setActionHandler('play', null);
            session.setActionHandler('pause', null);
            session.playbackState = 'none';
          }
          proxy.srcObject = null;
          proxy.remove();
          pipCleanupRef.current = null;
          void window.nndd.invoke(window.nndd.channels.PLAYER_WINDOW_KEEP_ACTIVE, false).catch(() => {});
          setInPip(false);
          onPipChangeRef.current?.(false);
        };
        pipCleanupRef.current = cleanup;

        try {
          // メイン窓を最小化しても合成・コメント描画が止まらないようにする
          await window.nndd.invoke(window.nndd.channels.PLAYER_WINDOW_KEEP_ACTIVE, true);
          draw();
          proxy.srcObject = canvas.captureStream(30);
          document.body.appendChild(proxy);
          await proxy.play();
          proxy.addEventListener('leavepictureinpicture', cleanup, { once: true });
          await proxy.requestPictureInPicture();
        } catch (e) {
          const err = e as { name?: string; message?: string };
          console.warn(`Picture-in-Picture failed: ${err.name}: ${err.message}`);
          cleanup();
          return;
        }

        // PiP 窓の再生/一時停止ボタンを元の video に繋ぐ
        if (session) {
          session.setActionHandler('play', () => { void video.play(); });
          session.setActionHandler('pause', () => { video.pause(); });
          video.addEventListener('play', syncState);
          video.addEventListener('pause', syncState);
          syncState();
        }
        setInPip(true);
        onPipChangeRef.current?.(true);
      }
    }),
    [audioOnly]
  );

  // アンマウント時に PiP を閉じる
  useEffect(() => {
    return () => {
      pipCleanupRef.current?.();
      if (document.pictureInPictureElement) void document.exitPictureInPicture().catch(() => {});
    };
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
    if (!video || !src) return;
    setError(null);

    if (mpegtsRef.current) {
      mpegtsRef.current.destroy();
      mpegtsRef.current = null;
    }

    const isHlsResolved = isHls ?? /\.m3u8(\?|$)/i.test(src);

    if (isHlsResolved) {
      // pendingSeekRef はここではリセットしない (initStreaming/initLocal/handleQualityChange が
      // 次回のsrc切替時に必ず明示的に上書きするため不要。React.StrictMode の二重effect実行で
      // 1回目がここでリセットしてしまうと、2回目 (実際に残る方) でシークされなくなる)
      const resumeAt = pendingSeekRef?.current ?? 0;

      // hls.js でストリーミング (Chromium/Electronはこちらが常に対応。
      // canPlayType('application/vnd.apple.mpegurl')はEnvironmentによって
      // 誤ってtrueを返すことがあるため、native HLSより優先する)
      if (Hls.isSupported()) {
        // StrictMode の二重effect実行時、1回目のhlsインスタンスのMANIFEST_PARSEDが
        // cleanup(destroy)より後に発火すると、2回目(実際に残る方)のresumeAtを
        // 誤って0にリセットしてしまう→cancelledガードでdestroy後の副作用を防ぐ
        let cancelled = false;
        // ニコニコDomand配信は先頭セグメント(0秒付近)がopen-GOP構造 (IDRキーフレーム無し)
        // のことがあり、SourceBufferがまっさらな状態 (=hls生成直後) での取得は問題ないが、
        // 他の位置を再生した後のSourceBufferに既存データが乗った状態で同じセグメントを
        // 再取得すると、hls.jsがバッファ増加を検知できず (BUFFER_APPEND_NO_PROGRESS)
        // 再生が止まったままになる (hls.js issue #7774 の亜種)。
        // 0秒付近へのシークを検知したらhlsインスタンスを作り直し、まっさらな
        // SourceBufferで先頭セグメントを再取得させることで回避する。
        let hls: Hls;
        let manifestReady = false;
        let rebuilding = false;

        const buildHls = (startAt: number): Hls => {
          const h = new Hls({
            enableWorker: true,
            lowLatencyMode: false,
            maxBufferLength: 60,
            interstitialsController: null as unknown as undefined,
            ...(startAt > 0 ? { startPosition: startAt } : {})
          });
          hlsRef.current = h;
          h.attachMedia(video);
          h.loadSource(src);
          h.on(Hls.Events.MANIFEST_PARSED, () => {
            if (cancelled) return;
            manifestReady = true;
            video.play().catch(() => {});
          });
          h.on(Hls.Events.ERROR, (_e, data) => {
            if (cancelled) return;
            if (data.fatal) {
              setError(`HLS error: ${data.type} / ${data.details}`);
            }
          });
          return h;
        };

        hls = buildHls(resumeAt);

        const onSeekingRebuild = (): void => {
          if (!manifestReady || rebuilding || cancelled) return;
          if (video.currentTime >= 1) return;
          rebuilding = true;
          manifestReady = false;
          hls.destroy();
          hls = buildHls(0);
          rebuilding = false;
        };
        video.addEventListener('seeking', onSeekingRebuild);

        return () => {
          cancelled = true;
          video.removeEventListener('seeking', onSeekingRebuild);
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
        }, { once: true });
      }
      video.play().catch(() => {});
    }
  }, [src, isHls]);

  // 動画の読み込み後、映像の比に合わせてウィンドウの縦幅を調整し上下の黒帯をなくす。
  // 幅は変えない (ユーザーが決めた幅と、横のコメント一覧の幅を尊重)。
  // 全画面・最大化・ミニモード中は main 側で何もしない。音声のみは対象外。
  useEffect(() => {
    const video = videoRef.current;
    if (!video || audioOnly) return;
    const fit = (): void => {
      const container = containerRef.current;
      if (!container) return;
      const { videoWidth: vw, videoHeight: vh } = video;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (vw <= 0 || vh <= 0 || w <= 0 || h <= 0) return;
      // 画面の作業領域を超えて伸ばさない
      const room = window.screen.availHeight - window.outerHeight;
      const delta = Math.min(Math.round((w * vh) / vw - h), Math.max(0, room));
      if (Math.abs(delta) < 4) return;
      void window.nndd
        .invoke(window.nndd.channels.PLAYER_WINDOW_ADJUST_HEIGHT, delta)
        .catch(() => {});
    };
    video.addEventListener('loadedmetadata', fit);
    return () => video.removeEventListener('loadedmetadata', fit);
  }, [audioOnly]);

  return (
    <div ref={containerRef} className={`relative bg-black ${className ?? ''}`}>
      <video
        ref={videoRef}
        className="w-full h-full bg-black"
        style={audioOnly ? { display: 'none' } : undefined}
        playsInline
        // ローカル再生 (ループバックHTTP配信) は crossOrigin が無いと canvas が tainted になり、
        // PiP 用の合成 canvas を captureStream できない。StreamServer が CORS 許可を返す。
        crossOrigin={/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])[:/]/i.test(src) ? 'anonymous' : undefined}
        autoPlay
        controls={false}
        onClick={() => {
          if (onVideoClick) {
            onVideoClick();
            return;
          }
          const v = videoRef.current;
          if (!v) return;
          if (v.paused) v.play();
          else v.pause();
        }}
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
      {inPip && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black text-nndd-subtext">
          <div className="text-sm">ピクチャーインピクチャーで再生中</div>
          <button
            type="button"
            onClick={() => { void document.exitPictureInPicture().catch(() => {}); }}
            className="px-3 py-1 text-xs rounded border border-nndd-border hover:text-nndd-text"
          >
            ここに戻す
          </button>
        </div>
      )}
    </div>
  );
});
