import { useCallback, useEffect, useState } from 'react';
import type { LiveProgramListResult, LiveProgramSummary, LiveSearchParams } from '@shared/types';
import { IpcChannel } from '@shared/types';

type SubTab = 'followOnair' | 'followReserved' | 'search' | 'timeshift';

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: 'followOnair', label: 'フォロー中 (放送中)' },
  { id: 'followReserved', label: 'フォロー中 (予約)' },
  { id: 'search', label: '検索' },
  { id: 'timeshift', label: 'タイムシフト予約' }
];

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

function ProgramCard({ p, onOpen }: { p: LiveProgramSummary; onOpen: (id: string) => void }): JSX.Element {
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
      void load('search', searched, false, 0);
    } else {
      void load(subTab, null, false, 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subTab]);

  const runSearch = (): void => {
    const word = keyword.trim();
    if (!word) return;
    const [s, o] = sort.split(':');
    const cond = {
      keyword: word,
      liveStatus: searchStatus,
      sort: s as LiveSearchParams['sort'],
      order: o as LiveSearchParams['order']
    };
    setSearched(cond);
    void load('search', cond, false, 0);
  };

  const onOpen = (id: string): void => {
    setOpenError('');
    openPlayer(id).catch((e) => setOpenError(errorText(e)));
  };

  const canLoadMore = subTab !== 'timeshift' && programs.length < total && !loading;

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

      {/* 一覧 */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        {error && <div className="mb-2 text-xs text-red-500">{error}</div>}
        {!loading && !error && programs.length === 0 && (
          <div className="text-xs text-nndd-subtext">
            {subTab === 'search' && !searched ? 'キーワードを入力して検索してください。' : '番組がありません。'}
          </div>
        )}
        <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(200px,1fr))]">
          {programs.map((p, i) => (
            <ProgramCard key={`${p.programId}-${i}`} p={p} onOpen={onOpen} />
          ))}
        </div>
        {loading && <div className="mt-3 text-xs text-nndd-subtext">読み込み中…</div>}
        {canLoadMore && (
          <div className="mt-3 text-center">
            <button
              onClick={() => void load(subTab, subTab === 'search' ? searched : null, true, programs.length)}
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
