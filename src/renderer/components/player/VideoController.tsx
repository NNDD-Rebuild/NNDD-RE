import { useEffect, useRef, useState } from 'react';
import type { DomandStreamCandidate } from '@shared/types';
import { useConfig } from '@renderer/hooks/useConfig';
import { ControlBarSelect } from './ControlBarSelect';

const PLAYBACK_RATE_OPTIONS = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0] as const;

// Linuxのみカスタムドロップダウンに置き換える。ネイティブ<select>は全画面時に
// 展開方向をJS/CSSから制御できず、Linux(Wayland)環境で選択肢が画面外にはみ出す
// 問題があったため。Windows/macOSではネイティブselectのまま既存動作を維持する。
const isLinux = window.electron?.process?.platform === 'linux';

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
  /** ローカル再生中か (true の場合のみシークバーホバー時のサムネイルプレビューを有効化) */
  isLocal?: boolean;
  /**
   * 生放送 (放送中) 用の表示。指定すると時間表示を「LIVE / -m:ss」にし、「最新」ボタンを出す。
   * chasePlay=true (追っかけ再生) ならシークバーを video.seekable の範囲で表示する
   */
  live?: { chasePlay: boolean; onSeekToLive: () => void };
  /** 再生速度の選択を隠す (生放送用) */
  hideRateSelect?: boolean;
  /** ミニプレイヤー (Picture-in-Picture) ボタンを隠す (生放送用) */
  hidePip?: boolean;
  /** 時間表示の後ろに出す補足 (例: コメント取得中) */
  statusText?: string;
  /** 全画面ボタンの前に追加するボタン等 */
  extraButtons?: React.ReactNode;
  /** 画質の表示名 (省略時は解像度から作る) */
  formatQualityLabel?: (q: DomandStreamCandidate) => string;
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
  audioOnly,
  isLocal,
  live,
  hideRateSelect,
  hidePip,
  statusText,
  extraButtons,
  formatQualityLabel
}: Props): JSX.Element {
  const [uiSize] = useConfig<'small' | 'normal' | 'large'>('player.controlUiSize', 'small');
  const zoomFactor = uiSize === 'large' ? 1.5 : uiSize === 'normal' ? 1.3 : 1;

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  /** 生放送: シーク可能範囲 (video.seekable)。live 指定時はシークバーをこの範囲で描く */
  const [seekStart, setSeekStart] = useState(0);
  const [seekEnd, setSeekEnd] = useState(0);
  const isLiveRef = useRef(Boolean(live));
  isLiveRef.current = Boolean(live);
  const seekingRef = useRef(false);
  const seekBarRef = useRef<HTMLDivElement>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewSeekTimerRef = useRef<number | null>(null);
  const [previewReady, setPreviewReady] = useState(false);
  const [hoverPct, setHoverPct] = useState<number | null>(null);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1.0);
  const [inPip, setInPip] = useState(false);
  const docPipSupported = typeof window !== 'undefined' && 'documentPictureInPicture' in window;
  const pipSupported =
    docPipSupported || (typeof document !== 'undefined' && document.pictureInPictureEnabled);
  const [volumeNormalize] = useConfig<boolean>('player.volumeNormalize', false);
  const [defaultVolume, , defaultVolumeLoading] = useConfig<number>('player.volume', 1);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const compressorRef = useRef<DynamicsCompressorNode | null>(null);
  const connectedVideoRef = useRef<HTMLVideoElement | null>(null);
  const defaultVolumeAppliedRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!video) return;
    const onTime = (): void => {
      if (!seekingRef.current) setCurrentTime(video.currentTime);
      if (isLiveRef.current && video.seekable.length > 0) {
        setSeekStart(video.seekable.start(0));
        setSeekEnd(video.seekable.end(video.seekable.length - 1));
      }
    };
    const onDur = (): void => {
      setDuration(video.duration);
      // シークバーホバー時のサムネイルプレビュー: ローカル再生時のみ有効
      // (ストリーミング再生の src は複製再生できないため対象外)
      const pv = previewVideoRef.current;
      if (pv && isLocal && video.currentSrc) {
        if (pv.src !== video.currentSrc) {
          pv.src = video.currentSrc;
        }
        setPreviewReady(true);
      } else {
        setPreviewReady(false);
      }
    };
    const onPlay = (): void => setPlaying(true);
    const onPause = (): void => setPlaying(false);
    const onVol = (): void => {
      setVolume(video.volume);
      setMuted(video.muted);
    };
    const onRate = (): void => setRate(video.playbackRate);
    // 動画切替時 (同一 <video> 要素を使い回し src だけ差し替え) は毎回等倍に戻す。
    // ブラウザの暗黙リセットは ratechange が発火せず UI (rate state) に反映されないため、
    // loadedmetadata のタイミングで明示的に 1.0 を適用して実速度・UI 双方を揃える。
    const onLoadedMetaRate = (): void => {
      if (video.playbackRate !== 1.0) {
        video.playbackRate = 1.0;
      }
      // 前の動画でシークバーを pointerdown したまま (ドラッグ中に別操作へ移る等で)
      // pointerup が届かず seekingRef.current=true が残留していると、動画切替後に
      // シークバー要素が duration 確定で再マウントされた際、ブラウザが取りこぼしていた
      // pointerup をその新要素へ配信し、誤って座標0(=0秒)へseekしてしまうことがある。
      // 新しい動画がロードされたら必ずシーク状態をリセットして防ぐ。
      seekingRef.current = false;
    };
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
    video.addEventListener('loadedmetadata', onLoadedMetaRate);
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
      video.removeEventListener('loadedmetadata', onLoadedMetaRate);
      video.removeEventListener('progress', onProgress);
      video.removeEventListener('enterpictureinpicture', onEnterPip);
      video.removeEventListener('leavepictureinpicture', onLeavePip);
    };
  }, [video, isLocal]);

  // 設定「デフォルト音量」を初回のみ適用 (video要素は再生毎に使い回されるため、
  // 同一要素へ二重適用してユーザーが手動調整した音量を上書きしないよう要素単位でガードする)。
  useEffect(() => {
    if (!video || defaultVolumeLoading) return;
    if (defaultVolumeAppliedRef.current === video) return;
    defaultVolumeAppliedRef.current = video;
    video.volume = Math.max(0, Math.min(1, defaultVolume));
  }, [video, defaultVolume, defaultVolumeLoading]);

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

  // プレビュー用の非表示video: シーク完了/フレームロードごとにcanvasへ描画
  useEffect(() => {
    const pv = previewVideoRef.current;
    const cv = previewCanvasRef.current;
    if (!pv || !cv) return;
    const draw = (): void => {
      const ctx = cv.getContext('2d');
      if (!ctx || !pv.videoWidth) return;
      ctx.drawImage(pv, 0, 0, cv.width, cv.height);
    };
    const onSeeked = (): void => draw();
    const onLoadedData = (): void => draw();
    pv.addEventListener('seeked', onSeeked);
    pv.addEventListener('loadeddata', onLoadedData);
    return () => {
      pv.removeEventListener('seeked', onSeeked);
      pv.removeEventListener('loadeddata', onLoadedData);
    };
    // canvas はシークバー (duration > 0 の時のみレンダリング) の中にあるため、
    // duration 確定 (0→実値) のタイミングで cv が初めて存在するようになる。
    // 依存配列を [] のままだとマウント直後 (cv=null) の1回で空振りし、
    // 以後リスナーが一切登録されない (実際に発生していたバグ)。
  }, [duration]);

  // 直近でシークをリクエストした時刻 (同じ位置への再シークを省いて無駄な描画待ちを減らす)
  const lastPreviewSeekRef = useRef<number | null>(null);

  // シークバー上のホバー位置に応じてプレビュー時刻を更新 (連続シークを避けるため軽くデバウンス)
  const updatePreviewHover = (e: React.PointerEvent): void => {
    if (!previewReady || !duration) return;
    const pct = getPointerPct(e, seekBarRef.current!);
    setHoverPct(pct);
    const pv = previewVideoRef.current;
    if (!pv) return;
    const t = pct * duration;
    // 0.5秒未満の移動は同じフレーム扱いとしてシークをスキップ (体感の滑らかさを優先)
    if (lastPreviewSeekRef.current !== null && Math.abs(lastPreviewSeekRef.current - t) < 0.5) {
      return;
    }
    if (previewSeekTimerRef.current) window.clearTimeout(previewSeekTimerRef.current);
    previewSeekTimerRef.current = window.setTimeout(() => {
      lastPreviewSeekRef.current = t;
      if (pv.readyState < 1) {
        // メタデータ未ロード: ロード完了を待ってからシーク
        pv.addEventListener('loadedmetadata', () => { pv.currentTime = t; }, { once: true });
      } else {
        pv.currentTime = t;
      }
    }, 40);
  };

  const togglePlay = (): void => {
    if (!video) return;
    if (video.paused) video.play();
    else video.pause();
  };

  const seek = (sec: number): void => {
    if (!video) return;
    // ニコニコDomand配信のHLSは先頭セグメントがopen-GOP構造 (IDRキーフレーム無し) の
    // ことがあり、0秒ちょうどへシークするとhls.jsがバッファを組み立てられず再生が
    // 止まったままになることがある (hls.js issue #7774)。ストリーミング再生時のみ
    // 0秒付近への着地をわずかにずらして、壊れた先頭セグメントとの一致を避ける。
    const target = !isLocal && sec < 0.1 ? 0.1 : sec;
    video.currentTime = Math.max(0, Math.min(target, video.duration || target));
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

  // シークバーの範囲: 通常は 0〜duration、生放送 (追っかけ再生) はシーク可能範囲
  const barStart = live ? seekStart : 0;
  const barLen = live ? Math.max(0, seekEnd - seekStart) : duration;
  const showBar = live ? live.chasePlay && barLen > 0 : isFinite(duration) && duration > 0;
  const qualityLabel = (q: DomandStreamCandidate): string =>
    formatQualityLabel ? formatQualityLabel(q) : q.height ? `${q.height}p` : (q.id.match(/(\d+p)$/)?.[1] ?? q.id);

  return (
    <div
      className="flex items-center gap-2 px-2 py-1 bg-nndd-panel border-t border-nndd-border text-xs select-none"
      style={{ zoom: zoomFactor }}
    >
      {/* プレビュー描画用の非表示video (常時マウント、画面には出さずcanvasへ描画するだけ) */}
      <video
        ref={previewVideoRef}
        muted
        preload="metadata"
        style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none', top: 0, left: 0 }}
      />

      <Btn onClick={togglePlay} title="再生/一時停止">
        {playing ? '❚❚' : '▶'}
      </Btn>

      {showBar ? (
        <div
          ref={seekBarRef}
          className="flex-1 relative h-5 cursor-pointer flex items-center group"
          onPointerDown={(e) => {
            seekingRef.current = true;
            (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
            const pct = getPointerPct(e, seekBarRef.current!);
            setCurrentTime(barStart + pct * barLen);
            updatePreviewHover(e);
          }}
          onPointerMove={(e) => {
            updatePreviewHover(e);
            if (!seekingRef.current) return;
            const pct = getPointerPct(e, seekBarRef.current!);
            setCurrentTime(barStart + pct * barLen);
          }}
          onPointerUp={(e) => {
            if (!seekingRef.current) return;
            // 要素の再マウント等でポインタキャプチャが失われた後に、取りこぼされた
            // pointerup がブラウザから配信された場合の誤seekを防ぐ二重ガード
            if (!(e.currentTarget as HTMLDivElement).hasPointerCapture(e.pointerId)) {
              seekingRef.current = false;
              return;
            }
            const pct = getPointerPct(e, seekBarRef.current!);
            const v = barStart + pct * barLen;
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
          onPointerLeave={() => setHoverPct(null)}
        >
          {/* トラック背景 + バー群 */}
          <div className="w-full h-1.5 bg-nndd-border/50 rounded-full relative overflow-hidden">
            {/* バッファインジケーター */}
            <div
              className="absolute inset-y-0 left-0 bg-nndd-subtext/50 rounded-full"
              style={{ width: `${Math.min(100, ((bufferedEnd - barStart) / barLen) * 100)}%` }}
            />
            {/* 再生済みバー */}
            <div
              className="absolute inset-y-0 left-0 bg-nndd-accent rounded-full"
              style={{ width: `${Math.min(100, ((currentTime - barStart) / barLen) * 100)}%` }}
            />
          </div>
          {/* サムネイルつまみ */}
          <div
            className="absolute w-3 h-3 bg-nndd-text rounded-full shadow pointer-events-none -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ left: `${Math.min(100, ((currentTime - barStart) / barLen) * 100)}%` }}
          />
          {/* ホバー時サムネイルプレビュー (ローカル再生のみ)。
              canvas は常時マウントし表示/非表示は opacity で切替える
              (条件付きレンダリングにすると canvas 出現前に登録した
              seeked リスナーが ref=null のまま失われ、描画されなくなるため) */}
          <div
            className="absolute bottom-6 -translate-x-1/2 bg-black border border-nndd-border rounded overflow-hidden shadow-lg pointer-events-none z-10 transition-opacity"
            style={{
              left: `${Math.min(100, Math.max(0, (hoverPct ?? 0) * 100))}%`,
              opacity: previewReady && hoverPct !== null ? 1 : 0
            }}
          >
            <canvas ref={previewCanvasRef} width={160} height={90} className="block" />
            <div className="text-center text-[10px] text-white py-0.5 bg-black/70 font-mono">
              {fmt((hoverPct ?? 0) * duration)}
            </div>
          </div>
        </div>
      ) : live ? (
        /* 生放送 (追っかけ再生なし): シークできないのでバーは出さない */
        <div className="flex-1" />
      ) : (
        /* ストリーミング中: durationが不定のため進捗バーで代替 */
        <div className="flex-1 h-2 bg-nndd-border rounded overflow-hidden">
          <div
            className="h-full bg-blue-500 transition-all duration-300"
            style={{ width: `${Math.min(99, (currentTime / 300) * 100)}%` }}
          />
        </div>
      )}

      {live ? (
        <>
          <span className="font-mono">
            {seekEnd - currentTime > 5 ? `-${fmt(seekEnd - currentTime)}` : 'LIVE'}
          </span>
          <Btn onClick={live.onSeekToLive} title="最新の位置へ">
            最新
          </Btn>
        </>
      ) : (
        <span className="font-mono">
          {fmt(currentTime)} / {isFinite(duration) && duration > 0 ? fmt(duration) : '...'}
        </span>
      )}
      {statusText && <span className="text-nndd-subtext whitespace-nowrap">{statusText}</span>}

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
        isLinux ? (
          <ControlBarSelect
            value={currentQualityId ?? ''}
            options={availableQualities.map((q) => ({
              value: q.id,
              label: qualityLabel(q)
            }))}
            onChange={onQualityChange}
            title="画質"
          />
        ) : (
          <select
            value={currentQualityId ?? ''}
            onChange={(e) => onQualityChange(e.target.value)}
            className="bg-nndd-border text-white text-sm rounded px-1 py-0.5 cursor-pointer"
          >
            {availableQualities.map((q) => (
              <option key={q.id} value={q.id}>
                {qualityLabel(q)}
              </option>
            ))}
          </select>
        )
      )}

      {hideRateSelect ? null : isLinux ? (
        <ControlBarSelect
          value={String(rate)}
          options={PLAYBACK_RATE_OPTIONS.map((r) => ({
            value: String(r),
            label: `${r.toFixed(2).replace(/\.?0+$/, '')}x`
          }))}
          onChange={(v) => changeRate(Number(v))}
          title="再生速度"
        />
      ) : (
        <select
          value={rate}
          onChange={(e) => changeRate(Number(e.target.value))}
          className="bg-nndd-border text-white text-sm rounded px-1 py-0.5 cursor-pointer"
        >
          {PLAYBACK_RATE_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {r.toFixed(2).replace(/\.?0+$/, '')}x
            </option>
          ))}
        </select>
      )}

      {!hideCommentToggle && (
        <Btn
          onClick={onToggleComments}
          title={showComments ? 'コメント非表示' : 'コメント表示'}
        >
          {showComments ? '💬 ON' : '💬 OFF'}
        </Btn>
      )}

      {!audioOnly && pipSupported && !hidePip && (
        <Btn
          onClick={togglePip}
          title={docPipSupported && onToggleDocPip ? 'ミニプレイヤー (コメント表示対応)' : 'ミニプレイヤー (Picture-in-Picture)'}
        >
          {displayInPip ? '🗗' : '🗖'}
        </Btn>
      )}

      {extraButtons}

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
