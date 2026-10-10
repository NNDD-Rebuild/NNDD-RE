import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  LiveAnimeParams,
  LiveAnimeResult,
  LiveProgramListResult,
  LiveProgramSummary,
  LiveRankingParams,
  LiveRankingResult,
  LiveRecentCategory,
  LiveRecentParams,
  LiveSearchParams
} from '@shared/types';
import { IpcChannel, LIVE_SEARCH_PAGE_SIZE } from '@shared/types';
import { extractLiveIdFromInput } from '@shared/utils/liveId';
import { useAppStore } from '@renderer/store/useAppStore';
import { enqueueLiveDownload, enqueueLiveRecord } from '@renderer/util/enqueueDownload';
import { VirtualizedItemList } from '../common/VirtualizedItemList';

type SubTab = 'followOnair' | 'followReserved' | 'ranking' | 'recent' | 'anime' | 'search' | 'timeshift' | 'recordReservations';
type RankingKind = 'official' | 'user';

/** ログインしていないと取得できないサブタブ */
const LOGIN_REQUIRED_TABS: SubTab[] = ['followOnair', 'followReserved', 'timeshift'];

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: 'followOnair', label: 'フォロー中 (放送中)' },
  { id: 'followReserved', label: 'フォロー中 (放送予定)' },
  { id: 'ranking', label: 'ランキング' },
  { id: 'recent', label: 'カテゴリ' },
  { id: 'anime', label: 'アニメ' },
  { id: 'search', label: '検索' },
  { id: 'timeshift', label: 'タイムシフト予約' },
  { id: 'recordReservations', label: '録画予約' }
];

const RANKING_TYPES: { value: LiveRankingParams['type']; label: string }[] = [
  { value: 'onair', label: '放送中' },
  { value: 'comingsoon', label: '放送予定' },
  { value: 'closed', label: '終了 (日付指定)' }
];

const RECENT_CATEGORIES: { value: LiveRecentCategory; label: string }[] = [
  { value: 'common', label: '一般' },
  { value: 'try', label: 'やってみた' },
  { value: 'live', label: 'ゲーム' },
  { value: 'req', label: '動画紹介' },
  { value: 'face', label: '顔出し' },
  { value: 'totu', label: '凸待ち' },
  { value: 'vtuber', label: 'VTuber' }
];

const RECENT_SORTS: { value: LiveRecentParams['sortOrder']; label: string }[] = [
  { value: 'recentDesc', label: '開始が新しい順' },
  { value: 'recentAsc', label: '開始が古い順' },
  { value: 'viewCountDesc', label: '来場者が多い順' },
  { value: 'commentCountDesc', label: 'コメントが多い順' },
  { value: 'userLevelDesc', label: '放送者レベルが高い順' }
];

const ANIME_SCOPES: { value: LiveAnimeParams['scope']; label: string }[] = [
  { value: 'reserved', label: '放送中・放送予定' },
  { value: 'past', label: '見逃し配信' }
];

const ANIME_KINDS: { value: LiveAnimeParams['kind']; label: string }[] = [
  { value: 'all', label: '全て' },
  { value: 'regular', label: '今期最新話' },
  { value: 'ikkyo', label: '一挙放送' },
  { value: 'tokuban', label: '声優特番' }
];

/** カテゴリ別一覧の 1 ページの件数 (API 側で固定) */
const RECENT_PAGE_SIZE = 70;

/** 今日の日付 (YYYY-MM-DD、input[type=date] 用) */
function todayInput(): string {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const SORTS: { value: string; label: string }[] = [
  { value: 'startTime:desc', label: '開始が新しい順' },
  { value: 'startTime:asc', label: '開始が古い順' },
  { value: 'viewCounter:desc', label: '来場者が多い順' },
  { value: 'commentCounter:desc', label: 'コメントが多い順' }
];

/** IPC 経由のエラーは "Error invoking remote method '...': Error: 本文" になるので本文だけ取り出す */
function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '');
}

function formatDateTime(ms: number): string {
  if (!ms) return '';
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDateTimeFull(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${d.getMonth() + 1}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 終了済み番組のタイムシフトの視聴可否・期限。ニコニコ公式のタイムシフト予約一覧と同じ判定
 * (視聴チケットの期限 > 公開終了日時 > 視聴回数の順に見る)。分からなければ undefined
 */
function timeshiftStatusOf(p: LiveProgramSummary, now: number): { text: string; available: boolean } | undefined {
  if (p.status !== 'ENDED') return undefined;
  const s = p.timeshiftSetting;
  if (!s) {
    if (p.timeshiftEnabled === false) return { text: 'タイムシフト非対応になりました', available: false };
    if (p.timeshiftPlayable === false) return { text: 'タイムシフト視聴不可', available: false };
    return undefined;
  }
  if (s.status === 'BEFORE_OPEN') return { text: 'タイムシフト公開前', available: false };
  if (s.status === 'CLOSED') return { text: '公開期間が終了しました', available: false };
  const end = s.publicationEndMs;
  if (s.watchLimit === 'UNLIMITED') {
    return { text: end ? `${formatDateTimeFull(end)}まで何回でも視聴可能` : 'いつでも何回でも視聴可能', available: true };
  }
  // 視聴回数制限あり: 視聴を始めるとチケットの期限まで視聴できる
  const t = s.ticketExpireMs;
  if (t) {
    return now < t
      ? { text: `${formatDateTimeFull(t)}まで視聴可能`, available: true }
      : { text: '視聴期限が切れました', available: false };
  }
  return {
    text: end ? `${formatDateTimeFull(end)}まで1回のみ視聴可能` : '1回のみ視聴可能',
    available: true
  };
}

/** 番組の長さ (開始〜終了予定)。1 時間未満は M:SS、以上は H:MM:SS。長さが分からなければ空文字 */
function formatProgramLength(beginMs: number, endMs: number): string {
  if (!(beginMs > 0 && endMs > beginMs)) return '';
  const s = Math.floor((endMs - beginMs) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  ON_AIR: { label: '放送中', className: 'bg-red-600' },
  RELEASED: { label: '放送予定', className: 'bg-blue-600' },
  ENDED: { label: '終了', className: 'bg-neutral-600' }
};

function openPlayer(input: string): Promise<void> {
  return window.nndd.invoke(IpcChannel.LIVE_OPEN_PLAYER, input);
}

function ProgramCard({
  p,
  rank,
  onOpen,
  tsAction,
  tsBusy,
  onTsAction,
  onDownload,
  onRecord,
  recordReserved,
  onRecordReserve
}: {
  p: LiveProgramSummary;
  /** ランキング順位 (ランキング表示時のみ) */
  rank?: number;
  onOpen: (id: string) => void;
  /** タイムシフトの操作ボタン (reserve: 予約 / cancel: 予約解除)。出さないときは undefined */
  tsAction?: 'reserve' | 'cancel';
  tsBusy?: boolean;
  onTsAction?: (p: LiveProgramSummary, action: 'reserve' | 'cancel') => void;
  /** タイムシフトをダウンロードする。終了済みでタイムシフトが視聴できる番組にだけボタンを出す */
  onDownload?: (p: LiveProgramSummary) => void;
  /** 放送中の番組を録画する。放送中の番組にだけボタンを出す */
  onRecord?: (p: LiveProgramSummary) => void;
  /** 録画予約済みか */
  recordReserved?: boolean;
  /** 録画予約の追加・解除 (放送予定の番組にだけボタンを出す) */
  onRecordReserve?: (p: LiveProgramSummary) => void;
}): JSX.Element {
  const tsStatus = timeshiftStatusOf(p, Date.now());
  // 終了済みでタイムシフトの状態が分かる番組は、公式の一覧と同じく「タイムシフト」/「公開終了」のバッジにする
  const badge =
    p.status === 'ENDED' && tsStatus
      ? { label: tsStatus.available ? 'タイムシフト' : '公開終了', className: tsStatus.available ? 'bg-blue-600' : 'bg-neutral-600' }
      : STATUS_BADGE[p.status];
  const length = formatProgramLength(p.beginAtMs, p.endAtMs);
  // 見た目は動画一覧のカード (VideoCard のグリッド表示) に揃える
  return (
    <div
      className="bg-nndd-panel hover:bg-nndd-border rounded overflow-hidden flex flex-col h-full"
      onDoubleClick={() => onOpen(p.programId)}
    >
      <div className="relative w-full aspect-video bg-black cursor-pointer" onClick={() => onOpen(p.programId)}>
        {p.thumbnailUrl && (
          <img src={p.thumbnailUrl} alt="" loading="lazy" className="w-full h-full object-cover" />
        )}
        {rank !== undefined && (
          <span className="absolute bottom-1 left-1 min-w-[1.5rem] px-1 py-0.5 rounded text-xs font-bold text-white text-center bg-black/80">
            {rank}
          </span>
        )}
        {badge && (
          <span className={`absolute top-1 left-1 px-1.5 py-0.5 rounded text-[10px] font-bold text-white ${badge.className}`}>
            {badge.label}
          </span>
        )}
        {p.isMemberOnly && (
          <span className="absolute top-1 right-1 px-1.5 py-0.5 rounded text-[10px] text-white bg-black/70">
            限定
          </span>
        )}
        {length && (
          <span className="absolute bottom-1 right-1 px-1 py-0.5 rounded text-xs text-white bg-black/80">{length}</span>
        )}
      </div>
      <div className="p-2 flex-1 flex flex-col">
        <div className="flex items-start gap-1.5 mb-1">
          {p.ownerIconUrl && (
            <img
              src={p.ownerIconUrl}
              alt=""
              className="flex-shrink-0 mt-0.5 w-5 h-5 rounded-full object-cover"
              loading="lazy"
              title={p.ownerName}
            />
          )}
          <div
            className="text-sm font-medium line-clamp-2 min-h-[2.5em] cursor-pointer hover:underline"
            title={p.title}
            onClick={() => onOpen(p.programId)}
          >
            {p.title}
          </div>
        </div>
        {p.ownerName && <div className="text-xs text-nndd-subtext truncate mb-0.5">{p.ownerName}</div>}
        <div className="text-xs text-nndd-subtext flex flex-wrap gap-x-2 gap-y-0.5 min-h-[1.25em]">
          {p.viewers !== undefined && <span>👥 {p.viewers.toLocaleString()}</span>}
          {p.comments !== undefined && <span>💬 {p.comments.toLocaleString()}</span>}
          <span className="ml-auto">{formatDateTime(p.beginAtMs)}</span>
        </div>
        {tsStatus ? (
          <div className={`text-xs ${tsStatus.available ? 'text-pink-400' : 'text-nndd-subtext'}`}>{tsStatus.text}</div>
        ) : (
          p.timeshiftViewingLimitMs !== undefined && (
            <div className="text-xs text-nndd-subtext">視聴期限: {formatDateTime(p.timeshiftViewingLimitMs)}</div>
          )
        )}
        <div className="mt-auto pt-2 flex gap-1">
          <button
            onClick={() => onOpen(p.programId)}
            className="text-xs px-2 py-0.5 bg-nndd-accent text-white rounded hover:opacity-80"
          >
            視聴
          </button>
          {tsAction && onTsAction && (
            <button
              onClick={() => onTsAction(p, tsAction)}
              disabled={tsBusy}
              className="text-xs px-2 py-0.5 bg-nndd-border rounded hover:bg-nndd-accent hover:text-white disabled:opacity-50"
              title={
                tsAction === 'reserve'
                  ? 'タイムシフトを予約する (視聴開始はしません)'
                  : 'タイムシフトの予約を解除する'
              }
            >
              {tsAction === 'reserve' ? 'TS予約' : '予約解除'}
            </button>
          )}
          {onRecordReserve && p.status === 'RELEASED' && (
            <button
              onClick={() => onRecordReserve(p)}
              className={`text-xs px-2 py-0.5 rounded ${
                recordReserved ? 'bg-red-700 text-white hover:opacity-80' : 'bg-nndd-border hover:bg-red-700 hover:text-white'
              }`}
              title={
                recordReserved
                  ? '録画予約を解除する'
                  : '開始時刻になったら自動で録画する (アプリを起動しておく必要があります)'
              }
            >
              {recordReserved ? '● 予約済み (解除)' : '● 予約録画'}
            </button>
          )}
          {onRecord && p.status === 'ON_AIR' && (
            <button
              onClick={() => onRecord(p)}
              className="text-xs px-2 py-0.5 bg-nndd-border rounded hover:bg-red-700 hover:text-white"
              title="放送中の番組を録画する (番組の終了かDLリストの録画停止まで)"
            >
              ● 録画
            </button>
          )}
          {onDownload && p.status === 'ENDED' && p.timeshiftPlayable !== false && p.timeshiftEnabled !== false && (
            <button
              onClick={() => onDownload(p)}
              className="text-xs px-2 py-0.5 bg-nndd-border rounded hover:bg-nndd-accent hover:text-white"
              title="タイムシフトを動画とコメントとして保存する"
            >
              DL
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * メインウィンドウ「生放送」タブ。
 * フォロー中の番組・番組検索・タイムシフト予約の一覧と、番組ID/URL の直接入力で生放送プレイヤーを開く。
 */
export function LiveView(): JSX.Element {
  const [subTab, setSubTab] = useState<SubTab>('followOnair');
  const isLoggedIn = useAppStore((s) => s.isLoggedIn);
  const needsLogin = LOGIN_REQUIRED_TABS.includes(subTab) && !isLoggedIn;
  const [input, setInput] = useState('');
  const [openError, setOpenError] = useState('');
  /** タイムシフト予約・解除の結果メッセージ */
  const [tsMessage, setTsMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const [tsBusyId, setTsBusyId] = useState('');

  const [programs, setPrograms] = useState<LiveProgramSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [keyword, setKeyword] = useState('');
  const [searchStatus, setSearchStatus] = useState<LiveSearchParams['liveStatus']>('onair');
  const [sort, setSort] = useState(SORTS[0].value);
  /** 実行済みの検索条件 (「もっと見る」で同じ条件を使う) */
  const [searched, setSearched] = useState<Omit<LiveSearchParams, 'offset'> | null>(null);
  /** 検索結果のページ (1 始まり、1 ページ LIVE_SEARCH_PAGE_SIZE 件) */
  const [searchPage, setSearchPage] = useState(1);
  const listScrollRef = useRef<HTMLDivElement>(null);
  const [ranking, setRanking] = useState<LiveRankingResult | null>(null);
  const [rankingKind, setRankingKind] = useState<RankingKind>('official');
  const [rankingType, setRankingType] = useState<LiveRankingParams['type']>('onair');
  const [rankingDate, setRankingDate] = useState(todayInput());
  const [recentCategory, setRecentCategory] = useState<LiveRecentCategory>('common');
  const [recentSort, setRecentSort] = useState<LiveRecentParams['sortOrder']>('viewCountDesc');
  const [animeScope, setAnimeScope] = useState<LiveAnimeParams['scope']>('reserved');
  const [animeKind, setAnimeKind] = useState<LiveAnimeParams['kind']>('all');
  /** アニメ生放送ページから読めた会員情報 (見逃し配信の案内に使う) */
  const [animeUser, setAnimeUser] = useState<Pick<LiveAnimeResult, 'isLoggedIn' | 'isPremium'> | null>(null);
  /** fetchList から最新の絞り込み条件を読むための参照 */
  const filterRef = useRef({ rankingType, rankingDate, recentCategory, recentSort, animeScope, animeKind });
  filterRef.current = { rankingType, rankingDate, recentCategory, recentSort, animeScope, animeKind };
  /**
   * 一覧読み込み (load) の連番。読み込み中にサブタブ・絞り込み条件・検索ページを切り替えた場合、
   * 最後に投げた読み込みの結果だけを反映する (前のタブの番組一覧が新しいタブに出ないようにする)
   */
  const loadSeqRef = useRef(0);
  // 外部 (検索タブ・プレイヤー) からの検索でサブタブを検索へ切り替えるとき、切替時の再読込が検索実行の読込を上書きしないようにする
  const skipSubTabSearchLoadRef = useRef(false);

  const fetchList = useCallback(
    async (tab: SubTab, offset: number, search: Omit<LiveSearchParams, 'offset'> | null, seq: number): Promise<LiveProgramListResult | null> => {
      switch (tab) {
        case 'followOnair':
        case 'followReserved':
          return window.nndd.invoke<LiveProgramListResult>(IpcChannel.LIVE_LIST_FOLLOWING, {
            status: tab === 'followOnair' ? 'onair' : 'reserved',
            offset
          });
        case 'timeshift':
          return window.nndd.invoke<LiveProgramListResult>(IpcChannel.LIVE_LIST_TIMESHIFT_RESERVATIONS);
        case 'recordReservations':
          return window.nndd.invoke<LiveProgramListResult>(IpcChannel.LIVE_RECORD_RESERVATIONS);
        case 'ranking': {
          const f = filterRef.current;
          const params: LiveRankingParams = {
            type: f.rankingType,
            date: f.rankingType === 'closed' ? f.rankingDate.replace(/-/g, '') : undefined
          };
          const r = await window.nndd.invoke<LiveRankingResult>(IpcChannel.LIVE_RANKING, params);
          if (seq === loadSeqRef.current) setRanking(r);
          return null;
        }
        case 'recent': {
          const f = filterRef.current;
          const params: LiveRecentParams = {
            category: f.recentCategory,
            sortOrder: f.recentSort,
            page: Math.floor(offset / RECENT_PAGE_SIZE)
          };
          return window.nndd.invoke<LiveProgramListResult>(IpcChannel.LIVE_RECENT, params);
        }
        case 'anime': {
          const f = filterRef.current;
          const params: LiveAnimeParams = { scope: f.animeScope, kind: f.animeKind };
          const r = await window.nndd.invoke<LiveAnimeResult>(IpcChannel.LIVE_ANIME, params);
          if (seq === loadSeqRef.current) setAnimeUser({ isLoggedIn: r.isLoggedIn, isPremium: r.isPremium });
          return r;
        }
        case 'search':
          if (!search) return null;
          return window.nndd.invoke<LiveProgramListResult>(IpcChannel.LIVE_SEARCH, { ...search, offset });
      }
    },
    []
  );

  const load = useCallback(
    async (tab: SubTab, search: Omit<LiveSearchParams, 'offset'> | null, append: boolean, offset: number, autoOpenSingle = false) => {
      const seq = ++loadSeqRef.current;
      setLoading(true);
      setError('');
      try {
        const r = await fetchList(tab, offset, search, seq);
        if (seq !== loadSeqRef.current) return;
        if (!r) {
          setPrograms([]);
          setTotal(0);
          return;
        }
        setPrograms((prev) => (append ? [...prev, ...r.programs] : r.programs));
        setTotal(r.total);
        if (autoOpenSingle && r.programs.length === 1) {
          setOpenError('');
          openPlayer(r.programs[0].programId).catch((e) => setOpenError(errorText(e)));
        }
      } catch (e) {
        if (seq !== loadSeqRef.current) return;
        setError(errorText(e));
        if (!append) setPrograms([]);
      } finally {
        if (seq === loadSeqRef.current) setLoading(false);
      }
    },
    [fetchList]
  );

  // サブタブ切替時に読み込む (検索タブは検索実行時のみ)
  useEffect(() => {
    setTsMessage(null);
    if (subTab === 'search') {
      if (skipSubTabSearchLoadRef.current) {
        skipSubTabSearchLoadRef.current = false;
        return;
      }
      setSearchPage(1);
      void load('search', searched, false, 0);
    } else {
      void load(subTab, null, false, 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- サブタブ切替時だけ読み込む (検索条件の変更では読み直さない)
  }, [subTab]);

  // ログイン状態が確定/変化したらログイン必須タブを読み直す
  useEffect(() => {
    if (LOGIN_REQUIRED_TABS.includes(subTab)) void load(subTab, null, false, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ログイン状態の変化だけを見る
  }, [isLoggedIn]);

  // 絞り込み条件の変更で読み直す
  useEffect(() => {
    if (subTab === 'ranking') void load('ranking', null, false, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- サブタブ切替時の読込は上の effect が行うため、ここでは絞り込み条件の変化だけを見る
  }, [rankingType, rankingDate]);
  useEffect(() => {
    if (subTab === 'recent') void load('recent', null, false, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- サブタブ切替時の読込は上の effect が行うため、ここでは絞り込み条件の変化だけを見る
  }, [recentCategory, recentSort]);

  useEffect(() => {
    if (subTab === 'anime') void load('anime', null, false, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- サブタブ切替時の読込は上の effect が行うため、ここでは絞り込み条件の変化だけを見る
  }, [animeScope, animeKind]);

  const runSearch = (wordArg?: string): void => {
    const word = (wordArg ?? keyword).trim();
    if (!word) return;
    const [s, o] = sort.split(':');
    const cond = {
      keyword: word,
      liveStatus: searchStatus,
      sort: s as LiveSearchParams['sort'],
      order: o as LiveSearchParams['order']
    };
    setSearched(cond);
    setSearchPage(1);
    // 番組ID/URL を入力した検索で1件だけ見つかった場合は自動で再生する
    void load('search', cond, false, 0, extractLiveIdFromInput(word) !== null);
  };

  /** 検索結果のページ移動 (動画の検索画面と同じ ◀ 前 / 次 ▶) */
  const goSearchPage = (page: number): void => {
    if (!searched || page < 1) return;
    setSearchPage(page);
    void load('search', searched, false, (page - 1) * LIVE_SEARCH_PAGE_SIZE);
    listScrollRef.current?.scrollTo({ top: 0 });
  };
  const searchTotalPages = total > 0 ? Math.ceil(total / LIVE_SEARCH_PAGE_SIZE) : 0;

  // 生放送プレイヤーのタグから来た検索 (放送中の番組をキーワード検索する)
  const pendingLiveSearch = useAppStore((s) => s.pendingLiveSearch);
  const setPendingLiveSearch = useAppStore((s) => s.setPendingLiveSearch);
  useEffect(() => {
    if (!pendingLiveSearch) return;
    setPendingLiveSearch(null);
    if (subTab !== 'search') skipSubTabSearchLoadRef.current = true;
    setSubTab('search');
    setKeyword(pendingLiveSearch);
    runSearch(pendingLiveSearch);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runSearch は毎回作り直されるため、pendingLiveSearch が来た時だけ検索する
  }, [pendingLiveSearch]);

  const onOpen = (id: string): void => {
    setOpenError('');
    openPlayer(id).catch((e) => setOpenError(errorText(e)));
  };

  const onTsAction = async (p: LiveProgramSummary, action: 'reserve' | 'cancel'): Promise<void> => {
    if (action === 'cancel' && !window.confirm(`「${p.title}」のタイムシフト予約を解除しますか？`)) return;
    setTsBusyId(p.programId);
    setTsMessage(null);
    try {
      if (action === 'reserve') {
        await window.nndd.invoke(IpcChannel.LIVE_TIMESHIFT_RESERVE, p.programId);
        setTsMessage({ text: `タイムシフトを予約しました: ${p.title}`, isError: false });
      } else {
        await window.nndd.invoke(IpcChannel.LIVE_TIMESHIFT_CANCEL, [p.programId]);
        setPrograms((prev) => prev.filter((x) => x.programId !== p.programId));
        setTotal((n) => Math.max(0, n - 1));
        setTsMessage({ text: `予約を解除しました: ${p.title}`, isError: false });
      }
    } catch (e) {
      setTsMessage({ text: errorText(e), isError: true });
    } finally {
      setTsBusyId('');
    }
  };

  /** 録画予約済みの番組ID */
  const [reservedIds, setReservedIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    window.nndd
      .invoke<LiveProgramListResult>(IpcChannel.LIVE_RECORD_RESERVATIONS)
      .then((r) => setReservedIds(new Set(r.programs.map((x) => x.programId))))
      .catch(() => {});
  }, []);

  const onRecordReserve = (p: LiveProgramSummary): void => {
    const reserved = reservedIds.has(p.programId);
    const task = reserved
      ? window.nndd.invoke(IpcChannel.LIVE_RECORD_UNRESERVE, p.programId)
      : window.nndd.invoke(IpcChannel.LIVE_RECORD_RESERVE, {
          programId: p.programId,
          title: p.title,
          thumbnailUrl: p.thumbnailUrl,
          ownerName: p.ownerName,
          beginAtMs: p.beginAtMs,
          endAtMs: p.endAtMs
        });
    task
      .then(() => {
        setReservedIds((prev) => {
          const next = new Set(prev);
          if (reserved) next.delete(p.programId);
          else next.add(p.programId);
          return next;
        });
        if (reserved && subTab === 'recordReservations') {
          setPrograms((prev) => prev.filter((x) => x.programId !== p.programId));
          setTotal((n) => Math.max(0, n - 1));
        }
        setTsMessage({
          text: reserved ? `録画予約を解除しました: ${p.title}` : `録画を予約しました: ${p.title}`,
          isError: false
        });
      })
      .catch((e) => setTsMessage({ text: errorText(e), isError: true }));
  };

  const onRecord = (p: LiveProgramSummary): void => {
    enqueueLiveRecord(p.programId, p.thumbnailUrl)
      .then((text) => {
        if (text) setTsMessage({ text, isError: false });
      })
      .catch((e) => setTsMessage({ text: errorText(e), isError: true }));
  };

  const onDownload = (p: LiveProgramSummary): void => {
    const text = enqueueLiveDownload(p.programId, p.title, p.thumbnailUrl);
    if (text) setTsMessage({ text, isError: false });
  };

  /** カードに出すタイムシフト操作。予約一覧では解除、それ以外は予約 (視聴不可の終了番組には出さない) */
  const tsActionFor = (p: LiveProgramSummary): 'reserve' | 'cancel' | undefined => {
    if (subTab === 'timeshift') return 'cancel';
    if (subTab === 'recordReservations') return undefined;
    if (p.timeshiftEnabled === false) return undefined;
    if (p.status === 'ENDED' && p.timeshiftPlayable === false) return undefined;
    return 'reserve';
  };

  const isRanking = subTab === 'ranking';
  const shown = isRanking ? (ranking?.[rankingKind] ?? []) : programs;
  const cardItems = useMemo(
    () =>
      shown.map((p, i) => ({
        key: `${p.programId}-${i}`,
        p,
        rank: isRanking ? i + 1 : undefined
      })),
    [shown, isRanking]
  );
  const canLoadMore =
    !isRanking &&
    subTab !== 'timeshift' &&
    subTab !== 'recordReservations' &&
    subTab !== 'search' &&
    // アニメ生放送はページから一度に全件読むので続きは無い
    subTab !== 'anime' &&
    // 放送予定はページの埋め込みデータから一度に全件読むので続きは無い
    subTab !== 'followReserved' &&
    programs.length < total &&
    !loading;
  const loadMore = useCallback(() => void load(subTab, null, true, programs.length), [load, subTab, programs.length]);
  const onNearEnd = canLoadMore ? loadMore : undefined;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* 直接入力 */}
      <form
        className="flex items-center gap-2 p-3 border-b border-nndd-border"
        onSubmit={(e) => {
          e.preventDefault();
          if (input.trim()) onOpen(input.trim());
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="flex-1 bg-nndd-bg border border-nndd-border px-2 py-1 text-sm"
          placeholder="番組ID (lv / co / ch) または生放送ページの URL"
        />
        <button
          type="submit"
          disabled={!input.trim()}
          className="px-3 py-1 text-sm rounded bg-nndd-accent text-white disabled:opacity-50"
        >
          視聴
        </button>
      </form>
      {openError && <div className="px-3 pt-2 text-xs text-red-500">{openError}</div>}
      {tsMessage && (
        <div className={`px-3 pt-2 text-xs ${tsMessage.isError ? 'text-red-500' : 'text-green-500'}`}>
          {tsMessage.text}
        </div>
      )}

      {/* サブタブ */}
      <div className="flex items-center gap-1 px-3 pt-2 border-b border-nndd-border">
        {SUB_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id)}
            className={[
              'px-3 py-1 text-xs rounded-t',
              subTab === t.id ? 'bg-nndd-accent text-white' : 'hover:bg-nndd-border'
            ].join(' ')}
          >
            {t.label}
          </button>
        ))}
        <div className="flex-1" />
        {subTab !== 'search' && (
          <button
            onClick={() => void load(subTab, null, false, 0)}
            disabled={loading}
            className="px-2 py-1 text-xs hover:bg-nndd-border rounded disabled:opacity-50"
          >
            更新
          </button>
        )}
      </div>

      {/* 検索条件 */}
      {subTab === 'search' && (
        <form
          className="flex flex-wrap items-center gap-2 p-3 border-b border-nndd-border"
          onSubmit={(e) => {
            e.preventDefault();
            runSearch();
          }}
        >
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="flex-1 min-w-[12rem] bg-nndd-bg border border-nndd-border px-2 py-1 text-sm"
            placeholder="キーワード"
          />
          <select
            value={searchStatus}
            onChange={(e) => setSearchStatus(e.target.value as LiveSearchParams['liveStatus'])}
            className="bg-nndd-bg border border-nndd-border px-1 py-1 text-sm"
          >
            <option value="onair">放送中</option>
            <option value="reserved">放送予定</option>
            <option value="past">過去</option>
          </select>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="bg-nndd-bg border border-nndd-border px-1 py-1 text-sm"
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={!keyword.trim() || loading}
            className="px-3 py-1 text-sm rounded bg-nndd-accent text-white disabled:opacity-50"
          >
            検索
          </button>
        </form>
      )}

      {/* ランキング種別 */}
      {isRanking && (
        <div className="flex flex-wrap items-center gap-1 px-3 pt-2">
          <select
            value={rankingType}
            onChange={(e) => setRankingType(e.target.value as LiveRankingParams['type'])}
            className="bg-nndd-bg border border-nndd-border px-1 py-0.5 text-xs mr-1"
          >
            {RANKING_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          {rankingType === 'closed' && (
            <input
              type="date"
              value={rankingDate}
              max={todayInput()}
              onChange={(e) => e.target.value && setRankingDate(e.target.value)}
              className="bg-nndd-bg border border-nndd-border px-1 py-0.5 text-xs mr-1"
            />
          )}
          {(['official', 'user'] as const).map((k) => (
            <button
              key={k}
              onClick={() => setRankingKind(k)}
              className={[
                'px-3 py-0.5 text-xs rounded border',
                rankingKind === k
                  ? 'bg-nndd-accent text-white border-nndd-accent'
                  : 'border-nndd-border hover:bg-nndd-border'
              ].join(' ')}
            >
              {k === 'official' ? '公式・チャンネル' : 'ユーザー'}
            </button>
          ))}
        </div>
      )}

      {/* カテゴリ */}
      {subTab === 'recent' && (
        <div className="flex flex-wrap items-center gap-1 px-3 pt-2">
          {RECENT_CATEGORIES.map((c) => (
            <button
              key={c.value}
              onClick={() => setRecentCategory(c.value)}
              className={[
                'px-3 py-0.5 text-xs rounded border',
                recentCategory === c.value
                  ? 'bg-nndd-accent text-white border-nndd-accent'
                  : 'border-nndd-border hover:bg-nndd-border'
              ].join(' ')}
            >
              {c.label}
            </button>
          ))}
          <select
            value={recentSort}
            onChange={(e) => setRecentSort(e.target.value as LiveRecentParams['sortOrder'])}
            className="ml-2 bg-nndd-bg border border-nndd-border px-1 py-0.5 text-xs"
          >
            {RECENT_SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* アニメ生放送 (anime.nicovideo.jp/live) */}
      {subTab === 'anime' && (
        <div className="px-3 pt-2 space-y-1.5">
          <div className="flex flex-wrap items-center gap-1">
            {ANIME_SCOPES.map((c) => (
              <button
                key={c.value}
                onClick={() => setAnimeScope(c.value)}
                className={[
                  'px-3 py-0.5 text-xs rounded border',
                  animeScope === c.value
                    ? 'bg-nndd-accent text-white border-nndd-accent'
                    : 'border-nndd-border hover:bg-nndd-border'
                ].join(' ')}
              >
                {c.label}
              </button>
            ))}
            <span className="mx-1 text-nndd-border">|</span>
            {ANIME_KINDS.map((c) => (
              <button
                key={c.value}
                onClick={() => setAnimeKind(c.value)}
                className={[
                  'px-3 py-0.5 text-xs rounded border',
                  animeKind === c.value
                    ? 'bg-nndd-accent text-white border-nndd-accent'
                    : 'border-nndd-border hover:bg-nndd-border'
                ].join(' ')}
              >
                {c.label}
              </button>
            ))}
          </div>
          {animeScope === 'past' && animeUser && (
            <div className="text-xs text-nndd-subtext">
              {animeUser.isPremium
                ? 'プレミアム会員: 事前予約をしていなくても、見逃し配信を視聴できます。'
                : 'ニコニコプレミアムなら事前予約をしていなくても過去番組を視聴できます。一般会員は放送前にタイムシフト予約をした番組のみ視聴できます (ログインが必要)。'}
              {animeUser.isLoggedIn && animeUser.isPremium === null && ' (会員種別を判定できませんでした)'}
            </div>
          )}
          {animeScope === 'reserved' && (
            <div className="text-xs text-nndd-subtext">
              「プレミアム限定」と題された番組はプレミアム会員のみ視聴できます。タイムシフト予約はログインが必要です。
            </div>
          )}
        </div>
      )}

      {/* 検索結果の件数 + ページ移動 (動画の検索画面と同じ固定バー) */}
      {subTab === 'search' && searched && (programs.length > 0 || loading) && (
        <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-nndd-border bg-nndd-panel text-xs">
          <span className="text-nndd-subtext">
            {total > 0
              ? `${total.toLocaleString()} 件中 ${(searchPage - 1) * LIVE_SEARCH_PAGE_SIZE + 1}–${Math.min(searchPage * LIVE_SEARCH_PAGE_SIZE, total)} 件表示`
              : loading
                ? '検索中…'
                : ''}
          </span>
          <div className="flex items-center gap-1 ml-auto">
            <button
              onClick={() => goSearchPage(searchPage - 1)}
              disabled={loading || searchPage <= 1}
              className="px-2 py-0.5 bg-nndd-border rounded hover:bg-nndd-accent disabled:opacity-40"
            >
              ◀ 前
            </button>
            <span className="text-nndd-subtext px-2">
              {searchPage} / {searchTotalPages || 1}
            </span>
            <button
              onClick={() => goSearchPage(searchPage + 1)}
              disabled={loading || searchPage >= searchTotalPages}
              className="px-2 py-0.5 bg-nndd-border rounded hover:bg-nndd-accent disabled:opacity-40"
            >
              次 ▶
            </button>
          </div>
        </div>
      )}

      {/* 一覧 */}
      <div ref={listScrollRef} className="flex-1 min-h-0 overflow-y-auto p-3">
        {needsLogin && (
          <div className="text-xs text-nndd-subtext">
            ログインが必要です。右上の「ログイン」からニコニコ動画にログインしてください。
          </div>
        )}
        {!needsLogin && error && <div className="mb-2 text-xs text-red-500">{error}</div>}
        {!needsLogin && !loading && !error && shown.length === 0 && (
          <div className="text-xs text-nndd-subtext">
            {subTab === 'search' && !searched ? 'キーワードを入力して検索してください。' : '番組がありません。'}
          </div>
        )}
        {/* 列数・カード幅は動画一覧と同じ VirtualizedItemList のグリッドで決める */}
        <VirtualizedItemList
          items={cardItems}
          layout="grid"
          scrollElementRef={listScrollRef}
          onNearEnd={onNearEnd}
          getKey={(c) => c.key}
          renderItem={(c) => (
            <ProgramCard
              p={c.p}
              rank={c.rank}
              onOpen={onOpen}
              tsAction={tsActionFor(c.p)}
              tsBusy={tsBusyId === c.p.programId}
              onTsAction={(p, a) => void onTsAction(p, a)}
              onDownload={onDownload}
              onRecord={onRecord}
              recordReserved={reservedIds.has(c.p.programId)}
              onRecordReserve={onRecordReserve}
            />
          )}
        />
        {loading && <div className="mt-3 text-xs text-nndd-subtext">読み込み中…</div>}
        {canLoadMore && (
          <div className="mt-3 text-center">
            <button
              onClick={() => void load(subTab, null, true, programs.length)}
              className="px-4 py-1 text-xs rounded border border-nndd-border hover:bg-nndd-border"
            >
              もっと見る ({programs.length} / {total})
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
