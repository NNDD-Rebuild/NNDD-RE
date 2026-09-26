import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Hls from 'hls.js';
import type {
  LiveCommentRange,
  LiveCommentWindowEvent,
  LiveCommentWindowMessage,
  LiveConnectionState,
  LiveEvent,
  LiveListItem,
  LiveNotice,
  LiveProgramInfo,
  LiveStartResult,
  LiveStatistics,
  NgListItem,
  NNDDREComment
} from '@shared/types';
import { CommentPosition, IpcChannel } from '@shared/types';
import { CommentRenderer, DEFAULT_RENDER_CONFIG } from './components/player/CommentRenderer';
import { useConfig } from './hooks/useConfig';
import { VideoController } from './components/player/VideoController';
import { CommentList } from './components/player/CommentList';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import {
  descriptionLinkUrl,
  openDescriptionUrl,
  sanitizeDescription
} from './components/player/VideoInfoView';
import { ContextMenuPopup, MenuItem } from './components/common/VideoCard';

/** 生放送プレイヤー → コメントウィンドウ (main が中継) */
function pushToCommentWindow(msg: LiveCommentWindowMessage): void {
  window.nndd.send(IpcChannel.LIVE_COMMENT_WINDOW_PUSH, msg);
}

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
 * これより古いものは元の位置のまま = 画面には流さない。
 */
const LATE_COMMENT_WINDOW_MS = 10_000;
/**
 * 「今」に寄せる対象は、投稿からこの時間 (ms) 以内に届いたコメント (= リアルタイムの生コメント) だけ。
 * 接続直後にコメントサーバーからまとめて届く直前区間の分まで寄せると、開いた瞬間に一斉に流れてしまう
 */
const REALTIME_ARRIVAL_MS = 5_000;
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
/** サイドパネル幅 (通常プレイヤー PlayerApp と同じ範囲) */
const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 700;
const SIDEBAR_DEFAULT = 320;

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
  /** 生コメントの投稿→受信の最小の遅れ (ms)。PC とサーバーの時計のずれの推定に使う */
  const minArrivalDelayRef = useRef(Infinity);
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
  /** コメントウィンドウ (フロート) が開いて snapshot 送信済みか / 未送信の追加分 */
  const commentWindowOpenRef = useRef(false);
  const pendingPushRef = useRef<LiveListItem[]>([]);
  const statisticsRef = useRef<LiveStatistics | null>(null);
  /** コメントウィンドウからのシーク要求用 (イベント購読の effect から最新の関数を呼ぶ) */
  const seekToVposRef = useRef<(vposMs: number) => void>(() => {});
  /** コメントウィンドウへ全件 (snapshot) を送る */
  const sendSnapshotRef = useRef((): void => {
    pendingPushRef.current = [];
    pushToCommentWindow({
      type: 'snapshot',
      items: listItemsRef.current,
      program: programRef.current,
      statistics: statisticsRef.current,
      canSeek: isTimeshiftRef.current || chasePlayRef.current
    });
  });
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
  /** 今映っている位置 (番組の vpos 基準、ms)。コメントリストの現在位置表示に使う */
  const [positionMs, setPositionMs] = useState(0);
  /** video 要素 (VideoController に渡す) */
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const [ngList, setNgList] = useState<NgListItem[]>([]);
  const [sideTab, setSideTab] = useState<'info' | 'comments' | 'notices'>('comments');
  /** サイドパネルの幅 (通常プレイヤーと共通の設定 player.sidebarWidth) */
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT);
  const [isSidebarDragging, setIsSidebarDragging] = useState(false);
  const [quality, setQuality] = useState('abr');
  const [qualities, setQualities] = useState<string[]>([]);
  const [streamUri, setStreamUri] = useState('');
  const [now, setNow] = useState(Date.now());
  const [showComments, setShowComments] = useState(true);
  /** コメントリストの表示方式 (side: タブ表示 / window: 浮動ウィンドウ)。初期値は設定から */
  const [defaultCommentDisplay, , commentDisplayLoading] = useConfig<'side' | 'window'>(
    'live.commentListDisplay',
    'side'
  );
  const [commentDisplay, setCommentDisplay] = useState<'side' | 'window' | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [isTimeshift, setIsTimeshift] = useState(false);
  const [activationRequired, setActivationRequired] = useState(false);
  const [activating, setActivating] = useState(false);
  /** LIVE_START のやり直し用 (タイムシフト視聴開始後に再接続する) */
  const [startSeq, setStartSeq] = useState(0);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [chasePlay, setChasePlay] = useState(false);

  /**
   * コメントリストへ行を追加する。過去コメントと生コメントは同じキーになるので重複は自然に除かれる。
   * 並べ替えと再描画は LIST_FLUSH_MS ごとにまとめる
   */
  const addListItems = useCallback((items: LiveListItem[]) => {
    for (const it of items) {
      if (listKeysRef.current.has(it.key)) continue;
      listKeysRef.current.add(it.key);
      listItemsRef.current.push(it);
      pendingPushRef.current.push(it);
    }
    if (listFlushTimer.current !== null) return;
    listFlushTimer.current = window.setTimeout(() => {
      listFlushTimer.current = null;
      listItemsRef.current.sort((a, b) => a.vposMs - b.vposMs);
      setListItems([...listItemsRef.current]);
      // コメントウィンドウへは追加分だけ送る
      if (commentWindowOpenRef.current && pendingPushRef.current.length > 0) {
        pushToCommentWindow({ type: 'append', items: pendingPushRef.current });
      }
      pendingPushRef.current = [];
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
          const arrivedAtMs = Date.now();
          // 投稿→受信の遅れ。PC の時計がずれていても判定できるよう、これまでの最小の遅れを基準にする
          for (const c of ev.comments) {
            if (c.date > 0) minArrivalDelayRef.current = Math.min(minArrivalDelayRef.current, arrivedAtMs - c.date * 1000);
          }
          const adjusted = ev.comments.map(alignNaka).map((c) => {
            // 投稿から時間が経って届いたもの (直前区間のまとめ読み等) は元の時刻のまま
            const realtime =
              c.date > 0 && arrivedAtMs - c.date * 1000 - minArrivalDelayRef.current <= REALTIME_ARRIVAL_MS;
            // 出現時刻が今になる vpos (流れコメントは 1 秒前に出現するので +1 秒)
            const appearMs = nowMs + (c.positionCommand === CommentPosition.NAKA ? NAKA_LEAD_MS : 0);
            return realtime && c.vposMs < appearMs && appearMs - c.vposMs <= LATE_COMMENT_WINDOW_MS
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
          statisticsRef.current = ev.statistics;
          if (commentWindowOpenRef.current) pushToCommentWindow({ type: 'statistics', statistics: ev.statistics });
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
        // 番組情報より先にコメントウィンドウが開いていたら、番組情報込みで送り直す
        if (commentWindowOpenRef.current) sendSnapshotRef.current();
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
      const nowMs = currentVposRef.current() * 10;
      // 小さな変化では再描画しない (コメントリストの現在位置は 0.5 秒単位で十分)
      setPositionMs((prev) => (Math.abs(prev - nowMs) >= 400 ? nowMs : prev));
      if (commentWindowOpenRef.current) pushToCommentWindow({ type: 'position', vposMs: nowMs });
    }, 500);
    return () => window.clearInterval(t);
  }, []);

  // ---- コメントウィンドウ (フロート) ----
  // 設定の既定値を読み込めたら表示場所を決める
  useEffect(() => {
    if (!commentDisplayLoading && commentDisplay === null) setCommentDisplay(defaultCommentDisplay);
  }, [commentDisplayLoading, defaultCommentDisplay, commentDisplay]);

  useEffect(() => {
    if (commentDisplay === 'window') {
      void window.nndd.invoke(IpcChannel.LIVE_COMMENT_WINDOW_OPEN).catch(() => {});
    } else if (commentDisplay === 'side') {
      commentWindowOpenRef.current = false;
      void window.nndd.invoke(IpcChannel.LIVE_COMMENT_WINDOW_CLOSE).catch(() => {});
    }
  }, [commentDisplay]);

  useEffect(() => {
    const off = window.nndd.on(IpcChannel.LIVE_COMMENT_WINDOW_EVENT, (...args: unknown[]) => {
      const ev = args[0] as LiveCommentWindowEvent;
      switch (ev.type) {
        case 'ready':
          // コメントウィンドウの準備ができたら全件を送り、以降は差分を送る
          commentWindowOpenRef.current = true;
          sendSnapshotRef.current();
          break;
        case 'seek':
          seekToVposRef.current(ev.vposMs);
          break;
        case 'closed':
          commentWindowOpenRef.current = false;
          setCommentDisplay('side');
          break;
      }
    });
    return off;
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
  seekToVposRef.current = seekToVpos;

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

  // ---- テーマ・NGリスト・サイドパネル幅 (通常プレイヤーと共通の設定) ----
  useEffect(() => {
    window.nndd
      .invoke<'dark' | 'light'>(IpcChannel.CONFIG_GET, 'ui.theme')
      .then((v) => {
        if (v === 'light') document.documentElement.classList.add('light');
      })
      .catch(() => {});
    window.nndd
      .invoke<NgListItem[]>(IpcChannel.NG_LIST_COMMENT)
      .then(setNgList)
      .catch(() => {});
    window.nndd
      .invoke<number>(IpcChannel.CONFIG_GET, 'player.sidebarWidth')
      .then((w) => {
        if (w && w > 0) setSidebarWidth(w);
      })
      .catch(() => {});
  }, []);

  // NG リストは画面のコメント描画にも反映する
  useEffect(() => {
    rendererRef.current?.setConfig({ ngList });
  }, [ngList]);

  const handleAddNg = useCallback(async (item: NgListItem): Promise<void> => {
    await window.nndd.invoke(IpcChannel.NG_ADD_COMMENT, item);
    setNgList((prev) =>
      prev.some((x) => x.type === item.type && x.value === item.value) ? prev : [...prev, item]
    );
  }, []);

  const handleRemoveNg = useCallback(async (item: NgListItem): Promise<void> => {
    await window.nndd.invoke(IpcChannel.NG_REMOVE_COMMENT, item);
    setNgList((prev) => prev.filter((x) => !(x.type === item.type && x.value === item.value)));
  }, []);

  /** サイドパネル境界のドラッグで幅を変える (PlayerApp と同じ挙動、幅は設定に保存) */
  const onSidebarDividerMouseDown = (e: React.MouseEvent): void => {
    const startX = e.clientX;
    const startW = sidebarWidth;
    setIsSidebarDragging(true);
    e.preventDefault();
    const widthAt = (x: number): number => Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, startW + (startX - x)));
    const onMove = (ev: MouseEvent): void => setSidebarWidth(widthAt(ev.clientX));
    const onUp = (ev: MouseEvent): void => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setIsSidebarDragging(false);
      void window.nndd
        .invoke(IpcChannel.CONFIG_SET, 'player.sidebarWidth', widthAt(ev.clientX))
        .catch(() => {});
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const canSeek = isTimeshift || chasePlay;

  useKeyboardShortcuts({
    togglePlay,
    toggleMute: () => {
      const v = videoRef.current;
      if (v) v.muted = !v.muted;
    },
    toggleFullscreen: () => toggleFullscreen(),
    toggleComments: () => setShowComments((v) => !v),
    seek: canSeek
      ? (delta) => {
          const v = videoRef.current;
          if (v) seekToVpos(currentVposRef.current() * 10 + delta * 1000);
        }
      : undefined,
    volumeUp: () => {
      const v = videoRef.current;
      if (v) v.volume = Math.min(1, v.volume + 0.05);
    },
    volumeDown: () => {
      const v = videoRef.current;
      if (v) v.volume = Math.max(0, v.volume - 0.05);
    }
  });

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
  const stateLabel = state === 'watching' ? (isTimeshift ? 'タイムシフト' : 'LIVE') : STATE_LABELS[state];
  const listComments = useMemo<NNDDREComment[]>(
    () => listItems.flatMap((i) => (i.comment ? [i.comment] : [])),
    [listItems]
  );
  const listNotices = useMemo(() => listItems.filter((i) => i.notice), [listItems]);
  const showSideComments = commentDisplay !== 'window';

  return (
    <div
      ref={rootRef}
      onMouseMove={onPointerActivity}
      className="flex h-screen bg-black text-nndd-text"
    >
      {/* ドラッグ中のカーソルちらつき防止オーバーレイ */}
      {isSidebarDragging && <div className="fixed inset-0 z-50 cursor-col-resize" />}

      {/* 映像 + 操作バー */}
      <div
        className={[
          'flex-1 flex flex-col min-h-0 min-w-0 relative',
          isFullscreen && !controlsVisible ? 'cursor-none' : ''
        ].join(' ')}
      >
        <div className="flex-1 relative min-h-0" onDoubleClick={toggleFullscreen}>
          <video
            ref={(el) => {
              (videoRef as React.MutableRefObject<HTMLVideoElement | null>).current = el;
              setVideoEl(el);
            }}
            className="absolute inset-0 w-full h-full object-contain"
          />
          <div ref={overlayRef} className="absolute inset-0 pointer-events-none" />
          {operatorComment && (
            <div className="absolute top-0 inset-x-0 bg-black/70 text-white text-center text-sm py-1 px-2">
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
              <div className="bg-black/70 text-white px-4 py-3 rounded text-sm text-center max-w-md pointer-events-auto">
                <div>{stateMessage || STATE_LABELS[state]}</div>
                {activationRequired && (
                  <>
                    <div className="mt-2 text-xs text-neutral-300">
                      視聴を開始すると視聴期限のカウントが始まります (取り消せません)。
                    </div>
                    <button
                      onClick={() => void activateTimeshift()}
                      disabled={activating}
                      className="mt-3 px-3 py-1 rounded bg-nndd-accent text-white hover:opacity-80 disabled:opacity-50"
                    >
                      {activating ? '処理中...' : 'タイムシフトを予約して視聴開始'}
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 操作バー (全画面中は映像に重ね、操作時のみ表示) */}
        <div
          className={[
            'transition-opacity duration-200',
            isFullscreen ? 'absolute left-0 right-0 bottom-0 z-10' : 'static',
            !isFullscreen || controlsVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
          ].join(' ')}
        >
          <VideoController
            video={videoEl}
            showComments={showComments}
            onToggleComments={() => setShowComments((v) => !v)}
            onToggleFullscreen={toggleFullscreen}
            availableQualities={qualities.map((q, i) => ({
              id: q,
              isAvailable: true,
              qualityLevel: qualities.length - i
            }))}
            currentQualityId={quality}
            onQualityChange={changeQuality}
            formatQualityLabel={(q) => QUALITY_LABELS[q.id] ?? q.id}
            live={isTimeshift ? undefined : { chasePlay, onSeekToLive: seekToLive }}
            hideRateSelect={!isTimeshift}
            hidePip
            statusText={archiveLoading ? 'コメント取得中…' : undefined}
            extraButtons={
              <button
                onClick={() => setCommentDisplay((d) => (d === 'window' ? 'side' : 'window'))}
                className="px-2 py-0.5 bg-nndd-border hover:bg-nndd-accent rounded"
                title="コメントリストの表示方式 (タブ表示 / 浮動ウィンドウ) を切り替え"
              >
                {commentDisplay === 'window' ? '💬 浮動' : '💬 タブ'}
              </button>
            }
          />
        </div>
      </div>

      {/* サイドパネル (全画面中は隠すだけで unmount しない) */}
      <div className={isFullscreen ? 'hidden' : 'contents'}>
        <div
          className="w-1 shrink-0 bg-nndd-border hover:bg-nndd-accent/70 active:bg-nndd-accent cursor-col-resize transition-colors"
          onMouseDown={onSidebarDividerMouseDown}
          style={{ userSelect: 'none' }}
          title="ドラッグでサイズ変更"
        />
        <aside className="shrink-0 bg-nndd-bg overflow-hidden flex flex-col" style={{ width: sidebarWidth }}>
          <div className="flex shrink-0 border-b border-nndd-border overflow-x-auto">
            <TabButton label="番組情報" active={sideTab === 'info'} onClick={() => setSideTab('info')} />
            {showSideComments && (
              <TabButton
                label={`コメントリスト${listComments.length > 0 ? ` (${listComments.length.toLocaleString()})` : ''}`}
                active={sideTab === 'comments'}
                onClick={() => setSideTab('comments')}
              />
            )}
            {showSideComments && (
              <TabButton
                label={`お知らせ${listNotices.length > 0 ? ` (${listNotices.length.toLocaleString()})` : ''}`}
                active={sideTab === 'notices'}
                onClick={() => setSideTab('notices')}
              />
            )}
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">
            {sideTab === 'comments' && showSideComments ? (
              <CommentList
                comments={listComments}
                ngList={ngList}
                onSeek={canSeek ? (sec) => seekToVpos(sec * 1000) : undefined}
                currentTimeMs={positionMs}
                onAddNg={handleAddNg}
                onRemoveNg={handleRemoveNg}
              />
            ) : sideTab === 'notices' && showSideComments ? (
              <div className="h-full overflow-auto text-xs">
                {listNotices.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-nndd-subtext text-sm">お知らせなし</div>
                ) : (
                  listNotices.map((n) => (
                    <div key={n.key} className="flex gap-2 px-2 py-1 border-b border-nndd-border/30">
                      <span className="shrink-0 font-mono text-nndd-subtext">{formatElapsed(n.vposMs)}</span>
                      <span className="break-all">{n.notice!.text}</span>
                    </div>
                  ))
                )}
              </div>
            ) : (
              <ProgramInfo
                program={program}
                stateLabel={stateLabel}
                elapsed={elapsed}
                statistics={statistics}
                programId={programId}
              />
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

/** サイドパネル「番組情報」タブ (通常プレイヤーの「動画情報」タブと同じ構成) */
function ProgramInfo({
  program,
  stateLabel,
  elapsed,
  statistics,
  programId
}: {
  program: LiveProgramInfo | null;
  stateLabel: string;
  elapsed: string;
  statistics: LiveStatistics | null;
  programId: string;
}): JSX.Element {
  const [openVideoLinkInPlayer] = useConfig<boolean>('player.openVideoLinkInPlayer', false);
  const [ownerCtxMenu, setOwnerCtxMenu] = useState<{ x: number; y: number } | null>(null);

  if (!program) {
    return <div className="p-4 text-nndd-subtext text-sm">番組情報を読み込み中…</div>;
  }

  const begin = program.beginTimeMs ? new Date(program.beginTimeMs) : null;
  const pad = (n: number): string => String(n).padStart(2, '0');
  const liveUrl = `https://live.nicovideo.jp/watch/${program.programId || programId}`;
  const supplier = program.supplier;
  const isUser = supplier?.type === 'user' && Boolean(supplier.id);

  const handleDescClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    const url = descriptionLinkUrl(e);
    if (!url) return;
    e.preventDefault();
    // 生放送の番組リンクは生放送プレイヤーで開く
    const lv = url.match(/live\d*\.nicovideo\.jp\/watch\/(lv\d+)/);
    if (lv) void window.nndd.invoke(IpcChannel.LIVE_OPEN_PLAYER, lv[1]);
    else openDescriptionUrl(url, openVideoLinkInPlayer);
  };

  return (
    <div className="overflow-auto h-full p-3 text-sm text-nndd-text">
      <h1 className="text-base font-bold mb-1">{program.title}</h1>
      <div className="text-xs text-nndd-subtext mb-1">
        <span className="px-1.5 py-0.5 mr-1 rounded bg-nndd-accent text-white font-bold">{stateLabel}</span>
        {begin && `開始: ${begin.getFullYear()}/${pad(begin.getMonth() + 1)}/${pad(begin.getDate())} ${pad(begin.getHours())}:${pad(begin.getMinutes())}`}
        {elapsed && ` ・ 経過 ${elapsed}`}
        {statistics && ` ・ 来場 ${statistics.viewers.toLocaleString()} ・ コメ ${statistics.comments.toLocaleString()}`}
        {program.timeshiftReservationCount !== undefined &&
          ` ・ TS予約 ${program.timeshiftReservationCount.toLocaleString()}`}
      </div>
      <div className="text-xs mb-3">
        <button
          onClick={() => window.nndd.invoke(IpcChannel.SYS_OPEN_PATH, liveUrl)}
          className="text-nndd-accent underline hover:opacity-80"
          title={liveUrl}
        >
          {program.programId || programId} →ニコニコ生放送で見る
        </button>
      </div>

      {supplier && (
        <div className="flex items-center gap-2 mb-3">
          {supplier.iconUrl && (
            <img
              src={supplier.iconUrl}
              alt=""
              className="w-8 h-8 rounded-full"
              referrerPolicy="no-referrer"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
          )}
          <button
            onClick={() => {
              if (isUser) {
                void window.nndd.invoke(IpcChannel.NAV_FOLLOW_USER, {
                  userId: supplier.id,
                  nickname: supplier.name,
                  iconUrl: supplier.iconUrl
                });
              } else if (supplier.pageUrl) {
                void window.nndd.invoke(IpcChannel.SYS_OPEN_PATH, supplier.pageUrl);
              }
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              if (supplier.pageUrl) setOwnerCtxMenu({ x: e.clientX, y: e.clientY });
            }}
            className="text-sm hover:text-nndd-accent hover:underline text-left"
            title={
              isUser
                ? 'クリック: フォロー中タブでこの放送者の動画を表示 (右クリックでメニュー)'
                : 'クリック: ページを開く'
            }
          >
            {supplier.name}
          </button>
          {supplier.level !== undefined && (
            <span className="text-xs text-nndd-subtext">Lv.{supplier.level}</span>
          )}
          {ownerCtxMenu && (
            <ContextMenuPopup x={ownerCtxMenu.x} y={ownerCtxMenu.y} onClose={() => setOwnerCtxMenu(null)}>
              <MenuItem
                onClick={() => {
                  void window.nndd.invoke(IpcChannel.SYS_OPEN_PATH, supplier.pageUrl);
                  setOwnerCtxMenu(null);
                }}
              >
                🌐 {isUser ? 'ユーザーページを開く' : 'ページを開く'}
              </MenuItem>
            </ContextMenuPopup>
          )}
        </div>
      )}

      {program.tags.length > 0 && (
        <div className="mb-3">
          <div className="text-xs text-nndd-subtext mb-1">タグ (ダブルクリックで生放送を検索)</div>
          <div className="flex flex-wrap gap-1">
            {program.tags.map((t) => (
              // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
              <span
                key={t}
                className="px-2 py-0.5 bg-nndd-border rounded text-xs cursor-pointer hover:bg-nndd-accent hover:text-white transition-colors"
                onDoubleClick={() => window.nndd.invoke(IpcChannel.NAV_LIVE_SEARCH, t)}
              >
                {t}
              </span>
            ))}
          </div>
        </div>
      )}

      {program.description && (
        <div className="mt-2">
          <div className="text-xs text-nndd-subtext mb-1">説明</div>
          {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
          <div
            className="text-sm leading-relaxed break-words whitespace-pre-wrap"
            dangerouslySetInnerHTML={{ __html: sanitizeDescription(program.description) }}
            onClick={handleDescClick}
          />
        </div>
      )}
    </div>
  );
}

function TabButton({
  label,
  active,
  onClick
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={[
        'shrink-0 text-xs py-1.5 px-3 border-b-2 transition-colors whitespace-nowrap',
        active
          ? 'border-nndd-accent text-nndd-text font-bold'
          : 'border-transparent text-nndd-subtext hover:text-nndd-text'
      ].join(' ')}
    >
      {label}
    </button>
  );
}
