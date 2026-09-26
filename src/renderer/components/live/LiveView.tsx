import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  LiveProgramListResult,
  LiveProgramSummary,
  LiveRankingParams,
  LiveRankingResult,
  LiveRecentCategory,
  LiveRecentParams,
  LiveSearchParams
} from '@shared/types';
import { IpcChannel, LIVE_SEARCH_PAGE_SIZE } from '@shared/types';
import { useAppStore } from '@renderer/store/useAppStore';

type SubTab = 'followOnair' | 'followReserved' | 'ranking' | 'recent' | 'search' | 'timeshift';
type RankingKind = 'official' | 'user';

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: 'followOnair', label: 'フォロー中 (放送中)' },
  { id: 'followReserved', label: 'フォロー中 (予約)' },
  { id: 'ranking', label: 'ランキング' },
  { id: 'recent', label: 'カテゴリ' },
  { id: 'search', label: '検索' },
  { id: 'timeshift', label: 'タイムシフト予約' }
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

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  ON_AIR: { label: '放送中', className: 'bg-red-600' },
  RELEASED: { label: '予約', className: 'bg-blue-600' },
  ENDED: { label: '終了', className: 'bg-neutral-600' }
};

function openPlayer(input: string): Promise<void> {
  return window.nndd.invoke(IpcChannel.LIVE_OPEN_PLAYER, input);
}

function ProgramCard({
  p,
  rank,
  onOpen
}: {
  p: LiveProgramSummary;
  /** ランキング順位 (ランキング表示時のみ) */
  rank?: number;
  onOpen: (id: string) => void;
}): JSX.Element {
  const badge = STATUS_BADGE[p.status];
  return (
    <button
      onClick={() => onOpen(p.programId)}
      className="flex flex-col text-left rounded border border-nndd-border bg-nndd-panel hover:border-nndd-accent overflow-hidden"
      title={p.title}
    >
      <div className="relative w-full aspect-video bg-black">
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
      </div>
      <div className="p-2 flex flex-col gap-1 min-w-0">
        <div className="text-xs font-bold line-clamp-2">{p.title}</div>
        {p.ownerName && (
          <div className="flex items-center gap-1 text-[11px] text-nndd-subtext min-w-0">
            {p.ownerIconUrl && <img src={p.ownerIconUrl} alt="" className="w-4 h-4 rounded-full shrink-0" />}
            <span className="truncate">{p.ownerName}</span>
          </div>
        )}
        <div className="text-[11px] text-nndd-subtext tabular-nums">
          {formatDateTime(p.beginAtMs)}
          {p.viewers !== undefined && ` ・ 来場 ${p.viewers.toLocaleString()}`}
          {p.comments !== undefined && ` ・ コメ ${p.comments.toLocaleString()}`}
        </div>
        {p.status === 'ENDED' && p.timeshiftPlayable === false && (
          <div className="text-[11px] text-nndd-subtext">タイムシフト視聴不可</div>
        )}
      </div>
    </button>
  );
}

/**
 * メインウィンドウ「生放送」タブ。
 * フォロー中の番組・番組検索・タイムシフト予約の一覧と、番組ID/URL の直接入力で生放送プレイヤーを開く。
 */
export function LiveView(): JSX.Element {
  const [subTab, setSubTab] = useState<SubTab>('followOnair');
  const [input, setInput] = useState('');
  const [openError, setOpenError] = useState('');

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
  /** fetchList から最新の絞り込み条件を読むための参照 */
  const filterRef = useRef({ rankingType, rankingDate, recentCategory, recentSort });
  filterRef.current = { rankingType, rankingDate, recentCategory, recentSort };

  const fetchList = useCallback(
    async (tab: SubTab, offset: number, search: Omit<LiveSearchParams, 'offset'> | null): Promise<LiveProgramListResult | null> => {
      switch (tab) {
        case 'followOnair':
        case 'followReserved':
          return window.nndd.invoke<LiveProgramListResult>(IpcChannel.LIVE_LIST_FOLLOWING, {
            status: tab === 'followOnair' ? 'onair' : 'reserved',
            offset
          });
        case 'timeshift':
          return window.nndd.invoke<LiveProgramListResult>(IpcChannel.LIVE_LIST_TIMESHIFT_RESERVATIONS);
        case 'ranking': {
          const f = filterRef.current;
          const params: LiveRankingParams = {
            type: f.rankingType,
            date: f.rankingType === 'closed' ? f.rankingDate.replace(/-/g, '') : undefined
          };
          const r = await window.nndd.invoke<LiveRankingResult>(IpcChannel.LIVE_RANKING, params);
          setRanking(r);
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
        case 'search':
          if (!search) return null;
          return window.nndd.invoke<LiveProgramListResult>(IpcChannel.LIVE_SEARCH, { ...search, offset });
      }
    },
    []
  );

  const load = useCallback(
    async (tab: SubTab, search: Omit<LiveSearchParams, 'offset'> | null, append: boolean, offset: number) => {
      setLoading(true);
      setError('');
      try {
        const r = await fetchList(tab, offset, search);
        if (!r) {
          setPrograms([]);
          setTotal(0);
          return;
        }
        setPrograms((prev) => (append ? [...prev, ...r.programs] : r.programs));
        setTotal(r.total);
      } catch (e) {
        setError(errorText(e));
        if (!append) setPrograms([]);
      } finally {
        setLoading(false);
      }
    },
    [fetchList]
  );

  // サブタブ切替時に読み込む (検索タブは検索実行時のみ)
  useEffect(() => {
    if (subTab === 'search') {
      setSearchPage(1);
      void load('search', searched, false, 0);
    } else {
      void load(subTab, null, false, 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subTab]);

  // 絞り込み条件の変更で読み直す
  useEffect(() => {
    if (subTab === 'ranking') void load('ranking', null, false, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rankingType, rankingDate]);
  useEffect(() => {
    if (subTab === 'recent') void load('recent', null, false, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentCategory, recentSort]);

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
    void load('search', cond, false, 0);
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
    setSubTab('search');
    setKeyword(pendingLiveSearch);
    runSearch(pendingLiveSearch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingLiveSearch]);

  const onOpen = (id: string): void => {
    setOpenError('');
    openPlayer(id).catch((e) => setOpenError(errorText(e)));
  };

  const isRanking = subTab === 'ranking';
  const shown = isRanking ? (ranking?.[rankingKind] ?? []) : programs;
  const canLoadMore =
    !isRanking && subTab !== 'timeshift' && subTab !== 'search' && programs.length < total && !loading;

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
        {error && <div className="mb-2 text-xs text-red-500">{error}</div>}
        {!loading && !error && shown.length === 0 && (
          <div className="text-xs text-nndd-subtext">
            {subTab === 'search' && !searched ? 'キーワードを入力して検索してください。' : '番組がありません。'}
          </div>
        )}
        <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(200px,1fr))]">
          {shown.map((p, i) => (
            <ProgramCard
              key={`${p.programId}-${i}`}
              p={p}
              rank={isRanking ? i + 1 : undefined}
              onOpen={onOpen}
            />
          ))}
        </div>
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
