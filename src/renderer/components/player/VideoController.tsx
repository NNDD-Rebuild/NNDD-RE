import { useEffect, useRef, useState } from 'react';
import type { DomandStreamCandidate } from '@shared/types';
import { useConfig } from '@renderer/hooks/useConfig';

interface Props {
  video: HTMLVideoElement | null;
  /** 現在Document Picture-in-Picture中かどうか (VideoPlayer の onPipChange で更新した値を渡す) */
  docPipActive?: boolean;
  /** Document Picture-in-Picture の開始/終了 (VideoPlayerHandle.togglePip を呼ぶ) */
  onToggleDocPip?: () => void;
  showComments: boolean;
  onToggleComments: () => void;
  onToggleFullscreen?: () => void;
  hideCommentToggle?: boolean;
  canSkipPrev?: boolean;
  canSkipNext?: boolean;
  onSkipPrev?: () => void;
  onSkipNext?: () => void;
  availableQualities?: DomandStreamCandidate[];
  currentQualityId?: string;
  onQualityChange?: (id: string) => void;
  audioOnly?: boolean;
}

/**
 * 動画再生コントロールバー。
 * 元: VideoController.mxml
 *  - 再生/一時停止
 *  - シークバー (バッファインジケーター付き)
 *  - 現在時間 / 全時間
 *  - 音量バー
 *  - 速度: 1.0 / 1.5 / 2.0
 *  - フルスクリーン
 *  - コメント表示切替
 */
export function VideoController({
  video,
  docPipActive,
  onToggleDocPip,
  showComments,
  onToggleComments,
  onToggleFullscreen,
  hideCommentToggle,
  canSkipPrev,
  canSkipNext,
  onSkipPrev,
  onSkipNext,
  availableQualities,
  currentQualityId,
  onQualityChange,
  audioOnly
}: Props): JSX.Element {
  const [uiSize] = useConfig<'small' | 'normal' | 'large'>('player.controlUiSize', 'small');
  const zoomFactor = uiSize === 'large' ? 1.5 : uiSize === 'normal' ? 1.3 : 1;

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const seekingRef = useRef(false);
  const seekBarRef = useRef<HTMLDivElement>(null);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1.0);
  const [inPip, setInPip] = useState(false);
  const docPipSupported = typeof window !== 'undefined' && 'documentPictureInPicture' in window;
  const pipSupported =
    docPipSupported || (typeof document !== 'undefined' && document.pictureInPictureEnabled);
  const [volumeNormalize] = useConfig<boolean>('player.volumeNormalize', false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const compressorRef = useRef<DynamicsCompressorNode | null>(null);
  const connectedVideoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!video) return;
    const onTime = (): void => {
      if (!seekingRef.current) setCurrentTime(video.currentTime);
    };
    const onDur = (): void => setDuration(video.duration);
    const onPlay = (): void => setPlaying(true);
    const onPause = (): void => setPlaying(false);
    const onVol = (): void => {
      setVolume(video.volume);
      setMuted(video.muted);
    };
    const onRate = (): void => setRate(video.playbackRate);
    const onProgress = (): void => {
      if (!video.buffered.length) return;
      setBufferedEnd(video.buffered.end(video.buffered.length - 1));
    };
    video.addEventListener('timeupdate', onTime);
    video.addEventListener('durationchange', onDur);
    video.addEventListener('loadedmetadata', onDur);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('volumechange', onVol);
    video.addEventListener('ratechange', onRate);
    video.addEventListener('progress', onProgress);
    const onEnterPip = (): void => setInPip(true);
    const onLeavePip = (): void => setInPip(false);
    video.addEventListener('enterpictureinpicture', onEnterPip);
    video.addEventListener('leavepictureinpicture', onLeavePip);
    setPlaying(!video.paused);
    onDur();
    onVol();
    onRate();
    return () => {
      video.removeEventListener('timeupdate', onTime);
      video.removeEventListener('durationchange', onDur);
      video.removeEventListener('loadedmetadata', onDur);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('volumechange', onVol);
      video.removeEventListener('ratechange', onRate);
      video.removeEventListener('progress', onProgress);
      video.removeEventListener('enterpictureinpicture', onEnterPip);
      video.removeEventListener('leavepictureinpicture', onLeavePip);
    };
  }, [video]);

  // 音量ノーマライズ: DynamicsCompressorNode を挟むかどうかをルーティングで切替。
  // MediaElementAudioSourceNode は同一 video 要素に対して一度しか作成できないため、
  // 初回接続時に作成し、以降は ON/OFF で source→destination / source→compressor→destination の
  // 経路を切り替えるだけにする (作り直すと動画によっては無音になる)。
  // ローカル再生 (ループバックHTTP配信) は video 側に crossOrigin が無いと Web Audio に
  // タップした時点で CORS tainted 扱いになり無音化するため、機能OFF時は
  // そもそも Web Audio に一切タップしない (ネイティブ出力のまま)。
  useEffect(() => {
    if (!video) return;
    const alreadyConnected = connectedVideoRef.current === video;
    if (!volumeNormalize && !alreadyConnected) return;
    if (!alreadyConnected) {
      try {
        const ctx = audioCtxRef.current ?? new AudioContext();
        audioCtxRef.current = ctx;
        const source = ctx.createMediaElementSource(video);
        const compressor = ctx.createDynamicsCompressor();
        compressor.threshold.value = -24;
        compressor.knee.value = 30;
        compressor.ratio.value = 6;
        compressor.attack.value = 0.02;
        compressor.release.value = 0.25;
        sourceNodeRef.current = source;
        compressorRef.current = compressor;
        connectedVideoRef.current = video;
      } catch (e) {
        console.warn('volume normalize: audio graph setup failed:', e);
        return;
      }
    }
    const ctx = audioCtxRef.current;
    const source = sourceNodeRef.current;
    const compressor = compressorRef.current;
    if (!ctx || !source || !compressor) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => undefined);
    source.disconnect();
    compressor.disconnect();
    if (volumeNormalize) {
      source.connect(compressor);
      compressor.connect(ctx.destination);
    } else {
      source.connect(ctx.destination);
    }
  }, [video, volumeNormalize]);

  const togglePlay = (): void => {
    if (!video) return;
    if (video.paused) video.play();
    else video.pause();
  };

  const seek = (sec: number): void => {
    if (!video) return;
    video.currentTime = Math.max(0, Math.min(sec, video.duration || sec));
  };

  const changeVolume = (v: number): void => {
    if (!video) return;
    video.volume = Math.max(0, Math.min(1, v));
    if (v > 0 && video.muted) video.muted = false;
  };

  const toggleMute = (): void => {
    if (!video) return;
    video.muted = !video.muted;
  };

  const changeRate = (r: number): void => {
    if (!video) return;
    video.playbackRate = r;
  };

  // 標準 video Picture-in-Picture (コメント非対応環境向けフォールバック)
  const toggleStandardPip = async (): Promise<void> => {
    if (!video) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await video.requestPictureInPicture();
      }
    } catch (e) {
      console.warn('Picture-in-Picture failed:', e);
    }
  };

  const togglePip = (): void => {
    if (docPipSupported && onToggleDocPip) {
      onToggleDocPip();
      return;
    }
    toggleStandardPip().catch(console.error);
  };

  const displayInPip = docPipSupported && onToggleDocPip ? !!docPipActive : inPip;

  return (
    <div
      className="flex items-center gap-2 px-2 py-1 bg-nndd-panel border-t border-nndd-border text-xs select-none"
      style={{ zoom: zoomFactor }}
    >
      <Btn onClick={togglePlay} title="再生/一時停止">
        {playing ? '❚❚' : '▶'}
      </Btn>

      {isFinite(duration) && duration > 0 ? (
        <div
          ref={seekBarRef}
          className="flex-1 relative h-5 cursor-pointer flex items-center group"
          onPointerDown={(e) => {
            seekingRef.current = true;
            (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
            const pct = getPointerPct(e, seekBarRef.current!);
            setCurrentTime(pct * duration);
          }}
          onPointerMove={(e) => {
            if (!seekingRef.current) return;
            const pct = getPointerPct(e, seekBarRef.current!);
            setCurrentTime(pct * duration);
          }}
          onPointerUp={(e) => {
            if (!seekingRef.current) return;
            const pct = getPointerPct(e, seekBarRef.current!);
            const v = pct * duration;
            seek(v);
            setCurrentTime(v);
            if (video) {
              const tid = window.setTimeout(() => { seekingRef.current = false; }, 1000);
              video.addEventListener('seeked', () => {
                window.clearTimeout(tid);
                seekingRef.current = false;
              }, { once: true });
            } else {
              seekingRef.current = false;
            }
          }}
        >
          {/* トラック背景 + バー群 */}
          <div className="w-full h-1.5 bg-nndd-border/50 rounded-full relative overflow-hidden">
            {/* バッファインジケーター */}
            <div
              className="absolute inset-y-0 left-0 bg-nndd-subtext/50 rounded-full"
              style={{ width: `${Math.min(100, (bufferedEnd / duration) * 100)}%` }}
            />
            {/* 再生済みバー */}
            <div
              className="absolute inset-y-0 left-0 bg-nndd-accent rounded-full"
              style={{ width: `${Math.min(100, (currentTime / duration) * 100)}%` }}
            />
          </div>
          {/* サムネイルつまみ */}
          <div
            className="absolute w-3 h-3 bg-nndd-text rounded-full shadow pointer-events-none -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ left: `${Math.min(100, (currentTime / duration) * 100)}%` }}
          />
        </div>
      ) : (
        /* ストリーミング中: durationが不定のため進捗バーで代替 */
        <div className="flex-1 h-2 bg-nndd-border rounded overflow-hidden">
          <div
            className="h-full bg-blue-500 transition-all duration-300"
            style={{ width: `${Math.min(99, (currentTime / 300) * 100)}%` }}
          />
        </div>
      )}

      <span className="font-mono">
        {fmt(currentTime)} / {isFinite(duration) && duration > 0 ? fmt(duration) : '...'}
      </span>

      {(canSkipPrev != null || canSkipNext != null) && (
        <>
          <Btn
            onClick={onSkipPrev}
            disabled={!canSkipPrev}
            title="前の動画 (Shift+P)"
            className={!canSkipPrev ? 'opacity-50 cursor-not-allowed' : ''}
          >
            ◄
          </Btn>
          <Btn
            onClick={onSkipNext}
            disabled={!canSkipNext}
            title="次の動画 (Shift+N)"
            className={!canSkipNext ? 'opacity-50 cursor-not-allowed' : ''}
          >
            ►
          </Btn>
        </>
      )}

      <Btn onClick={toggleMute} title={muted ? 'ミュート解除' : 'ミュート'}>
        {muted || volume === 0 ? '🔇' : '🔊'}
      </Btn>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={muted ? 0 : volume}
        onChange={(e) => changeVolume(Number(e.target.value))}
        className="w-20"
      />

      {!audioOnly && availableQualities && availableQualities.length >= 2 && onQualityChange && (
        <select
          value={currentQualityId ?? ''}
          onChange={(e) => onQualityChange(e.target.value)}
          className="bg-nndd-border text-white text-sm rounded px-1 py-0.5 cursor-pointer"
        >
          {availableQualities.map((q) => (
            <option key={q.id} value={q.id}>
              {q.height ? `${q.height}p` : (q.id.match(/(\d+p)$/)?.[1] ?? q.id)}
            </option>
          ))}
        </select>
      )}

      <select
        value={rate}
        onChange={(e) => changeRate(Number(e.target.value))}
        className="bg-nndd-border text-white text-sm rounded px-1 py-0.5 cursor-pointer"
      >
        {[0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0].map((r) => (
          <option key={r} value={r}>
            {r.toFixed(2).replace(/\.?0+$/, '')}x
          </option>
        ))}
      </select>

      {!hideCommentToggle && (
        <Btn
          onClick={onToggleComments}
          title={showComments ? 'コメント非表示' : 'コメント表示'}
        >
          {showComments ? '💬 ON' : '💬 OFF'}
        </Btn>
      )}

      {!audioOnly && pipSupported && (
        <Btn
          onClick={togglePip}
          title={docPipSupported && onToggleDocPip ? 'ミニプレイヤー (コメント表示対応)' : 'ミニプレイヤー (Picture-in-Picture)'}
        >
          {displayInPip ? '🗗' : '🗖'}
        </Btn>
      )}

      {onToggleFullscreen && (
        <Btn onClick={onToggleFullscreen} title="フルスクリーン">
          ⛶
        </Btn>
      )}
    </div>
  );
}

function getPointerPct(e: React.PointerEvent, el: HTMLElement): number {
  const rect = el.getBoundingClientRect();
  return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
}

function Btn(props: React.ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element {
  return (
    <button
      {...props}
      className={[
        'px-2 py-0.5 bg-nndd-border hover:bg-nndd-accent rounded',
        props.className ?? ''
      ].join(' ')}
    />
  );
}

function fmt(sec: number): string {
  if (!sec || !isFinite(sec)) return '0:00';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}
