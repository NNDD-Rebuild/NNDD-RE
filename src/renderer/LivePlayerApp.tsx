import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type Hls from 'hls.js';
import type {
  LiveCommentLayout,
  LiveCommentLock,
  LiveConnectionState,
  LiveCreatorSupport,
  LiveEnquete,
  LiveEvent,
  LiveMoveOrder,
  LiveNotice,
  LiveProgramInfo,
  LiveAkashicInfo,
  LiveStartResult,
  LiveStatistics,
  NgListItem
} from '@shared/types';
import { IpcChannel } from '@shared/types';
import type { CommentRenderer } from './components/player/CommentRenderer';
import { useConfig } from './hooks/useConfig';
import { useNgList } from './hooks/player/useNgList';
import { VideoController } from './components/player/VideoController';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { CommentLockChip, CreatorSupportBar, EnqueteOverlay, MoveOrderBanner } from './components/live/LiveOverlays';
import { AkashicLayer, createAkashicBus, pushAkashicBatch } from './components/live/akashic/AkashicLayer';
import { LiveProgramInfo as ProgramInfo } from './components/live/LiveProgramInfo';
import { LiveSidePanel } from './components/live/LiveSidePanel';
import { LiveStatusOverlay, OperatorCommentBanner } from './components/live/LivePlayerStatus';
import { errorText, formatElapsed, formatLiveQuality, STATE_LABELS } from './components/live/liveFormat';
import { pushToCommentWindow } from './hooks/live/liveCommentUtils';
import { useLiveCommentList } from './hooks/live/useLiveCommentList';
import { useLiveCommentFeed } from './hooks/live/useLiveCommentFeed';
import { useLiveHls } from './hooks/live/useLiveHls';
import { useLiveCommentRenderer } from './hooks/live/useLiveCommentRenderer';
import { useLiveAroundFetch } from './hooks/live/useLiveAroundFetch';
import { useLiveDiscordPresence } from './hooks/live/useLiveDiscordPresence';
import { useLiveCommentWindow } from './hooks/live/useLiveCommentWindow';
import { useSidebarResize } from './hooks/player/useSidebarResize';
import { useApplyTheme } from './hooks/useApplyTheme';
import { useLiveMoveOrder } from './hooks/live/useLiveMoveOrder';

/** タイムシフト予約・視聴開始が必要なときに main から返るエラーコード (LiveWatchPage.ts) */
const TIMESHIFT_ACTIVATION_REQUIRED = '[TIMESHIFT_ACTIVATION_REQUIRED]';

/**
 * ニコニコ生放送プレイヤー (live-player.html)。
 * 番組ID はクエリ `?programId=lv...` で受け取り、main の LiveSession から
 * LIVE_EVENT で HLS URL・コメント・統計等を受け取る。
 *
 * 責務ごとのフック (src/renderer/hooks/live/):
 * - useLiveCommentList: コメントリストの行 (コメント + お知らせ) の蓄積
 * - useLiveCommentFeed: 生コメント・過去コメントを描画エンジンとコメントリストへ流す
 * - useLiveHls / useLiveCommentRenderer: 映像の再生とコメント描画
 * - useLiveAroundFetch: 周辺取得モードのコメント取得
 * - useLiveDiscordPresence / useLiveCommentWindow / useLiveMoveOrder
 * useEffect の実行順は分割前と同じになるよう、フックの呼び出し順を保っている。
 */
export default function LivePlayerApp(): JSX.Element {
  const programId = new URLSearchParams(location.search).get('programId') ?? '';
  const ncvParam = new URLSearchParams(location.search).get('ncv');
  /**
   * NCV 連携で開かれた (コメントリストはタブ表示に固定する)。
   * linked は最初から、pending (RE から NCV を起動する予定) は視聴開始後に起動したかが分かる。null は未確定
   */
  const [ncvResolved, setNcvResolved] = useState<boolean | null>(ncvParam === 'pending' ? null : ncvParam === 'linked');
  const ncvLinked = ncvResolved === true;

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
  const chasePlayAvailableRef = useRef(false);
  /** true の間、新しい Hls を作っても再生を始めない (追っかけ再生へ切り替えて巻き戻す途中) */
  const holdPlaybackRef = useRef(false);
  const { listItems, listItemsRef, pendingPushRef, commentWindowOpenRef, addListItems } = useLiveCommentList();
  const statisticsRef = useRef<LiveStatistics | null>(null);
  /**
   * 放送者が登録した NG (SSNG)。削除は id だけ届くので id → 内容の Map で持つ。
   * 番組ごとの一時的なもので、ユーザー自身の NG リストとは別に保持し永続化しない
   */
  const ssngMapRef = useRef(new Map<string, NgListItem>());
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
      canSeek: isTimeshiftRef.current || chasePlayAvailableRef.current,
      ssngList: [...ssngMapRef.current.values()]
    });
  });
  const commentFetchModeRef = useRef<LiveStartResult['commentFetchMode']>('all');
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
  /** ニコ生ゲーム (クルーズの行き先投票など)。有効な番組だけ映像の上にゲームを重ねる */
  const [akashicInfo, setAkashicInfo] = useState<LiveAkashicInfo | null>(null);
  const akashicBusRef = useRef(createAkashicBus());
  const [state, setState] = useState<LiveConnectionState>('connecting');
  const [stateMessage, setStateMessage] = useState('');
  const [statistics, setStatistics] = useState<LiveStatistics | null>(null);
  const [operatorComment, setOperatorComment] = useState<LiveNotice | null>(null);
  const [enquete, setEnquete] = useState<LiveEnquete | null>(null);
  const [moveOrder, setMoveOrder] = useState<LiveMoveOrder | null>(null);
  const [autoFollowMoveOrder, , autoFollowLoading] = useConfig<boolean>('live.autoFollowMoveOrder', false);
  const [creatorSupport, setCreatorSupport] = useState<LiveCreatorSupport | null>(null);
  const [commentLock, setCommentLock] = useState<LiveCommentLock | null>(null);
  const [commentLayout, setCommentLayout] = useState<LiveCommentLayout>('normal');
  /** video 要素 (VideoController に渡す) */
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const { ngList, addNg: handleAddNg, removeNg: handleRemoveNg } = useNgList();
  const [ssngList, setSsngList] = useState<NgListItem[]>([]);
  const { sidebarWidth, isSidebarDragging, onSidebarDividerMouseDown } = useSidebarResize();
  useApplyTheme();
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
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [isTimeshift, setIsTimeshift] = useState(false);
  const [activationRequired, setActivationRequired] = useState(false);
  const [activating, setActivating] = useState(false);
  const [accessRestricted, setAccessRestricted] = useState('');
  const trialPanelsRef = useRef<{ atMs: number; restricted: boolean }[]>([]);
  /** LIVE_START のやり直し用 (タイムシフト視聴開始後に再接続する) */
  const [startSeq, setStartSeq] = useState(0);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [chasePlay, setChasePlay] = useState(false);
  /** 追っかけ再生 (巻き戻し) に切り替えられるか。通常は低遅延のライブ視聴で、切り替えたときだけ chasePlay になる */
  const [chasePlayAvailable, setChasePlayAvailable] = useState(false);
  /** 追っかけ再生へ切り替えて巻き戻している途中 (開始位置の映像を見せないよう映像とコメントを隠す) */
  const [rewinding, setRewinding] = useState(false);
  /** 巻き戻し先の vposMs (切り替え中、シークバーのつまみをここに留めておく)。巻き戻しをしていないときは null */
  const [rewindTargetVposMs, setRewindTargetVposMs] = useState<number | null>(null);

  const { handleLiveComments, handleArchiveComments } = useLiveCommentFeed({
    rendererRef,
    currentVposRef,
    isTimeshiftRef,
    chasePlayAvailableRef,
    commentFetchModeRef,
    addListItems,
    setArchiveLoading
  });

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
          // hls.js の作り直し (streamUri の変更) より先に、この stream が追っかけ再生かどうかを反映する
          chasePlayRef.current = ev.chasePlay;
          setChasePlay(ev.chasePlay);
          if (holdPlaybackRef.current) {
            if (ev.chasePlay) {
              setRewinding(true);
            } else {
              // 巻き戻しの途中で低遅延に戻された: 巻き戻しはやめて普通に再生する
              holdPlaybackRef.current = false;
              if (pendingChaseSeekRef.current) window.clearInterval(pendingChaseSeekRef.current.timer);
              pendingChaseSeekRef.current = null;
              setRewinding(false);
              setRewindTargetVposMs(null);
            }
          }
          setStreamUri(ev.uri);
          setQuality(ev.quality);
          if (ev.availableQualities.length > 0) setQualities(ev.availableQualities);
          break;
        case 'akashic':
          pushAkashicBatch(akashicBusRef.current, ev.batch);
          break;
        case 'comments':
          handleLiveComments(ev.comments);
          break;
        case 'archiveComments':
          handleArchiveComments(ev.comments, ev.done);
          break;
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
        case 'accessRestricted':
          setAccessRestricted(ev.message);
          break;
        case 'trialPanel': {
          const list = trialPanelsRef.current;
          if (!list.some((e) => e.atMs === ev.atMs && e.restricted === ev.restricted)) {
            list.push({ atMs: ev.atMs, restricted: ev.restricted });
            list.sort((x, y) => x.atMs - y.atMs);
          }
          break;
        }
        case 'chasePlayUnavailable':
          // 追っかけ再生の映像が無かった番組: シークバーを出さない通常のライブ表示にする
          chasePlayRef.current = false;
          chasePlayAvailableRef.current = false;
          setChasePlay(false);
          setChasePlayAvailable(false);
          break;
        case 'statistics':
          setStatistics(ev.statistics);
          statisticsRef.current = ev.statistics;
          if (commentWindowOpenRef.current) pushToCommentWindow({ type: 'statistics', statistics: ev.statistics });
          break;
        case 'operatorComment':
          setOperatorComment(ev.notice);
          break;
        case 'ssng': {
          const { update } = ev;
          if (update.operation === 'add') {
            if (update.item) ssngMapRef.current.set(update.id, update.item);
          } else {
            ssngMapRef.current.delete(update.id);
          }
          const list = [...ssngMapRef.current.values()];
          setSsngList(list);
          if (commentWindowOpenRef.current) pushToCommentWindow({ type: 'ssng', ssngList: list });
          break;
        }
        case 'moveOrder': {
          setMoveOrder(ev.order);
          const base = programRef.current?.vposBaseTimeMs ?? 0;
          const at = Date.now();
          addListItems([
            {
              key: `n${noticeSeq.current++}`,
              vposMs: base ? at - base : 0,
              notice: {
                kind: 'notification',
                at,
                text: `${ev.order.message || '放送者から移動の指示がありました'} (移動先: ${ev.order.target})`
              }
            }
          ]);
          break;
        }
        case 'creatorSupport':
          setCreatorSupport(ev.support);
          break;
        case 'commentLock':
          setCommentLock(ev.lock);
          break;
        case 'commentLayout':
          setCommentLayout(ev.layout);
          break;
        case 'enquete':
          setEnquete(ev.enquete);
          break;
        case 'schedule': {
          // 延長されると終了予定が変わる。番組情報の開始・終了時刻を差し替える
          const { beginMs, endMs } = ev.schedule;
          const patch = (p: LiveProgramInfo): LiveProgramInfo => ({
            ...p,
            endTimeMs: endMs,
            ...(beginMs > 0 ? { beginTimeMs: beginMs } : {})
          });
          if (programRef.current) programRef.current = patch(programRef.current);
          setProgram((prev) => (prev ? patch(prev) : prev));
          break;
        }
        case 'tags':
          if (programRef.current) programRef.current = { ...programRef.current, tags: ev.tags };
          setProgram((prev) => (prev ? { ...prev, tags: ev.tags } : prev));
          break;
      }
    });
    return off;
    // addListItems / handleLiveComments / handleArchiveComments はいずれも不変 (useCallback)。購読はマウント時の 1 回だけ
  }, [addListItems, handleLiveComments, handleArchiveComments]);

  // ---- 視聴開始 ----
  useEffect(() => {
    if (!programId) {
      setState('error');
      setStateMessage('番組IDが指定されていません。');
      return;
    }
    let cancelled = false;
    setActivationRequired(false);
    setAkashicInfo(null);
    akashicBusRef.current.buffer.length = 0;
    window.nndd
      .invoke<LiveStartResult>(IpcChannel.LIVE_START, programId)
      .then((r) => {
        if (cancelled) return;
        programRef.current = r.program;
        isTimeshiftRef.current = r.isTimeshift;
        if (r.ncvLaunched !== undefined) setNcvResolved(r.ncvLaunched);
        chasePlayRef.current = r.chasePlay;
        chasePlayAvailableRef.current = r.chasePlayAvailable;
        setIsTimeshift(r.isTimeshift);
        setChasePlay(r.chasePlay);
        setChasePlayAvailable(r.chasePlayAvailable);
        commentFetchModeRef.current = r.commentFetchMode;
        connectedAtRef.current = Date.now();
        // 周辺取得モードは必要になった時点で取得するので、ここでは取得中にしない
        setArchiveLoading(r.commentFetchMode === 'all');
        setProgram(r.program);
        setAkashicInfo(r.akashic.enabled ? r.akashic : null);
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
      setAccessRestricted('');
      trialPanelsRef.current = [];
      setStateMessage('');
      setStartSeq((n) => n + 1);
    } catch (e) {
      setStateMessage(errorText(e));
    } finally {
      setActivating(false);
    }
  };

  // ---- HLS 再生 ----
  useLiveHls({ videoRef, hlsRef, streamUri, isTimeshiftRef, chasePlayRef, holdPlaybackRef, setStateMessage });

  // ---- お試し視聴の終了 (NDGR の trial_panel) ----
  useEffect(() => {
    let prev = false;
    const timer = setInterval(() => {
      const events = trialPanelsRef.current;
      const base = programRef.current?.vposBaseTimeMs ?? 0;
      if (events.length === 0 || !base) return;
      const playingMs = base + currentVposRef.current() * 10;
      let restricted = false;
      for (const e of events) {
        if (e.atMs <= playingMs) restricted = e.restricted;
        else break;
      }
      if (restricted === prev) return;
      prev = restricted;
      setAccessRestricted(
        restricted
          ? programRef.current?.providerType === 'channel'
            ? 'この後はチャンネル会員限定です。視聴するにはチャンネルへの加入が必要です。'
            : 'この後は会員限定です。視聴するには視聴権限が必要です。'
          : ''
      );
    }, 500);
    return () => clearInterval(timer);
  }, [startSeq]);

  // ---- コメント描画 ----
  useLiveCommentRenderer({ overlayRef, videoRef, rendererRef, currentVposRef, showComments });

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
  }, []);

  // ---- 周辺取得モードのコメント取得 ----
  useLiveAroundFetch({
    videoRef,
    programRef,
    isTimeshiftRef,
    commentFetchModeRef,
    connectedAtRef,
    currentVposRef,
    setArchiveLoading
  });

  // ---- Discord Rich Presence ----
  useLiveDiscordPresence({ program, state, isTimeshift, currentVposRef });

  // ---- コメントリストの再生位置・コメントウィンドウ (フロート) ----
  const { positionMs, commentDisplay, setCommentDisplay } = useLiveCommentWindow({
    currentVposRef,
    commentWindowOpenRef,
    sendSnapshotRef,
    seekToVposRef,
    defaultCommentDisplay: ncvLinked ? 'side' : defaultCommentDisplay,
    commentDisplayLoading: ncvResolved === null ? true : ncvLinked ? false : commentDisplayLoading
  });

  /**
   * 追っかけ再生への切り替え待ちのシーク先 (vposMs) と、切り替え前の Hls。
   * 切り替え後の新しい Hls で再生位置が分かるようになったら、そこへシークする
   */
  const pendingChaseSeekRef = useRef<{ vposMs: number; fromHls: Hls | null; timer: number } | null>(null);

  /** 追っかけ再生 (巻き戻し可能・高遅延) と低遅延のライブ視聴を切り替える。新しい stream が届くと映像が読み込み直される */
  const setChasePlayMode = (enabled: boolean): void => {
    void window.nndd.invoke(IpcChannel.LIVE_SET_CHASE_PLAY, enabled).catch(() => {});
  };

  /**
   * 低遅延のライブ視聴から追っかけ再生へ切り替え、読み込めたら vposMs へシークする。
   * 新しいストリームは hls.js がいったんライブ端付近から始めるので、その間は再生を止めて映像を隠し、
   * 開始位置への移動が終わってからシークして再生を始める (ライブ端の映像・音が一瞬出るのを防ぐ)
   */
  const rewindToVpos = (vposMs: number): void => {
    const pending = pendingChaseSeekRef.current;
    if (pending) window.clearInterval(pending.timer);
    const startedAt = Date.now();
    /** 再生を再開して映像を出す */
    const release = (): void => {
      holdPlaybackRef.current = false;
      setRewinding(false);
      setRewindTargetVposMs(null);
      const v = videoRef.current;
      if (v?.paused) void v.play().catch(() => {});
    };
    const timer = window.setInterval(() => {
      const p = pendingChaseSeekRef.current;
      const hls = hlsRef.current;
      const v = videoRef.current;
      const timedOut = Date.now() - startedAt > 20_000;
      // 新しい Hls が開始位置 (ライブ端付近) への移動を終えてから動かす (その前にシークすると上書きされてライブ端に戻される)。
      // 再生は止めているので、移動済みかは currentTime が 0 でなくなったことで見る
      const ready =
        chasePlayRef.current &&
        hls &&
        hls !== p?.fromHls &&
        hls.playingDate &&
        v &&
        v.seekable.length > 0 &&
        v.currentTime > 0 &&
        v.readyState >= 2 &&
        !v.seeking;
      if (!ready && !timedOut) return;
      window.clearInterval(timer);
      pendingChaseSeekRef.current = null;
      if (!ready || !v) {
        release();
        return;
      }
      const done = (): void => {
        window.clearTimeout(fallback);
        release();
      };
      const fallback = window.setTimeout(done, 3000);
      v.addEventListener('seeked', done, { once: true });
      seekToVposRef.current(vposMs);
    }, 200);
    pendingChaseSeekRef.current = { vposMs, fromHls: hlsRef.current, timer };
    holdPlaybackRef.current = true;
    setRewindTargetVposMs(vposMs);
    setChasePlayMode(true);
  };

  /** コメントリスト・シークバー・キー操作から指定時刻へシークする (タイムシフト・追っかけ再生。低遅延中なら追っかけ再生へ切り替えて) */
  const seekToVpos = (vposMs: number): void => {
    if (!isTimeshiftRef.current && chasePlayAvailableRef.current && !chasePlayRef.current) {
      // 低遅延中は今の位置より少し前 (5 秒以上) への巻き戻しだけ追っかけ再生へ切り替える。バーのつまみをクリックしただけ等では切り替えない
      if (vposMs < currentVposRef.current() * 10 - 5000) rewindToVpos(vposMs);
      return;
    }
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

  /** ライブの最新位置へ移動 (追っかけ再生中は低遅延のライブ視聴に戻る) */
  const seekToLive = (): void => {
    if (chasePlayRef.current) {
      setChasePlayMode(false);
      return;
    }
    const video = videoRef.current;
    const pos = hlsRef.current?.liveSyncPosition;
    if (video && pos != null) video.currentTime = pos;
    if (video?.paused) void video.play().catch(() => {});
  };

  // ユーザーの NG リストに放送者の NG (SSNG) を足したもの。画面の描画とコメントリストの両方に使う
  const effectiveNgList = useMemo(() => [...ngList, ...ssngList], [ngList, ssngList]);

  // NG リストは画面のコメント描画にも反映する
  useEffect(() => {
    rendererRef.current?.setConfig({ ngList: effectiveNgList });
  }, [effectiveNgList]);

  // ---- 移動指示 (自動で従う設定なら待ち時間の後に移動) ----
  const { moveDeadline, followMoveOrder, dismissMoveOrder } = useLiveMoveOrder({
    moveOrder,
    setMoveOrder,
    autoFollowMoveOrder,
    autoFollowLoading
  });

  // 低遅延のライブ視聴中でも、追っかけ再生へ切り替えられるならシークできる (操作すると切り替わる)
  const canSeek = isTimeshift || chasePlayAvailable;

  // シーク可否が変わったら、開いているコメントウィンドウへ送り直す
  useEffect(() => {
    if (commentWindowOpenRef.current) sendSnapshotRef.current();
  }, [canSeek]);

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
  const remaining =
    program && !isTimeshift && state === 'watching' && program.endTimeMs > now
      ? formatElapsed(program.endTimeMs - now)
      : '';
  const stateLabel = state === 'watching' ? (isTimeshift ? 'タイムシフト' : 'LIVE') : STATE_LABELS[state];
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
            className={['absolute inset-0 w-full h-full object-contain', rewinding ? 'opacity-0' : ''].join(' ')}
          />
          {akashicInfo && program && !isTimeshift && (
            <AkashicLayer
              key={program.programId}
              bus={akashicBusRef.current}
              info={akashicInfo}
              program={program}
              videoEl={videoEl}
              onPointerActivity={onPointerActivity}
            />
          )}
          {/*
            放送者が指定するコメントの表示レイアウト (comment_mode) に合わせる。
            splitTop: 映像の下半分を放送者が使うため、コメントは上半分だけに流す (領域を半分にして描画エンジンにも縮小を伝える)
            background: コメントを主役にしない演出用。映像を隠さないよう薄く表示する
          */}
          <div
            ref={overlayRef}
            className="absolute inset-0 pointer-events-none"
            style={{
              bottom: commentLayout === 'splitTop' ? '50%' : undefined,
              opacity: rewinding ? 0 : commentLayout === 'background' ? 0.4 : undefined
            }}
          />
          {operatorComment && <OperatorCommentBanner notice={operatorComment} />}
          {moveOrder && (
            <MoveOrderBanner
              order={moveOrder}
              secondsLeft={moveDeadline !== null ? Math.max(0, Math.ceil((moveDeadline - now) / 1000)) : null}
              onOpen={() => followMoveOrder(moveOrder)}
              onClose={dismissMoveOrder}
            />
          )}
          {creatorSupport && <CreatorSupportBar support={creatorSupport} lowered={moveOrder !== null} />}
          {commentLock && commentLock.status !== 'unrestricted' && <CommentLockChip lock={commentLock} />}
          {enquete && <EnqueteOverlay enquete={enquete} onClose={() => setEnquete(null)} />}
          {accessRestricted && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60">
              <div className="bg-nndd-panel border border-nndd-border rounded p-5 max-w-sm text-sm text-center">
                <div className="font-bold mb-2">視聴できません</div>
                <div className="mb-4">{accessRestricted}</div>
                <button
                  onClick={() => setAccessRestricted('')}
                  className="px-4 py-1 rounded bg-nndd-accent text-white hover:opacity-80"
                >
                  OK
                </button>
              </div>
            </div>
          )}
          {(state === 'error' || state === 'ended' || (!streamUri && state !== 'watching')) && (
            <LiveStatusOverlay
              state={state}
              stateMessage={stateMessage}
              activationRequired={activationRequired}
              activating={activating}
              onActivate={() => void activateTimeshift()}
            />
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
            formatQualityLabel={(q) => formatLiveQuality(q.id)}
            live={
              isTimeshift
                ? undefined
                : {
                    chasePlay,
                    // 低遅延中と巻き戻しの切り替え中は仮のバー。切り替え中はつまみを巻き戻し先に留めて、バーが動き回らないようにする
                    rewind:
                      chasePlayAvailable && (!chasePlay || rewindTargetVposMs !== null) && program && program.vposBaseTimeMs
                        ? {
                            beginMs: program.vposBaseTimeMs,
                            getPlayingMs: () =>
                              program.vposBaseTimeMs + (rewindTargetVposMs ?? currentVposRef.current() * 10),
                            onSeekTo: (ms) => {
                              if (rewindTargetVposMs === null) seekToVpos(ms - program.vposBaseTimeMs);
                            }
                          }
                        : undefined,
                    onSeekToLive: seekToLive,
                    getLiveSyncPosition: () => hlsRef.current?.liveSyncPosition ?? null
                  }
            }
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
      <LiveSidePanel
        isFullscreen={isFullscreen}
        width={sidebarWidth}
        onDividerMouseDown={onSidebarDividerMouseDown}
        showSideComments={showSideComments}
        listItems={listItems}
        ngList={effectiveNgList}
        onSeek={canSeek ? (sec) => seekToVpos(sec * 1000) : undefined}
        positionMs={positionMs}
        onAddNg={handleAddNg}
        onRemoveNg={handleRemoveNg}
        programInfo={
          <ProgramInfo
            program={program}
            stateLabel={stateLabel}
            elapsed={elapsed}
            remaining={remaining}
            statistics={statistics}
            programId={programId}
            commentLock={commentLock}
          />
        }
      />
    </div>
  );
}
