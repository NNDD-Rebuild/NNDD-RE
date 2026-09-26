import { useCallback, useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import type {
  LiveConnectionState,
  LiveEvent,
  LiveNotice,
  LiveProgramInfo,
  LiveStartResult,
  LiveStatistics,
  NNDDREComment
} from '@shared/types';
import { IpcChannel } from '@shared/types';
import { CommentRenderer, DEFAULT_RENDER_CONFIG } from './components/player/CommentRenderer';
import { useConfig } from './hooks/useConfig';

/** コメントリストに表示する行 */
type ListRow =
  | { kind: 'comment'; key: string; comment: NNDDREComment }
  | { kind: 'notice'; key: string; notice: LiveNotice };

/** コメントリストの保持件数 */
const LIST_LIMIT = 500;
/**
 * 届いた時点で表示位置を過ぎているコメントを「今」に寄せる許容幅 (ms)。
 * これより古いもの (接続直後に読む直前区間等) は元の位置のまま = 画面には流さない。
 */
const LATE_COMMENT_WINDOW_MS = 10_000;
/** niconicomments の流れコメントは vpos の 1 秒前に右端から出現する */
const NAKA_LEAD_MS = 1000;

const QUALITY_LABELS: Record<string, string> = {
  abr: '自動',
  super_high: '超高画質',
  high: '高画質',
  normal: '標準',
  low: '低画質',
  super_low: '最低画質',
  audio_high: '音声のみ (高音質)',
  audio_only: '音声のみ'
};

const STATE_LABELS: Record<LiveConnectionState, string> = {
  connecting: '接続中',
  watching: '視聴中',
  reconnecting: '再接続中',
  ended: '終了',
  error: 'エラー'
};

/** IPC 経由のエラーは "Error invoking remote method '...': Error: 本文" になるので本文だけ取り出す */
function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '');
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

function formatElapsed(ms: number): string {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * ニコニコ生放送プレイヤー (live-player.html)。
 * 番組ID はクエリ `?programId=lv...` で受け取り、main の LiveSession から
 * LIVE_EVENT で HLS URL・コメント・統計等を受け取る。
 */
export default function LivePlayerApp(): JSX.Element {
  const programId = new URLSearchParams(location.search).get('programId') ?? '';

  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const rendererRef = useRef<CommentRenderer | null>(null);
  const programRef = useRef<LiveProgramInfo | null>(null);
  const autoScrollRef = useRef(true);
  const rowSeq = useRef(0);
  /**
   * 今映っている映像の vpos (1/100秒)。
   * HLS に EXT-X-PROGRAM-DATE-TIME があれば playingDate、無ければ現在時刻からライブ遅延を引いて推定し、
   * 番組の vpos 基準時刻との差を取る
   */
  const currentVposRef = useRef((): number => {
    const base = programRef.current?.vposBaseTimeMs ?? 0;
    if (!base) return 0;
    const hls = hlsRef.current;
    const playingMs = hls?.playingDate?.getTime() ?? Date.now() - (hls?.latency ?? 0) * 1000;
    return (playingMs - base) / 10;
  });

  const [program, setProgram] = useState<LiveProgramInfo | null>(null);
  const [state, setState] = useState<LiveConnectionState>('connecting');
  const [stateMessage, setStateMessage] = useState('');
  const [statistics, setStatistics] = useState<LiveStatistics | null>(null);
  const [operatorComment, setOperatorComment] = useState<LiveNotice | null>(null);
  const [rows, setRows] = useState<ListRow[]>([]);
  const [quality, setQuality] = useState('abr');
  const [qualities, setQualities] = useState<string[]>([]);
  const [streamUri, setStreamUri] = useState('');
  const [paused, setPaused] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [showComments, setShowComments] = useState(true);
  const [volume, setVolume] = useConfig<number>('player.volume', 1);
  const [muted, setMuted] = useState(false);

  const appendRows = useCallback((added: ListRow[]) => {
    setRows((prev) => {
      const merged = [...prev, ...added];
      return merged.length > LIST_LIMIT ? merged.slice(merged.length - LIST_LIMIT) : merged;
    });
  }, []);

  // ---- LiveEvent 受信 ----
  useEffect(() => {
    const off = window.nndd.on(IpcChannel.LIVE_EVENT, (...args: unknown[]) => {
      const ev = args[0] as LiveEvent;
      switch (ev.type) {
        case 'state':
          setState(ev.state);
          setStateMessage(ev.message ?? '');
          break;
        case 'stream':
          setStreamUri(ev.uri);
          setQuality(ev.quality);
          if (ev.availableQualities.length > 0) setQualities(ev.availableQualities);
          break;
        case 'comments': {
          // コメントサーバーからの到着は投稿時刻より遅れるため、そのまま渡すと
          // 「既に流れ始めていたはずの位置」= 画面の途中から出現する。
          // 既に出現済みのはずのものは、出現時刻 (vpos - 1秒) が今になるよう寄せて右端から流す
          const appearMs = currentVposRef.current() * 10 + NAKA_LEAD_MS;
          const adjusted = ev.comments.map((c) =>
            c.vposMs < appearMs && appearMs - c.vposMs <= LATE_COMMENT_WINDOW_MS
              ? { ...c, vposMs: Math.ceil(appearMs) }
              : c
          );
          rendererRef.current?.addComments(adjusted);
          appendRows(
            ev.comments.map((c) => ({ kind: 'comment', key: `c${rowSeq.current++}`, comment: c }))
          );
          break;
        }
        case 'notice':
          appendRows([{ kind: 'notice', key: `n${rowSeq.current++}`, notice: ev.notice }]);
          break;
        case 'statistics':
          setStatistics(ev.statistics);
          break;
        case 'operatorComment':
          setOperatorComment(ev.notice);
          break;
      }
    });
    return off;
  }, [appendRows]);

  // ---- 視聴開始 ----
  useEffect(() => {
    if (!programId) {
      setState('error');
      setStateMessage('番組IDが指定されていません。');
      return;
    }
    let cancelled = false;
    window.nndd
      .invoke<LiveStartResult>(IpcChannel.LIVE_START, programId)
      .then((r) => {
        if (cancelled) return;
        programRef.current = r.program;
        setProgram(r.program);
        document.title = `${r.program.title} - NNDD-RE Live`;
      })
      .catch((e) => {
        if (cancelled) return;
        setState('error');
        setStateMessage(errorText(e));
      });
    return () => {
      cancelled = true;
      void window.nndd.invoke(IpcChannel.LIVE_STOP).catch(() => {});
    };
  }, [programId]);

  // ---- HLS 再生 ----
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !streamUri) return;
    if (!Hls.isSupported()) {
      video.src = streamUri;
      void video.play().catch(() => {});
      return;
    }
    const hls = new Hls({ lowLatencyMode: true, enableWorker: true });
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
  }, [streamUri]);

  // ---- 音量 ----
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = Math.max(0, Math.min(1, volume));
    video.muted = muted;
  }, [volume, muted]);

  // ---- コメント描画 ----
  useEffect(() => {
    const container = overlayRef.current;
    const video = videoRef.current;
    if (!container || !video) return;
    const renderer = new CommentRenderer(container);
    renderer.setConfig({ ...DEFAULT_RENDER_CONFIG, keepCA: false });
    renderer.setVposProvider(() => currentVposRef.current());
    rendererRef.current = renderer;

    let started = false;
    let resizeTimer: number | null = null;
    const resize = (): void => {
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      if (!started) {
        started = true;
        requestAnimationFrame(() => {
          renderer.onResize(rect.width, rect.height);
          renderer.start(video);
        });
        return;
      }
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => renderer.onResize(rect.width, rect.height), 100);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    return () => {
      ro.disconnect();
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      renderer.stop();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    rendererRef.current?.setConfig({ enabled: showComments });
  }, [showComments]);

  // ---- 経過時間表示 ----
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  // ---- コメントリストの自動スクロール ----
  useEffect(() => {
    const el = listRef.current;
    if (el && autoScrollRef.current) el.scrollTop = el.scrollHeight;
  }, [rows]);

  const onListScroll = (): void => {
    const el = listRef.current;
    if (!el) return;
    autoScrollRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  const togglePlay = (): void => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => {});
    else video.pause();
  };

  /** ライブの最新位置へ移動 */
  const seekToLive = (): void => {
    const video = videoRef.current;
    const pos = hlsRef.current?.liveSyncPosition;
    if (video && pos != null) video.currentTime = pos;
    if (video?.paused) void video.play().catch(() => {});
  };

  const changeQuality = (q: string): void => {
    setQuality(q);
    void window.nndd.invoke(IpcChannel.LIVE_CHANGE_QUALITY, q).catch(() => {});
  };

  const toggleFullscreen = (): void => {
    const el = videoRef.current?.parentElement;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen();
  };

  const elapsed = program ? formatElapsed(now - program.beginTimeMs) : '';
  const stateColor =
    state === 'watching' ? 'bg-red-600' : state === 'error' ? 'bg-yellow-700' : 'bg-neutral-600';

  return (
    <div className="flex flex-col h-screen bg-black text-white select-none">
      {/* ヘッダー */}
      <div className="flex items-center gap-3 px-3 py-1.5 bg-neutral-900 border-b border-neutral-800 text-sm">
        <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${stateColor}`}>
          {state === 'watching' ? 'LIVE' : STATE_LABELS[state]}
        </span>
        <div className="flex-1 min-w-0">
          <div className="truncate font-bold" title={program?.title}>
            {program?.title ?? programId}
          </div>
          {program?.supplierName && (
            <div className="truncate text-xs text-neutral-400">{program.supplierName}</div>
          )}
        </div>
        {elapsed && <span className="text-xs text-neutral-300 tabular-nums">{elapsed}</span>}
        {statistics && (
          <span className="text-xs text-neutral-300 tabular-nums">
            来場 {statistics.viewers.toLocaleString()} / コメ {statistics.comments.toLocaleString()}
          </span>
        )}
      </div>

      <div className="flex flex-1 min-h-0">
        {/* 映像 + コメント */}
        <div className="flex flex-col flex-1 min-w-0">
          <div className="relative flex-1 min-h-0 bg-black" onDoubleClick={toggleFullscreen}>
            <video
              ref={videoRef}
              className="absolute inset-0 w-full h-full object-contain"
              onPlay={() => setPaused(false)}
              onPause={() => setPaused(true)}
              onClick={togglePlay}
            />
            <div ref={overlayRef} className="absolute inset-0 pointer-events-none" />
            {operatorComment && (
              <div className="absolute top-0 inset-x-0 bg-black/70 text-center text-sm py-1 px-2 pointer-events-auto">
                {operatorComment.link ? (
                  <a href={operatorComment.link} target="_blank" rel="noreferrer" className="underline">
                    {operatorComment.text}
                  </a>
                ) : (
                  operatorComment.text
                )}
              </div>
            )}
            {(state === 'error' || state === 'ended' || (!streamUri && state !== 'watching')) && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="bg-black/70 px-4 py-3 rounded text-sm text-center max-w-md">
                  {stateMessage || STATE_LABELS[state]}
                </div>
              </div>
            )}
          </div>

          {/* コントロールバー */}
          <div className="flex items-center gap-2 px-3 py-1.5 bg-neutral-900 border-t border-neutral-800 text-sm">
            <button onClick={togglePlay} className="w-8 hover:text-neutral-300" title="再生/一時停止">
              {paused ? '▶' : '❚❚'}
            </button>
            <button
              onClick={seekToLive}
              className="px-2 py-0.5 rounded text-xs bg-red-700 hover:bg-red-600"
              title="最新の位置へ"
            >
              最新
            </button>
            <button onClick={() => setMuted((m) => !m)} className="w-6" title="ミュート">
              {muted || volume === 0 ? '🔇' : '🔊'}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={(e) => void setVolume(Number(e.target.value))}
              className="w-24"
            />
            <div className="flex-1" />
            <label className="flex items-center gap-1 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={showComments}
                onChange={(e) => setShowComments(e.target.checked)}
              />
              コメント
            </label>
            {qualities.length > 0 && (
              <select
                value={quality}
                onChange={(e) => changeQuality(e.target.value)}
                className="bg-neutral-800 border border-neutral-700 rounded text-xs px-1 py-0.5"
              >
                {qualities.map((q) => (
                  <option key={q} value={q}>
                    {QUALITY_LABELS[q] ?? q}
                  </option>
                ))}
              </select>
            )}
            <button onClick={toggleFullscreen} className="w-6" title="全画面">
              ⛶
            </button>
          </div>
        </div>

        {/* コメントリスト */}
        <div
          ref={listRef}
          onScroll={onListScroll}
          className="w-80 shrink-0 overflow-y-auto bg-neutral-950 border-l border-neutral-800 text-xs select-text"
        >
          {rows.map((r) =>
            r.kind === 'comment' ? (
              <div
                key={r.key}
                className={`flex gap-2 px-2 py-0.5 border-b border-neutral-900 ${r.comment.isShow ? '' : 'text-neutral-500'}`}
              >
                <span className="shrink-0 w-10 text-right text-neutral-500 tabular-nums">
                  {r.comment.no || ''}
                </span>
                <span className="break-all">{r.comment.text}</span>
              </div>
            ) : (
              <div key={r.key} className="px-2 py-1 border-b border-neutral-900 bg-neutral-900 text-amber-300">
                <span className="text-neutral-500 mr-1">{formatTime(r.notice.at)}</span>
                {r.notice.text}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
