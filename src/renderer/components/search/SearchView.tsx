import { useEffect, useState } from 'react';
import type {
  SearchItem,
  SearchResultItem,
  NNDDRESearchTypeValue,
  NNDDRESearchSortTypeValue
} from '@shared/types';
import { NNDDRESearchType, NNDDRESearchSortType } from '@shared/types';
import { VideoCard } from '../common/VideoCard';
import { ContinuousPlayButton } from '../common/ContinuousPlayButton';
import { useAppStore } from '@renderer/store/useAppStore';

/**
 * 検索タブ。
 * ①ページネーション ②グリッド/リスト切替 ③contentViewMode設定参照
 */
const SESSION_KEY = 'nndd:search:state';
const LIMIT = 32;

type DisplayMode = 'grid' | 'list';

interface PersistedState {
  word: string;
  type: NNDDRESearchTypeValue;
  sortType: NNDDRESearchSortTypeValue;
  results: SearchResultItem[];
  total: number;
  page: number;
}

function loadPersistedState(): PersistedState | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedState;
    parsed.results = parsed.results.map((r) => ({
      ...r,
      registeredAt: r.registeredAt ? new Date(r.registeredAt) : r.registeredAt
    }));
    return parsed;
  } catch {
    return null;
  }
}

export function SearchView(): JSX.Element {
  const persisted = loadPersistedState();
  const [word, setWord] = useState(persisted?.word ?? '');
  const [type, setType] = useState<NNDDRESearchTypeValue>(
    persisted?.type ?? NNDDRESearchType.KEYWORD
  );
  const [sortType, setSortType] = useState<NNDDRESearchSortTypeValue>(
    persisted?.sortType ?? NNDDRESearchSortType.VIEW_COUNT_DESC
  );
  const [results, setResults] = useState<SearchResultItem[]>(persisted?.results ?? []);
  const [total, setTotal] = useState(persisted?.total ?? 0);
  const [page, setPage] = useState(persisted?.page ?? 1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedSearches, setSavedSearches] = useState<SearchItem[]>([]);
  const [downloadedIds, setDownloadedIds] = useState<Set<string>>(new Set());
  const [saveName, setSaveName] = useState('');
  const globalMode = useAppStore((s) => s.contentViewMode);
  const [displayMode, setDisplayMode] = useState<DisplayMode>(globalMode as DisplayMode);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const setPendingMylistId = useAppStore((s) => s.setPendingMylistId);
  const setPendingSeriesId = useAppStore((s) => s.setPendingSeriesId);
  const pendingSearchTag = useAppStore((s) => s.pendingSearchTag);
  const setPendingSearchTag = useAppStore((s) => s.setPendingSearchTag);
  const showToast = useAppStore((s) => s.showToast);

  // グローバル設定変更を即時反映
  useEffect(() => { setDisplayMode(globalMode as DisplayMode); }, [globalMode]);

  // sessionStorage に保存
  useEffect(() => {
    const state: PersistedState = { word, type, sortType, results, total, page };
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(state));
    } catch { /* ignore */ }
  }, [word, type, sortType, results, total, page]);

  const reloadSaved = (): void => {
    window.nndd
      .invoke<SearchItem[]>(window.nndd.channels.SEARCH_SAVED_LIST)
      .then(setSavedSearches);
  };

  useEffect(reloadSaved, []);

  // プレイヤーからのタグ検索
  useEffect(() => {
    if (!pendingSearchTag) return;
    const tag = pendingSearchTag;
    setPendingSearchTag(null);
    setWord(tag);
    setType(NNDDRESearchType.TAG);
    setPage(1);
    setLoading(true);
    setError(null);
    window.nndd
      .invoke<{ items: SearchResultItem[]; totalCount: number }>(
        window.nndd.channels.SEARCH_EXECUTE,
        { word: tag, type: NNDDRESearchType.TAG, sortType, offset: 0, limit: LIMIT }
      )
      .then((r) => {
        setResults(r.items);
        setTotal(r.totalCount);
        const ids = r.items.map((i) => i.videoId);
        window.nndd
          .invoke<string[]>(window.nndd.channels.LIBRARY_CHECK_BATCH, ids)
          .then((dl) => setDownloadedIds(new Set(dl)))
          .catch(() => {});
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSearchTag]);

  /** マイリスト/シリーズURL・IDを検出してそのタブへ遷移 */
  const handleNavigate = (input: string): boolean => {
    const ml = input.match(/nicovideo\.jp(?:\/user\/\d+)?\/mylist\/(\d+)/) ||
               input.match(/^mylist\/(\d+)$/i);
    if (ml) {
      setActiveTab('mylist');
      setPendingMylistId(ml[1]);
      return true;
    }
    const sr = input.match(/nicovideo\.jp(?:\/user\/\d+)?\/series\/(\d+)/) ||
               input.match(/^series\/(\d+)$/i);
    if (sr) {
      setActiveTab('mylist');
      setPendingSeriesId(sr[1]);
      return true;
    }
    return false;
  };

  const handleSearch = async (targetPage = 1): Promise<void> => {
    const trimmed = word.trim();
    if (!trimmed) return;
    // マイリスト/シリーズURLならナビゲーション
    if (targetPage === 1 && handleNavigate(trimmed)) return;
    setLoading(true);
    setError(null);
    try {
      const r = await window.nndd.invoke<{
        items: SearchResultItem[];
        totalCount: number;
      }>(window.nndd.channels.SEARCH_EXECUTE, {
        word: word.trim(),
        type,
        sortType,
        offset: (targetPage - 1) * LIMIT,
        limit: LIMIT
      });
      setResults(r.items);
      setTotal(r.totalCount);
      setPage(targetPage);
      const ids = r.items.map((i) => i.videoId);
      window.nndd
        .invoke<string[]>(window.nndd.channels.LIBRARY_CHECK_BATCH, ids)
        .then((dl) => setDownloadedIds(new Set(dl)))
        .catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handlePlay = (videoId: string): void => {
    window.nndd.invoke(window.nndd.channels.VIDEO_OPEN_PLAYER, { videoId });
  };

  const handlePlayAudioOnly = (videoId: string): void => {
    window.nndd.invoke(window.nndd.channels.VIDEO_OPEN_PLAYER, { videoId, audioOnly: true });
  };

  const handleDownload = (videoId: string): void => {
    const commentOnly = downloadedIds.has(videoId);
    window.nndd.invoke(window.nndd.channels.DOWNLOAD_ENQUEUE, { videoId, commentOnly });
    showToast(commentOnly ? 'コメントのみDLリストに追加しました' : 'DLリストに追加しました');
  };

  const handleSave = async (): Promise<void> => {
    if (!saveName.trim() || !word.trim()) return;
    const item: SearchItem = {
      id: crypto.randomUUID(),
      name: saveName.trim(),
      word: word.trim(),
      type,
      sortType
    };
    await window.nndd.invoke(window.nndd.channels.SEARCH_SAVED_ADD, item);
    setSaveName('');
    reloadSaved();
  };

  const handleLoadSaved = (s: SearchItem): void => {
    setWord(s.word);
    setType(s.type);
    setSortType(s.sortType);
  };

  const handleRemoveSaved = async (id: string): Promise<void> => {
    await window.nndd.invoke(window.nndd.channels.SEARCH_SAVED_REMOVE, id);
    reloadSaved();
  };

  const totalPages = total > 0 ? Math.ceil(total / LIMIT) : 0;

  return (
    <div className="h-full flex">
      {/* 左: 保存検索 */}
      <aside className="w-56 border-r border-nndd-border bg-nndd-panel p-2 overflow-y-auto">
        <div className="font-bold text-xs text-nndd-subtext mb-2">
          保存した検索
        </div>
        {savedSearches.length === 0 ? (
          <div className="text-xs text-nndd-subtext">なし</div>
        ) : (
          savedSearches.map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-1 p-1 hover:bg-nndd-border rounded text-xs"
            >
              <button
                onClick={() => handleLoadSaved(s)}
                className="flex-1 text-left truncate"
                title={s.word}
              >
                {s.name}
              </button>
              <button
                onClick={() => handleRemoveSaved(s.id)}
                className="text-nndd-subtext hover:text-red-500 dark:hover:text-red-400"
                title="削除"
              >
                ×
              </button>
            </div>
          ))
        )}
      </aside>

      {/* 右: 検索フォーム + 結果 */}
      <main className="flex-1 flex flex-col">
        <div className="p-2 border-b border-nndd-border bg-nndd-panel flex flex-wrap items-center gap-2">
          <input
            value={word}
            onChange={(e) => setWord(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSearch(1);
            }}
            placeholder="検索ワード"
            className="flex-1 min-w-[200px] bg-nndd-bg border border-nndd-border px-2 py-1 text-sm"
          />
          <select
            value={type}
            onChange={(e) => setType(e.target.value as NNDDRESearchTypeValue)}
            className="bg-nndd-bg border border-nndd-border px-2 py-1 text-sm"
          >
            <option value={NNDDRESearchType.KEYWORD}>キーワード</option>
            <option value={NNDDRESearchType.TAG}>タグ完全一致</option>
          </select>
          <select
            value={sortType}
            onChange={(e) => setSortType(e.target.value as NNDDRESearchSortTypeValue)}
            className="bg-nndd-bg border border-nndd-border px-2 py-1 text-sm"
          >
            <option value={NNDDRESearchSortType.VIEW_COUNT_DESC}>再生数 多い順</option>
            <option value={NNDDRESearchSortType.COMMENT_COUNT_DESC}>コメ多い順</option>
            <option value={NNDDRESearchSortType.MYLIST_COUNT_DESC}>マイリス多い順</option>
            <option value={NNDDRESearchSortType.LIKE_COUNT_DESC}>いいね多い順</option>
            <option value={NNDDRESearchSortType.REGISTERED_AT_DESC}>新着順</option>
            <option value={NNDDRESearchSortType.REGISTERED_AT_ASC}>古い順</option>
            <option value={NNDDRESearchSortType.LENGTH_ASC}>長さ短い順</option>
            <option value={NNDDRESearchSortType.LENGTH_DESC}>長さ長い順</option>
          </select>
          <button
            onClick={() => handleSearch(1)}
            disabled={loading}
            className="text-xs px-3 py-1 bg-nndd-accent text-white rounded hover:opacity-80 disabled:opacity-50"
          >
            {loading ? '検索中…' : '検索'}
          </button>

          {/* 保存ボタン */}
          <span className="border-l border-nndd-border h-6 mx-1" />
          <input
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            placeholder="保存名"
            className="w-32 bg-nndd-bg border border-nndd-border px-2 py-1 text-sm"
          />
          <button
            onClick={handleSave}
            disabled={!saveName.trim() || !word.trim()}
            className="text-xs px-3 py-1 bg-nndd-border rounded hover:bg-nndd-accent disabled:opacity-50"
          >
            保存
          </button>

          {/* 表示切替 */}
          <div className="flex border border-nndd-border rounded overflow-hidden ml-auto">
            <button
              onClick={() => setDisplayMode('grid')}
              className={`text-xs px-2 py-1 ${displayMode === 'grid' ? 'bg-nndd-accent text-white' : 'hover:bg-nndd-border'}`}
              title="グリッド表示"
            >⊞</button>
            <button
              onClick={() => setDisplayMode('list')}
              className={`text-xs px-2 py-1 ${displayMode === 'list' ? 'bg-nndd-accent text-white' : 'hover:bg-nndd-border'}`}
              title="リスト表示"
            >☰</button>
          </div>
        </div>

        {/* 件数 + ページネーション (固定バー) */}
        {(results.length > 0 || loading) && (
          <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-nndd-border bg-nndd-panel text-xs">
            <span className="text-nndd-subtext">
              {total > 0
                ? `${total.toLocaleString()} 件中 ${(page - 1) * LIMIT + 1}–${Math.min(page * LIMIT, total)} 件表示`
                : loading ? '検索中…' : ''}
            </span>
            <ContinuousPlayButton
              disabled={loading || results.length === 0}
              onPlay={(audioOnly) => {
                if (results.length === 0) return;
                const videoIds = results.map((r) => r.videoId);
                window.nndd.invoke(window.nndd.channels.VIDEO_OPEN_PLAYER, {
                  videoId: videoIds[0],
                  searchPlaylist: videoIds,
                  audioOnly: audioOnly || undefined,
                });
              }}
            />
            <div className="flex items-center gap-1 ml-auto">
              <button
                onClick={() => handleSearch(page - 1)}
                disabled={loading || page <= 1}
                className="px-2 py-0.5 bg-nndd-border rounded hover:bg-nndd-accent disabled:opacity-40"
              >◀ 前</button>
              <span className="text-nndd-subtext px-2">{page} / {totalPages || 1}</span>
              <button
                onClick={() => handleSearch(page + 1)}
                disabled={loading || page >= totalPages}
                className="px-2 py-0.5 bg-nndd-border rounded hover:bg-nndd-accent disabled:opacity-40"
              >次 ▶</button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-auto p-3">
          {error && (
            <div className="text-red-500 dark:text-red-400 text-sm mb-3">エラー: {error}</div>
          )}
          {!loading && results.length === 0 && !error && (
            <div className="text-nndd-subtext text-sm">
              キーワードを入力して検索してください。
            </div>
          )}
          {results.length > 0 && (
            displayMode === 'grid' ? (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
                  {results.map((r) => (
                    <VideoCard
                      key={r.videoId}
                      data={{
                        videoId: r.videoId,
                        title: r.title,
                        thumbnailUrl: r.thumbnailUrl,
                        length: r.length,
                        viewCount: r.viewCount,
                        commentCount: r.commentCount,
                        mylistCount: r.mylistCount,
                        likeCount: r.likeCount,
                        registeredAt: r.registeredAt,
                        isChannelVideo: r.isChannelVideo
                      }}
                      onPlay={handlePlay}
                      onDownload={handleDownload}
                      onPlayAudioOnly={handlePlayAudioOnly}
                      isDownloaded={downloadedIds.has(r.videoId)}
                    />
                  ))}
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  {results.map((r) => (
                    <VideoCard
                      key={r.videoId}
                      layout="list"
                      data={{
                        videoId: r.videoId,
                        title: r.title,
                        thumbnailUrl: r.thumbnailUrl,
                        length: r.length,
                        viewCount: r.viewCount,
                        commentCount: r.commentCount,
                        mylistCount: r.mylistCount,
                        likeCount: r.likeCount,
                        registeredAt: r.registeredAt,
                        isChannelVideo: r.isChannelVideo
                      }}
                      onPlay={handlePlay}
                      onDownload={handleDownload}
                      onPlayAudioOnly={handlePlayAudioOnly}
                      isDownloaded={downloadedIds.has(r.videoId)}
                    />
                  ))}
                </div>
              )
          )}
        </div>
      </main>
    </div>
  );
}


