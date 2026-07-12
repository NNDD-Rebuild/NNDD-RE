import { useEffect, useRef, useState } from 'react';
import type { MyList, MyListItem, RssTypeValue } from '@shared/types';
import { IpcChannel, RssType } from '@shared/types';
import { VideoCard } from '../common/VideoCard';
import { ContinuousPlayButton } from '../common/ContinuousPlayButton';
import { useAppStore } from '../../store/useAppStore';


/**
 * マイリストタブ。
 * 左ペイン: マイリスト一覧 (追加/削除/選択)
 * 右ペイン: 選択中マイリストの動画一覧
 *  - グリッド/リスト切替 (グローバル設定に準じる)
 *  - Shift+クリックで範囲選択、Ctrl+クリックで複数選択
 *  - 選択中の件数を一括DLボタンに表示
 */
export function MyListView(): JSX.Element {
  const [mylists, setMylists] = useState<MyList[]>([]);
  const [selected, setSelected] = useState<MyList | null>(null);
  const [items, setItems] = useState<MyListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renewingAll, setRenewingAll] = useState(false);
  // ページネーション
  const [currentPage, setCurrentPage] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const PAGE_SIZE = 100;

  // 追加フォーム
  const [newUrl, setNewUrl] = useState('');
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<RssTypeValue>(RssType.MY_LIST);

  // アカウントから取得
  const [accountFetching, setAccountFetching] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [accountMylists, setAccountMylists] = useState<MyList[] | null>(null);
  const [importingIds, setImportingIds] = useState<Set<string>>(new Set());

  // 表示モード (グローバル設定に準じる)
  const globalMode = useAppStore((s) => s.contentViewMode);
  const [displayMode, setDisplayMode] = useState<'grid' | 'list'>(globalMode);

  // 選択状態 (shift/ctrl クリック)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastClickedId, setLastClickedId] = useState<string | null>(null);

  // 左ペイン名前編集
  const [editingUrl, setEditingUrl] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  // 一括DL中
  const [bulkDling, setBulkDling] = useState(false);
  const [downloadedIds, setDownloadedIds] = useState<Set<string>>(new Set());

  // プレイヤーウィンドウからのナビゲーション
  const pendingMylistId = useAppStore((s) => s.pendingMylistId);
  const setPendingMylistId = useAppStore((s) => s.setPendingMylistId);
  const pendingSeriesId = useAppStore((s) => s.pendingSeriesId);
  const setPendingSeriesId = useAppStore((s) => s.setPendingSeriesId);
  const showToast = useAppStore((s) => s.showToast);
  // mylists が更新された後に処理するために ref で保持
  const mylistsRef = useRef<MyList[]>([]);

  const reloadMylists = (): void => {
    window.nndd
      .invoke<MyList[]>(IpcChannel.MYLIST_LIST)
      .then((list) => {
        mylistsRef.current = list;
        setMylists(list);
      });
  };

  // グローバル設定変更を即時反映
  useEffect(() => { setDisplayMode(globalMode); }, [globalMode]);

  useEffect(reloadMylists, []);

  // pendingMylistId 処理: マイリストを自動選択/追加
  useEffect(() => {
    if (!pendingMylistId) return;
    const mylistId = pendingMylistId;
    setPendingMylistId(null);

    const list = mylistsRef.current;
    // 既存から検索 (URLにIDが含まれるものを探す)
    const existing = list.find((m) =>
      m.myListUrl === mylistId ||
      m.myListUrl.includes(`mylist/${mylistId}`) ||
      m.myListUrl.includes(`mylist%2F${mylistId}`)
    );
    if (existing) {
      void fetchItems(existing);
    } else {
      // 追加せず一時表示のみ (DBには保存しない)
      const url = `https://www.nicovideo.jp/my/mylist/${mylistId}`;
      const fetchAndShow = async (): Promise<void> => {
        // マイリスト名を取得して表示名に使用
        const info = await window.nndd.invoke<{ name: string } | null>(
          IpcChannel.MYLIST_FETCH_INFO,
          mylistId
        ).catch(() => null);
        const tempMl: MyList = {
          myListUrl: url,
          myListName: info?.name ?? `マイリスト (${mylistId})`,
          type: RssType.MY_LIST,
          isDir: false,
          unPlayVideoCount: 0,
          myListVideoIds: {},
        };
        void fetchItems(tempMl); // reloadMylists は呼ばない → DBに追加されない
      };
      void fetchAndShow();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingMylistId]);

  // pendingSeriesId 処理: シリーズを一時表示 (SERIES_FETCH → 直接setItems)
  useEffect(() => {
    if (!pendingSeriesId) return;
    const seriesId = pendingSeriesId;
    setPendingSeriesId(null);

    const fetchSeries = async (): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const result = await window.nndd.invoke<{
          name: string;
          items: Array<{
            videoId: string; title: string; description: string;
            thumbnailUrl: string; length: string;
            pubDate: string; viewCount: number; commentCount: number;
            mylistCount: number; likeCount: number;
          }>;
        } | null>(IpcChannel.SERIES_FETCH, seriesId).catch(() => null);
        if (!result) return;
        const url = `https://www.nicovideo.jp/series/${seriesId}`;
        const tempMl: MyList = {
          myListUrl: url,
          myListName: result.name ?? `シリーズ (${seriesId})`,
          type: RssType.SERIES,
          isDir: false,
          unPlayVideoCount: 0,
          myListVideoIds: {},
        };
        setSelected(tempMl);
        setSelectedIds(new Set());
        setLastClickedId(null);
        setTotalItems(result.items.length);
        setCurrentPage(1);
        const seriesMapped = result.items.map((it) => ({
          ...it,
          pubDate: new Date(it.pubDate),
        }));
        setItems(seriesMapped);
        const seriesIds = seriesMapped.map((i) => i.videoId);
        window.nndd
          .invoke<string[]>(IpcChannel.LIBRARY_CHECK_BATCH, seriesIds)
          .then((dl) => setDownloadedIds(new Set(dl)))
          .catch(() => {});
      } finally {
        setLoading(false);
      }
    };
    void fetchSeries();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSeriesId]);

  const fetchItems = async (ml: MyList, page = 1): Promise<void> => {
    setLoading(true);
    setError(null);
    setSelected(ml);
    setSelectedIds(new Set());
    setLastClickedId(null);
    setCurrentPage(page);
    try {
      if (ml.type === RssType.SERIES) {
        const seriesId = ml.myListUrl.match(/series\/(\d+)/)?.[1] ?? ml.myListUrl;
        const result = await window.nndd.invoke<{
          name: string;
          items: Array<{
            videoId: string; title: string; description: string;
            thumbnailUrl: string; length: string;
            pubDate: string; viewCount: number; commentCount: number;
            mylistCount: number; likeCount: number;
          }>;
        } | null>(IpcChannel.SERIES_FETCH, seriesId);
        if (!result) { setItems([]); setTotalItems(0); return; }
        const mapped = result.items.map((it) => ({ ...it, pubDate: new Date(it.pubDate) }));
        setItems(mapped);
        setTotalItems(mapped.length);
        window.nndd
          .invoke<string[]>(IpcChannel.LIBRARY_CHECK_BATCH, mapped.map((i) => i.videoId))
          .then((dl) => setDownloadedIds(new Set(dl)))
          .catch(() => {});
      } else {
        const data = await window.nndd.invoke<{ items: MyListItem[]; total: number }>(
          IpcChannel.MYLIST_FETCH_PAGE,
          { url: ml.myListUrl, page, pageSize: PAGE_SIZE }
        );
        const mapped = data.items.map((d) => ({ ...d, pubDate: new Date(d.pubDate) }));
        setItems(mapped);
        setTotalItems(data.total);
        window.nndd
          .invoke<string[]>(IpcChannel.LIBRARY_CHECK_BATCH, mapped.map((i) => i.videoId))
          .then((dl) => setDownloadedIds(new Set(dl)))
          .catch(() => {});
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setItems([]);
      setTotalItems(0);
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async (): Promise<void> => {
    const url = newUrl.trim();
    if (!url) return;
    let name = newName.trim();
    if (!name) {
      const info = await window.nndd.invoke<{ name: string } | null>(
        IpcChannel.MYLIST_FETCH_INFO,
        url
      ).catch(() => null);
      name = info?.name ?? url;
    }
    const ml: MyList = {
      myListUrl: url,
      myListName: name,
      type: newType,
      isDir: false,
      unPlayVideoCount: 0,
      myListVideoIds: {},
    };
    await window.nndd.invoke(IpcChannel.MYLIST_ADD, ml);
    setNewUrl('');
    setNewName('');
    reloadMylists();
  };

  const handleRemove = async (ml: MyList): Promise<void> => {
    await window.nndd.invoke(IpcChannel.MYLIST_REMOVE, ml.myListUrl);
    if (selected?.myListUrl === ml.myListUrl) {
      setSelected(null);
      setItems([]);
    }
    reloadMylists();
  };

  const handleRenewAll = async (): Promise<void> => {
    setRenewingAll(true);
    try {
      await window.nndd.invoke(IpcChannel.MYLIST_RENEW_ALL);
      if (selected) await fetchItems(selected);
      reloadMylists();
    } finally {
      setRenewingAll(false);
    }
  };

  // アカウントのマイリスト一覧を取得
  const handleFetchAccount = async (): Promise<void> => {
    setAccountFetching(true);
    setAccountError(null);
    setAccountMylists(null);
    try {
      const list = await window.nndd.invoke<MyList[]>(IpcChannel.MYLIST_FETCH_ACCOUNT);
      setAccountMylists(list);
    } catch (e) {
      setAccountError(e instanceof Error ? e.message : String(e));
    } finally {
      setAccountFetching(false);
    }
  };

  const handleImportOne = async (ml: MyList): Promise<void> => {
    setImportingIds((prev) => new Set(prev).add(ml.myListUrl));
    try {
      await window.nndd.invoke(IpcChannel.MYLIST_ADD, ml);
      reloadMylists();
    } finally {
      setImportingIds((prev) => {
        const next = new Set(prev);
        next.delete(ml.myListUrl);
        return next;
      });
    }
  };

  const handleImportAll = async (): Promise<void> => {
    if (!accountMylists) return;
    const registeredSet = new Set(mylists.map((m) => m.myListUrl));
    for (const ml of accountMylists) {
      if (!registeredSet.has(ml.myListUrl)) {
        await window.nndd.invoke(IpcChannel.MYLIST_ADD, ml);
      }
    }
    reloadMylists();
  };

  const handlePlay = (videoId: string): void => {
    window.nndd.invoke(IpcChannel.VIDEO_OPEN_PLAYER, { videoId });
  };
  const handlePlayAudioOnly = (videoId: string): void => {
    window.nndd.invoke(IpcChannel.VIDEO_OPEN_PLAYER, { videoId, audioOnly: true });
  };
  const handleDownload = (videoId: string): void => {
    const commentOnly = downloadedIds.has(videoId);
    window.nndd.invoke(IpcChannel.DOWNLOAD_ENQUEUE, { videoId, commentOnly });
    showToast(commentOnly ? 'コメントのみDLリストに追加しました' : 'DLリストに追加しました');
  };
  const handleNiconico = (videoId: string): void => {
    window.nndd.invoke(window.nndd.channels.SYS_OPEN_PATH, `https://www.nicovideo.jp/watch/${videoId}`);
  };

  /** 一時表示中のマイリストを DB に登録 */
  const handleAddCurrentMylist = async (): Promise<void> => {
    if (!selected) return;
    await window.nndd.invoke(IpcChannel.MYLIST_ADD, selected);
    reloadMylists();
  };

  const handleRename = async (ml: MyList, newName: string): Promise<void> => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === ml.myListName) {
      setEditingUrl(null);
      return;
    }
    await window.nndd.invoke(IpcChannel.MYLIST_UPDATE_NAME, { url: ml.myListUrl, name: trimmed });
    setEditingUrl(null);
    reloadMylists();
    if (selected?.myListUrl === ml.myListUrl) {
      setSelected({ ...selected, myListName: trimmed });
    }
  };

  // 選択クリック処理 (shift/ctrl)
  const handleItemClick = (videoId: string, e: React.MouseEvent): void => {
    if (e.shiftKey && lastClickedId) {
      const ids = items.map((it) => it.videoId);
      const from = ids.indexOf(lastClickedId);
      const to = ids.indexOf(videoId);
      const start = Math.min(from, to);
      const end = Math.max(from, to);
      setSelectedIds(new Set(ids.slice(start, end + 1)));
    } else if (e.ctrlKey || e.metaKey) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(videoId)) next.delete(videoId);
        else next.add(videoId);
        return next;
      });
    } else {
      setSelectedIds(new Set([videoId]));
    }
    setLastClickedId(videoId);
  };

  const handleBulkDownload = async (): Promise<void> => {
    const targets = selectedIds.size > 0
      ? items.filter((it) => selectedIds.has(it.videoId))
      : items;
    if (targets.length === 0 || bulkDling) return;
    setBulkDling(true);
    try {
      for (const it of targets) {
        await window.nndd.invoke(IpcChannel.DOWNLOAD_ENQUEUE, { videoId: it.videoId });
      }
      showToast(`${targets.length}件をDLリストに追加しました`);
    } finally {
      setBulkDling(false);
    }
  };

  const registeredIds = new Set(mylists.map((m) => m.myListUrl));
  const bulkLabel = selectedIds.size > 0
    ? `一括DL (${selectedIds.size}件選択)`
    : `一括DL (${items.length}件)`;

  return (
    <div className="h-full flex">
      <aside className="w-72 border-r border-nndd-border bg-nndd-panel flex flex-col overflow-hidden">
        <div className="p-2 border-b border-nndd-border space-y-1 shrink-0">
          <div className="text-xs font-bold text-nndd-subtext">マイリスト追加</div>
          <input
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            placeholder="ID or URL (例: 12345678)"
            className="w-full bg-nndd-bg border border-nndd-border px-2 py-1 text-xs"
          />
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="表示名 (省略可)"
            className="w-full bg-nndd-bg border border-nndd-border px-2 py-1 text-xs"
          />
          <select
            value={newType}
            onChange={(e) => setNewType(e.target.value as RssTypeValue)}
            className="w-full bg-nndd-bg border border-nndd-border px-2 py-1 text-xs"
          >
            <option value={RssType.MY_LIST}>マイリスト</option>
            <option value={RssType.CHANNEL}>チャンネル</option>
            <option value={RssType.COMMUNITY}>コミュニティ</option>
            <option value={RssType.USER_UPLOAD_VIDEO}>ユーザー投稿</option>
            <option value={RssType.SERIES}>シリーズ</option>
          </select>
          <div className="flex gap-1 flex-wrap">
            <button
              onClick={handleAdd}
              className="flex-1 text-xs px-3 py-1 bg-nndd-accent text-white rounded hover:opacity-80"
            >
              追加
            </button>
            <button
              onClick={handleRenewAll}
              disabled={renewingAll}
              className="text-xs px-3 py-1 bg-nndd-border rounded hover:bg-nndd-accent disabled:opacity-50"
              title="全マイリストを更新"
            >
              {renewingAll ? '更新中…' : '一括更新'}
            </button>
            <button
              onClick={handleFetchAccount}
              disabled={accountFetching}
              className="text-xs px-3 py-1 bg-nndd-border rounded hover:bg-nndd-accent disabled:opacity-50"
              title="ログイン中のアカウントのマイリストを取得"
            >
              {accountFetching ? '取得中…' : 'アカウントから取得'}
            </button>
          </div>
          {accountError && (
            <div className="text-xs text-red-500 dark:text-red-400 truncate" title={accountError}>
              ⚠ {accountError}
            </div>
          )}
        </div>

        {/* アカウントマイリスト取得結果 */}
        {accountMylists !== null && (
          <div className="shrink-0 border-b border-nndd-border bg-nndd-bg">
            <div className="flex items-center justify-between px-2 py-1 bg-nndd-panel">
              <span className="text-xs font-bold text-nndd-subtext">
                アカウントのマイリスト ({accountMylists.length})
              </span>
              <div className="flex gap-1">
                <button
                  onClick={handleImportAll}
                  className="text-xs px-2 py-0.5 bg-nndd-accent text-white rounded hover:opacity-80"
                  title="未登録のマイリストをすべて追加"
                >
                  全追加
                </button>
                <button
                  onClick={() => setAccountMylists(null)}
                  className="text-xs px-2 py-0.5 bg-nndd-border rounded hover:bg-red-400 hover:text-white"
                >
                  ×
                </button>
              </div>
            </div>
            <div className="max-h-48 overflow-y-auto">
              {accountMylists.length === 0 ? (
                <div className="text-xs text-nndd-subtext p-2">マイリストが見つかりません</div>
              ) : (
                accountMylists.map((ml) => {
                  const registered = registeredIds.has(ml.myListUrl);
                  const importing = importingIds.has(ml.myListUrl);
                  return (
                    <div
                      key={ml.myListUrl}
                      className="flex items-center gap-1 px-2 py-1 text-xs border-b border-nndd-border"
                    >
                      <span className="flex-1 truncate" title={ml.myListUrl}>{ml.myListName}</span>
                      {registered ? (
                        <span className="text-nndd-subtext shrink-0">登録済</span>
                      ) : (
                        <button
                          onClick={() => handleImportOne(ml)}
                          disabled={importing}
                          className="shrink-0 text-xs px-2 py-0.5 bg-nndd-accent text-white rounded hover:opacity-80 disabled:opacity-50"
                        >
                          {importing ? '追加中' : '追加'}
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        <div className="flex-1 overflow-auto">
          {mylists.length === 0 && (
            <div className="p-3 text-xs text-nndd-subtext">登録されているマイリストはありません。</div>
          )}
          {mylists.map((ml) => (
            <div
              key={ml.myListUrl}
              className={[
                'flex items-center gap-1 px-2 py-1 text-xs border-b border-nndd-border cursor-pointer',
                selected?.myListUrl === ml.myListUrl ? 'bg-nndd-bg' : 'hover:bg-nndd-border'
              ].join(' ')}
              onClick={() => editingUrl !== ml.myListUrl && fetchItems(ml)}
              onContextMenu={(e) => {
                e.preventDefault();
                setEditingUrl(ml.myListUrl);
                setEditingName(ml.myListName);
              }}
            >
              <span className="text-nndd-subtext shrink-0">{typeLabel(ml.type)}</span>
              {editingUrl === ml.myListUrl ? (
                <input
                  autoFocus
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onBlur={() => handleRename(ml, editingName)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRename(ml, editingName);
                    if (e.key === 'Escape') setEditingUrl(null);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="flex-1 min-w-0 bg-nndd-bg border border-nndd-accent px-1 py-0 text-xs outline-none"
                />
              ) : (
                <span className="flex-1 truncate" title={ml.myListUrl}>{ml.myListName}</span>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); handleRemove(ml); }}
                className="text-nndd-subtext hover:text-red-500 dark:hover:text-red-400"
                title="削除"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden">
        {!selected && (
          <div className="p-3 text-nndd-subtext text-sm">左からマイリストを選択してください。</div>
        )}
        {selected && (
          <>
            {/* ヘッダー */}
            <div className="shrink-0 p-2 border-b border-nndd-border bg-nndd-panel flex items-center gap-2 flex-wrap">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold truncate">{selected.myListName}</div>
                <div
                  className="text-xs text-nndd-subtext truncate cursor-pointer hover:underline"
                  title="クリックでIDをコピー"
                  onClick={() => {
                    const id = extractId(selected.myListUrl);
                    navigator.clipboard.writeText(id);
                    showToast('IDをコピーしました');
                  }}
                >
                  {extractId(selected.myListUrl)}
                </div>
              </div>
              {selectedIds.size > 0 && (
                <button
                  onClick={() => setSelectedIds(new Set())}
                  className="text-xs px-2 py-1 bg-nndd-border rounded hover:bg-nndd-accent hover:text-white"
                >
                  選択解除
                </button>
              )}
              {!mylists.some((m) => m.myListUrl === selected.myListUrl) && (
                <button
                  onClick={handleAddCurrentMylist}
                  className="text-xs px-3 py-1 bg-green-700 text-white rounded hover:opacity-80 shrink-0"
                  title="このマイリストを登録リストに追加"
                >
                  マイリスト追加
                </button>
              )}
              <button
                onClick={handleBulkDownload}
                disabled={bulkDling || items.length === 0}
                className="text-xs px-3 py-1 bg-nndd-accent text-white rounded hover:opacity-80 disabled:opacity-50 shrink-0"
                title="Shift+クリックで範囲選択 / Ctrl+クリックで複数選択"
              >
                {bulkDling ? '追加中…' : bulkLabel}
              </button>
              <div className="flex border border-nndd-border rounded overflow-hidden shrink-0">
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

            {error && <div className="text-red-500 dark:text-red-400 text-sm p-2">エラー: {error}</div>}

            {items.length > 0 && (
              <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-nndd-border bg-nndd-panel text-xs">
                <ContinuousPlayButton
                  disabled={loading || items.length === 0}
                  onPlay={(audioOnly) => {
                    if (items.length === 0) return;
                    const videoIds = items.map((it) => it.videoId);
                    const startIdx = selectedIds.size > 0
                      ? items.findIndex((it) => selectedIds.has(it.videoId))
                      : 0;
                    window.nndd.invoke(IpcChannel.VIDEO_OPEN_PLAYER, {
                      videoId: videoIds[startIdx >= 0 ? startIdx : 0],
                      searchPlaylist: videoIds,
                      audioOnly: audioOnly || undefined,
                    });
                  }}
                />
                <span className="text-nndd-subtext">{items.length} 件</span>
              </div>
            )}

            {/* ページネーションバー (固定) */}
            {(items.length > 0 || loading) && totalItems > PAGE_SIZE && (
              <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-nndd-border bg-nndd-panel text-xs">
                <span className="text-nndd-subtext">
                  {totalItems > 0
                    ? `${totalItems.toLocaleString()} 件中 ${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, totalItems)} 件表示`
                    : ''}
                </span>
                <div className="flex items-center gap-1 ml-auto">
                  <button
                    onClick={() => selected && void fetchItems(selected, currentPage - 1)}
                    disabled={loading || currentPage <= 1}
                    className="px-2 py-0.5 bg-nndd-border rounded hover:bg-nndd-accent disabled:opacity-40"
                  >◀ 前</button>
                  <span className="text-nndd-subtext px-2">
                    {currentPage} / {Math.ceil(totalItems / PAGE_SIZE)}
                  </span>
                  <button
                    onClick={() => selected && void fetchItems(selected, currentPage + 1)}
                    disabled={loading || currentPage >= Math.ceil(totalItems / PAGE_SIZE)}
                    className="px-2 py-0.5 bg-nndd-border rounded hover:bg-nndd-accent disabled:opacity-40"
                  >次 ▶</button>
                </div>
              </div>
            )}

            <div className="flex-1 overflow-auto p-3">
              {loading ? (
                <div className="text-nndd-subtext text-sm">読み込み中…</div>
              ) : items.length === 0 ? (
                <div className="text-nndd-subtext text-sm">動画なし</div>
              ) : displayMode === 'grid' ? (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
                  {items.map((it) => (
                    <div
                      key={it.videoId}
                      onClick={(e) => handleItemClick(it.videoId, e)}
                      className={[
                        'rounded cursor-pointer',
                        selectedIds.has(it.videoId) ? 'ring-2 ring-nndd-accent' : ''
                      ].join(' ')}
                    >
                      <VideoCard
                        data={itemToCard(it)}
                        onPlay={handlePlay}
                        onDownload={handleDownload}
                        onNiconico={handleNiconico}
                        onPlayAudioOnly={handlePlayAudioOnly}
                        isDownloaded={downloadedIds.has(it.videoId)}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  {items.map((it) => (
                    <div
                      key={it.videoId}
                      onClick={(e) => handleItemClick(it.videoId, e)}
                      className={[
                        'rounded cursor-pointer',
                        selectedIds.has(it.videoId) ? 'ring-2 ring-nndd-accent' : ''
                      ].join(' ')}
                    >
                      <VideoCard
                        data={itemToCard(it)}
                        layout="list"
                        onPlay={handlePlay}
                        onDownload={handleDownload}
                        onNiconico={handleNiconico}
                        onPlayAudioOnly={handlePlayAudioOnly}
                        isDownloaded={downloadedIds.has(it.videoId)}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

/** MyListItem → VideoCardData */
function itemToCard(it: MyListItem) {
  return {
    videoId: it.videoId,
    title: it.title,
    thumbnailUrl: it.thumbnailUrl,
    length: it.length,          // string "M:SS" → VideoCard が string 対応済み
    viewCount: it.viewCount,
    commentCount: it.commentCount,
    mylistCount: it.mylistCount,
    likeCount: it.likeCount,
    registeredAt: it.pubDate,   // 投稿日
    isChannelVideo: it.isChannelVideo,
  };
}

function extractId(url: string): string {
  const m = url.match(/(?:mylist\/|series\/)(\d+)/);
  const raw = m ? m[1] : url;
  return raw.replace(/\.0$/, '');
}

function typeLabel(t: RssTypeValue): string {
  switch (t) {
    case RssType.MY_LIST: return '📑';
    case RssType.CHANNEL: return '📺';
    case RssType.COMMUNITY: return '👥';
    case RssType.USER_UPLOAD_VIDEO: return '👤';
    case RssType.SERIES: return '📚';
    default: return '?';
  }
}
