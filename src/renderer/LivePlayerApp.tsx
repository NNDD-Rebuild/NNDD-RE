import { useCallback, useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import type {
  LiveCommentRange,
  LiveConnectionState,
  LiveEvent,
  LiveNotice,
  LiveProgramInfo,
  LiveStartResult,
  LiveStatistics,
  NNDDREComment
} from '@shared/types';
import { CommentPosition, IpcChannel } from '@shared/types';
import { CommentRenderer, DEFAULT_RENDER_CONFIG } from './components/player/CommentRenderer';
import { useConfig } from './hooks/useConfig';
import { LiveCommentList, type LiveListItem } from './components/live/LiveCommentList';

/** コメントリストの並び替え・再描画をまとめる間隔 (ms) */
const LIST_FLUSH_MS = 300;
/**
 * 全件取得中、描画エンジンへ過去コメントを反映する間隔 (ms)。
 * 反映 (setComments) は毎回エンジンの作り直しになるので、取得中は間引いて再生を邪魔しない
 */
const ARCHIVE_APPLY_INTERVAL_MS = 5000;
/** 周辺取得モード: 再生位置の前後この範囲 (ms) のコメントが無ければ取得する */
const AROUND_NEED_BEFORE_MS = 30_000;
const AROUND_NEED_AFTER_MS = 60_000;
/**
 * 届いた時点で表示位置を過ぎているコメントを「今」に寄せる許容幅 (ms)。
 * これより古いもの (接続直後に読む直前区間等) は元の位置のまま = 画面には流さない。
 */
const LATE_COMMENT_WINDOW_MS = 10_000;
/** niconicomments の流れコメントは vpos の 1 秒前に右端から出現する */
const NAKA_LEAD_MS = 1000;
/** 過去コメントと生コメントの重複判定キー (vpos は描画用に調整する前の値) */
function commentKey(c: NNDDREComment): string {
  return `${c.no}-${c.userId}-${c.vposMs}`;
}

/**
 * 生放送コメントの vpos は投稿した瞬間の時刻なので、流れコメントはその時刻に右端から出るのが正しい。
 * niconicomments は vpos の 1 秒前に出現させるため、流れコメントだけ出現時刻分ずらす
 * (ue/shita の固定コメントは vpos ちょうどに表示されるのでそのまま)。
 */
function alignNaka(c: NNDDREComment): NNDDREComment {
  return c.positionCommand === CommentPosition.NAKA ? { ...c, vposMs: c.vposMs + NAKA_LEAD_MS } : c;
}

/** タイムシフト予約・視聴開始が必要なときに main から返るエラーコード (LiveWatchPage.ts) */
const TIMESHIFT_ACTIVATION_REQUIRED = '[TIMESHIFT_ACTIVATION_REQUIRED]';

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
  const hlsRef = useRef<Hls | null>(null);
  const rendererRef = useRef<CommentRenderer | null>(null);
  const programRef = useRef<LiveProgramInfo | null>(null);
  const noticeSeq = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const controlsHideTimer = useRef<number | null>(null);
  const isTimeshiftRef = useRef(false);
  const chasePlayRef = useRef(false);
  /** 受信した生コメント (描画用に調整済み) と、過去コメントとの重複判定キー */
  const liveAddedRef = useRef<NNDDREComment[]>([]);
  const liveKeysRef = useRef(new Set<string>());
  /** 過去コメント (取得順)。描画エンジンへは並べ替えてから渡す */
  const archiveRef = useRef<NNDDREComment[]>([]);
  const archiveFlushTimer = useRef<number | null>(null);
  /** コメントリストの全行 (vposMs 昇順) と重複判定用キー */
  const listItemsRef = useRef<LiveListItem[]>([]);
  const listKeysRef = useRef(new Set<string>());
  const listFlushTimer = useRef<number | null>(null);
  const commentFetchModeRef = useRef<LiveStartResult['commentFetchMode']>('all');
  /** 周辺取得モード: 取得済みの範囲 (vpos ms) と取得中フラグ */
  const loadedRangesRef = useRef<LiveCommentRange[]>([]);
  const aroundFetchingRef = useRef(false);
  /** 視聴開始 (接続) した時刻 (unix ms)。これ以降のコメントは生コメントで届く */
  const connectedAtRef = useRef(0);
  /**
   * 今映っている映像の vpos (1/100秒)。
   * HLS に EXT-X-PROGRAM-DATE-TIME があれば playingDate、無ければ現在時刻からライブ遅延を引いて推定し、
   * 番組の vpos 基準時刻との差を取る
   */
  const currentVposRef = useRef((): number => {
    const base = programRef.current?.vposBaseTimeMs ?? 0;
    const hls = hlsRef.current;
    if (isTimeshiftRef.current) {
      // タイムシフトは VOD なので再生位置 = 番組開始からの経過 (PROGRAM-DATE-TIME があればそれを優先)
      const pd = hls?.playingDate?.getTime();
      if (pd && base) return (pd - base) / 10;
      return (videoRef.current?.currentTime ?? 0) * 100;
    }
    if (!base) return 0;
    const playingMs = hls?.playingDate?.getTime() ?? Date.now() - (hls?.latency ?? 0) * 1000;
    return (playingMs - base) / 10;
  });

  const [program, setProgram] = useState<LiveProgramInfo | null>(null);
  const [state, setState] = useState<LiveConnectionState>('connecting');
  const [stateMessage, setStateMessage] = useState('');
  const [statistics, setStatistics] = useState<LiveStatistics | null>(null);
  const [operatorComment, setOperatorComment] = useState<LiveNotice | null>(null);
  const [listItems, setListItems] = useState<LiveListItem[]>([]);
  /** 再生位置までに含まれるリスト行の件数 */
  const [listIndex, setListIndex] = useState(0);
  const [quality, setQuality] = useState('abr');
  const [qualities, setQualities] = useState<string[]>([]);
  const [streamUri, setStreamUri] = useState('');
  const [paused, setPaused] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [showComments, setShowComments] = useState(true);
  const [volume, setVolume] = useConfig<number>('player.volume', 1);
  const [muted, setMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [isTimeshift, setIsTimeshift] = useState(false);
  const [activationRequired, setActivationRequired] = useState(false);
  const [activating, setActivating] = useState(false);
  /** LIVE_START のやり直し用 (タイムシフト視聴開始後に再接続する) */
  const [startSeq, setStartSeq] = useState(0);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [chasePlay, setChasePlay] = useState(false);
  /** 追っかけ再生時のシーク可能範囲 (秒) */
  const [seekRange, setSeekRange] = useState<{ start: number; end: number } | null>(null);

  /**
   * コメントリストへ行を追加する。過去コメントと生コメントは同じキーになるので重複は自然に除かれる。
   * 並べ替えと再描画は LIST_FLUSH_MS ごとにまとめる
   */
  const addListItems = useCallback((items: LiveListItem[]) => {
    for (const it of items) {
      if (listKeysRef.current.has(it.key)) continue;
      listKeysRef.current.add(it.key);
      listItemsRef.current.push(it);
    }
    if (listFlushTimer.current !== null) return;
    listFlushTimer.current = window.setTimeout(() => {
      listFlushTimer.current = null;
      listItemsRef.current.sort((a, b) => a.vposMs - b.vposMs);
      setListItems([...listItemsRef.current]);
    }, LIST_FLUSH_MS);
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
          const nowMs = currentVposRef.current() * 10;
          const adjusted = ev.comments.map(alignNaka).map((c) => {
            // 出現時刻が今になる vpos (流れコメントは 1 秒前に出現するので +1 秒)
            const appearMs = nowMs + (c.positionCommand === CommentPosition.NAKA ? NAKA_LEAD_MS : 0);
            return c.vposMs < appearMs && appearMs - c.vposMs <= LATE_COMMENT_WINDOW_MS
              ? { ...c, vposMs: Math.ceil(appearMs) }
              : c;
          });
          // 追っかけ再生では過去コメントも保持しているため件数上限で捨てない
          rendererRef.current?.addComments(adjusted, chasePlayRef.current ? Infinity : undefined);
          // 過去コメントとの突き合わせ用に受信分を覚えておく
          liveAddedRef.current.push(...adjusted);
          for (const c of ev.comments) liveKeysRef.current.add(commentKey(c));
          addListItems(ev.comments.map((c) => ({ key: commentKey(c), vposMs: c.vposMs, comment: c })));
          break;
        }
        case 'archiveComments': {
          if (ev.comments.length > 0) archiveRef.current = archiveRef.current.concat(ev.comments);
          if (ev.done) setArchiveLoading(false);
          addListItems(ev.comments.map((c) => ({ key: commentKey(c), vposMs: c.vposMs, comment: c })));
          // ページ毎に届くので、まとめてからエンジンへ渡す (setComments は毎回作り直しになる)
          if (archiveFlushTimer.current !== null) window.clearTimeout(archiveFlushTimer.current);
          archiveFlushTimer.current = window.setTimeout(() => {
            archiveFlushTimer.current = null;
            // 周辺取得では同じ範囲を重ねて取得することがあるので重複を除く
            const unique = new Map(archiveRef.current.map((c) => [commentKey(c), c]));
            const sorted = [...unique.values()].sort((a, b) => a.vposMs - b.vposMs);
            archiveRef.current = sorted;
            if (isTimeshiftRef.current) {
              rendererRef.current?.setComments(sorted.map(alignNaka));
            } else {
              // 放送中: 開いた時点より前のコメント + 受信済みの生コメント (重複は生コメント側を優先)
              const past = sorted.filter((c) => !liveKeysRef.current.has(commentKey(c))).map(alignNaka);
              rendererRef.current?.setComments([...past, ...liveAddedRef.current]);
            }
          }, ev.done ? 0 : commentFetchModeRef.current === 'seek' ? 300 : ARCHIVE_APPLY_INTERVAL_MS);
          break;
        }
        case 'notice': {
          const base = programRef.current?.vposBaseTimeMs ?? 0;
          addListItems([
            {
              key: `n${noticeSeq.current++}`,
              vposMs: base ? ev.notice.at - base : 0,
              notice: ev.notice
            }
          ]);
          break;
        }
        case 'statistics':
          setStatistics(ev.statistics);
          break;
        case 'operatorComment':
          setOperatorComment(ev.notice);
          break;
      }
    });
    return off;
  }, [addListItems]);

  // ---- 視聴開始 ----
  useEffect(() => {
    if (!programId) {
      setState('error');
      setStateMessage('番組IDが指定されていません。');
      return;
    }
    let cancelled = false;
    setActivationRequired(false);
    window.nndd
      .invoke<LiveStartResult>(IpcChannel.LIVE_START, programId)
      .then((r) => {
        if (cancelled) return;
        programRef.current = r.program;
        isTimeshiftRef.current = r.isTimeshift;
        chasePlayRef.current = r.chasePlay;
        setIsTimeshift(r.isTimeshift);
        setChasePlay(r.chasePlay);
        commentFetchModeRef.current = r.commentFetchMode;
        connectedAtRef.current = Date.now();
        // 周辺取得モードは必要になった時点で取得するので、ここでは取得中にしない
        setArchiveLoading(r.commentFetchMode === 'all');
        setProgram(r.program);
        document.title = `${r.program.title} - NNDD-RE Live`;
      })
      .catch((e) => {
        if (cancelled) return;
        const text = errorText(e);
        setState('error');
        if (text.startsWith(TIMESHIFT_ACTIVATION_REQUIRED)) {
          setActivationRequired(true);
          setStateMessage(text.slice(TIMESHIFT_ACTIVATION_REQUIRED.length).trim());
        } else {
          setStateMessage(text);
        }
      });
    return () => {
      cancelled = true;
      void window.nndd.invoke(IpcChannel.LIVE_STOP).catch(() => {});
    };
  }, [programId, startSeq]);

  /** タイムシフトの予約 → 視聴開始 (ユーザーがボタンで確認した後に呼ぶ) */
  const activateTimeshift = async (): Promise<void> => {
    setActivating(true);
    try {
      await window.nndd.invoke(IpcChannel.LIVE_TIMESHIFT_ACTIVATE, programId);
      setState('connecting');
      setStateMessage('');
      setStartSeq((n) => n + 1);
    } catch (e) {
      setStateMessage(errorText(e));
    } finally {
      setActivating(false);
    }
  };

  // ---- HLS 再生 ----
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
    const onSeek = (): void => renderer.onSeek();
    video.addEventListener('seeked', onSeek);
    return () => {
      ro.disconnect();
      video.removeEventListener('seeked', onSeek);
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      renderer.stop();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    rendererRef.current?.setConfig({ enabled: showComments });
  }, [showComments]);

  // ---- 全画面状態の追跡 ----
  useEffect(() => {
    const onChange = (): void => {
      const full = Boolean(document.fullscreenElement);
      setIsFullscreen(full);
      setControlsVisible(true);
      if (!full && controlsHideTimer.current !== null) {
        window.clearTimeout(controlsHideTimer.current);
        controlsHideTimer.current = null;
      }
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // ---- 経過時間表示 ----
  useEffect(() => {
    const t = window.setInterval(() => {
      setNow(Date.now());
      const v = videoRef.current;
      if (chasePlayRef.current && v && v.seekable.length > 0) {
        setSeekRange({ start: v.seekable.start(0), end: v.seekable.end(v.seekable.length - 1) });
      }
    }, 1000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // ---- コメントリストの再生位置 ----
  useEffect(() => {
    const t = window.setInterval(() => {
      const list = listItemsRef.current;
      const nowMs = currentVposRef.current() * 10;
      // vposMs <= nowMs を満たす件数を二分探索
      let lo = 0;
      let hi = list.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (list[mid].vposMs <= nowMs) lo = mid + 1;
        else hi = mid;
      }
      setListIndex(lo);
    }, 500);
    return () => window.clearInterval(t);
  }, []);

  /** コメントリストから指定時刻へシークする (タイムシフト・追っかけ再生のみ) */
  const seekToVpos = (vposMs: number): void => {
    const v = videoRef.current;
    if (!v) return;
    let target = v.currentTime + (vposMs - currentVposRef.current() * 10) / 1000;
    if (v.seekable.length > 0) {
      target = Math.max(v.seekable.start(0), Math.min(v.seekable.end(v.seekable.length - 1), target));
    }
    v.currentTime = target;
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

  /**
   * 全画面はウィンドウ全体 (ルート要素) に対して行い、ヘッダー・コメントリストを隠す。
   * 映像部分だけを全画面にすると、解除後にレイアウトが崩れて映像しか残らないことがあるため
   */
  const toggleFullscreen = (): void => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void rootRef.current?.requestFullscreen().catch(() => {});
  };

  /** 全画面中、マウス操作があったときだけ操作バーを表示する */
  const onPointerActivity = (): void => {
    if (!isFullscreen) return;
    setControlsVisible(true);
    if (controlsHideTimer.current !== null) window.clearTimeout(controlsHideTimer.current);
    controlsHideTimer.current = window.setTimeout(() => setControlsVisible(false), 3000);
  };

  const elapsed = program && !isTimeshift ? formatElapsed(now - program.beginTimeMs) : '';
  const stateColor =
    state === 'watching' ? 'bg-red-600' : state === 'error' ? 'bg-yellow-700' : 'bg-neutral-600';

  return (
    <div
      ref={rootRef}
      onMouseMove={onPointerActivity}
      className="flex flex-col h-screen bg-black text-white select-none"
    >
      {/* ヘッダー */}
      <div
        className={`${isFullscreen ? 'hidden' : 'flex'} items-center gap-3 px-3 py-1.5 bg-neutral-900 border-b border-neutral-800 text-sm`}
      >
        <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${stateColor}`}>
          {state === 'watching' ? (isTimeshift ? 'タイムシフト' : 'LIVE') : STATE_LABELS[state]}
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
        <div className="relative flex flex-col flex-1 min-w-0">
          <div className="relative flex-1 min-h-0 bg-black" onDoubleClick={toggleFullscreen}>
            <video
              ref={videoRef}
              className="absolute inset-0 w-full h-full object-contain"
              onPlay={() => setPaused(false)}
              onPause={() => setPaused(true)}
              onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
              onDurationChange={(e) => setDuration(e.currentTarget.duration)}
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
                <div className="bg-black/70 px-4 py-3 rounded text-sm text-center max-w-md pointer-events-auto">
                  <div>{stateMessage || STATE_LABELS[state]}</div>
                  {activationRequired && (
                    <>
                      <div className="mt-2 text-xs text-neutral-300">
                        視聴を開始すると視聴期限のカウントが始まります (取り消せません)。
                      </div>
                      <button
                        onClick={() => void activateTimeshift()}
                        disabled={activating}
                        className="mt-3 px-3 py-1 rounded bg-red-700 hover:bg-red-600 disabled:opacity-50"
                      >
                        {activating ? '処理中...' : 'タイムシフトを予約して視聴開始'}
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* コントロールバー (全画面中は映像に重ね、操作時のみ表示) */}
          <div
            className={[
              'flex items-center gap-2 px-3 py-1.5 text-sm',
              isFullscreen
                ? `absolute bottom-0 inset-x-0 bg-black/70 transition-opacity ${controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`
                : 'bg-neutral-900 border-t border-neutral-800'
            ].join(' ')}
          >
            <button onClick={togglePlay} className="w-8 hover:text-neutral-300" title="再生/一時停止">
              {paused ? '▶' : '❚❚'}
            </button>
            {isTimeshift ? (
              <>
                <span className="text-xs tabular-nums text-neutral-300">
                  {formatElapsed(currentTime * 1000)} / {formatElapsed((duration || 0) * 1000)}
                </span>
                <input
                  type="range"
                  min={0}
                  max={duration || 0}
                  step={1}
                  value={currentTime}
                  onChange={(e) => {
                    const v = videoRef.current;
                    if (v) v.currentTime = Number(e.target.value);
                  }}
                  className="flex-1 min-w-0"
                />
                {archiveLoading && <span className="text-xs text-neutral-400">コメント取得中…</span>}
              </>
            ) : (
              <>
                {chasePlay && seekRange && (
                  <>
                    <input
                      type="range"
                      min={seekRange.start}
                      max={seekRange.end}
                      step={1}
                      value={Math.min(Math.max(currentTime, seekRange.start), seekRange.end)}
                      onChange={(e) => {
                        const v = videoRef.current;
                        if (v) v.currentTime = Number(e.target.value);
                      }}
                      className="flex-1 min-w-0"
                      title="追っかけ再生"
                    />
                    <span className="text-xs tabular-nums text-neutral-300">
                      {seekRange.end - currentTime > 5
                        ? `-${formatElapsed((seekRange.end - currentTime) * 1000)}`
                        : 'LIVE'}
                    </span>
                    {archiveLoading && <span className="text-xs text-neutral-400">コメント取得中…</span>}
                  </>
                )}
                <button
                  onClick={seekToLive}
                  className="px-2 py-0.5 rounded text-xs bg-red-700 hover:bg-red-600"
                  title="最新の位置へ"
                >
                  最新
                </button>
              </>
            )}
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
            {!isTimeshift && !(chasePlay && seekRange) && <div className="flex-1" />}
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
        <LiveCommentList
          items={listItems}
          currentIndex={listIndex}
          onSeek={isTimeshift || chasePlay ? seekToVpos : undefined}
          className={`${isFullscreen ? 'hidden' : ''} w-80 shrink-0 bg-neutral-950 border-l border-neutral-800`}
        />
      </div>
    </div>
  );
}
