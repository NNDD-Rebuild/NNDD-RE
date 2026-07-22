import { useEffect, useMemo, useRef, useState } from 'react';
import type { MyList, MyListItem, Playlist, PlaylistItem, RssTypeValue } from '@shared/types';
import { IpcChannel, RssType } from '@shared/types';
import { parseMylistSource } from '@shared/utils/parseMylistUrl';
import { VideoCard, type VideoCardData } from '../common/VideoCard';
import { ContinuousPlayButton } from '../common/ContinuousPlayButton';
import { useAppStore } from '../../store/useAppStore';

type Selected =
  | { kind: 'mylist'; mylist: MyList }
  | { kind: 'playlist'; playlist: Playlist };

/**
 * マイリストタブ。
 * 左ペイン: リモートマイリスト一覧 + ローカル完結の自作プレイリスト一覧 (2セクション)
 * 右ペイン: 選択中リストの動画一覧
 *  - グリッド/リスト切替 (グローバル設定に準じる)
 *  - Shift+クリックで範囲選択、Ctrl+クリックで複数選択
 *  - プレイリスト選択時のみ ▲▼ 並び替え・削除ボタンを表示
 */
export function MyListView(): JSX.Element {
  const [mylists, setMylists] = useState<MyList[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [items, setItems] = useState<VideoCardData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renewingAll, setRenewingAll] = useState(false);
  // ページネーション (マイリストのみ)
  const [currentPage, setCurrentPage] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const PAGE_SIZE = 100;

  // タイトル検索 (選択中リスト内)
  const [searchText, setSearchText] = useState('');
  // 検索開始時に全ページを取得してキャッシュしたもの (未検索/未取得なら null)
  const [allItems, setAllItems] = useState<VideoCardData[] | null>(null);
  const [loadingAll, setLoadingAll] = useState(false);
  const [loadedCount, setLoadedCount] = useState(0);
  const cancelLoadAllRef = useRef(false);
  const isLoadingAllRef = useRef(false);

  // マイリスト追加フォーム (URLから種別を自動判定)
  const [newUrl, setNewUrl] = useState('');
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<RssTypeValue>(RssType.MY_LIST);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // プレイリスト作成フォーム
  const [newPlaylistName, setNewPlaylistName] = useState('');

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
  const [editingPlaylistId, setEditingPlaylistId] = useState<number | null>(null);
  const [editingPlaylistName, setEditingPlaylistName] = useState('');

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

  const reloadPlaylists = (): void => {
    window.nndd.invoke<Playlist[]>(IpcChannel.PLAYLIST_LIST).then(setPlaylists);
  };

  // グローバル設定変更を即時反映
  useEffect(() => { setDisplayMode(globalMode); }, [globalMode]);

  useEffect(() => {
    reloadMylists();
    reloadPlaylists();
  }, []);

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
          { url, type: RssType.MY_LIST }
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
        setSelected({ kind: 'mylist', mylist: tempMl });
        setSelectedIds(new Set());
        setLastClickedId(null);
        setTotalItems(result.items.length);
        setCurrentPage(1);
        const seriesMapped = result.items.map((it) => ({
          ...it,
          pubDate: new Date(it.pubDate),
        }));
        setItems(seriesMapped.map(mylistItemToCard));
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
    setSelected({ kind: 'mylist', mylist: ml });
    setSelectedIds(new Set());
    setLastClickedId(null);
    setCurrentPage(page);
    setSearchText('');
    setAllItems(null);
    cancelLoadAllRef.current = true;
    isLoadingAllRef.current = false;
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
        setItems(mapped.map(mylistItemToCard));
        setTotalItems(mapped.length);
        window.nndd
          .invoke<string[]>(IpcChannel.LIBRARY_CHECK_BATCH, mapped.map((i) => i.videoId))
          .then((dl) => setDownloadedIds(new Set(dl)))
          .catch(() => {});
      } else {
        const data = await window.nndd.invoke<{ items: MyListItem[]; total: number }>(
          IpcChannel.MYLIST_FETCH_PAGE,
          { url: ml.myListUrl, type: ml.type, page, pageSize: PAGE_SIZE }
        );
        const mapped = data.items.map((d) => ({ ...d, pubDate: new Date(d.pubDate) }));
        setItems(mapped.map(mylistItemToCard));
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

  const fetchPlaylistItems = async (pl: Playlist): Promise<void> => {
    setLoading(true);
    setError(null);
    setSelected({ kind: 'playlist', playlist: pl });
    setSelectedIds(new Set());
    setLastClickedId(null);
    setSearchText('');
    setAllItems(null);
    cancelLoadAllRef.current = true;
    isLoadingAllRef.current = false;
    try {
      const list = await window.nndd.invoke<PlaylistItem[]>(IpcChannel.PLAYLIST_GET_ITEMS, pl.id);
      setItems(list.map(playlistItemToCard));
      setTotalItems(list.length);
      window.nndd
        .invoke<string[]>(IpcChannel.LIBRARY_CHECK_BATCH, list.map((it) => it.videoId))
        .then((dl) => setDownloadedIds(new Set(dl)))
        .catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setItems([]);
      setTotalItems(0);
    } finally {
      setLoading(false);
    }
  };

  /** 検索欄に何か入力された時、現在ページ以外の残り全ページを取得して allItems にキャッシュする */
  const loadAllPagesForSearch = async (): Promise<void> => {
    if (selected?.kind !== 'mylist' || allItems !== null || totalItems <= items.length) return;
    if (isLoadingAllRef.current) return; // 連続入力による二重起動を防止
    isLoadingAllRef.current = true;
    const ml = selected.mylist;
    cancelLoadAllRef.current = false;
    setLoadingAll(true);
    setLoadedCount(0);
    try {
      const totalPages = Math.ceil(totalItems / PAGE_SIZE);
      const merged: VideoCardData[] = [];
      for (let p = 1; p <= totalPages; p++) {
        if (cancelLoadAllRef.current) return;
        const data = await window.nndd.invoke<{ items: MyListItem[]; total: number }>(
          IpcChannel.MYLIST_FETCH_PAGE,
          // 全件先読み中は画像キャッシュを保存しない (検索確定時にヒット分だけ保存する)
          { url: ml.myListUrl, type: ml.type, page: p, pageSize: PAGE_SIZE, cacheImages: false }
        );
        if (cancelLoadAllRef.current) return;
        const mapped = data.items.map((d) => ({ ...d, pubDate: new Date(d.pubDate) }));
        merged.push(...mapped.map(mylistItemToCard));
        setLoadedCount(merged.length);
      }
      if (!cancelLoadAllRef.current) setAllItems(merged);
    } catch {
      // 失敗時は現在ページのみでの検索にフォールバック (allItems は null のまま)
    } finally {
      setLoadingAll(false);
      isLoadingAllRef.current = false;
    }
  };

  const handleSearchTextChange = (value: string): void => {
    setSearchText(value);
    if (value.trim()) {
      if (allItems === null) void loadAllPagesForSearch();
    } else {
      // 検索窓を空にしたら取得を中断
      cancelLoadAllRef.current = true;
    }
  };

  /** 検索確定 (Enter): ヒットした分だけ画像キャッシュに保存する */
  const handleSearchConfirm = (): void => {
    if (!searchText.trim()) return;
    for (const it of filteredItems) {
      if (!it.thumbnailUrl) continue;
      window.nndd.invoke(IpcChannel.IMAGE_FETCH, it.thumbnailUrl).catch(() => {});
    }
  };

  const filteredItems = useMemo(() => {
    if (!searchText.trim()) return items;
    const q = searchText.trim().toLowerCase();
    const base = allItems ?? items;
    return base.filter((it) => it.title.toLowerCase().includes(q));
  }, [items, allItems, searchText]);

  /** URL入力欄からフォーカスが外れた/Enterされた時: 種別自動判定してプレビュー表示 */
  const handleUrlPreview = async (): Promise<void> => {
    const url = newUrl.trim();
    if (!url) { setUrlError(null); return; }
    const parsed = parseMylistSource(url);
    if (!parsed) {
      setUrlError('マイリスト/チャンネル/ユーザー/シリーズのURLまたはIDを認識できませんでした');
      return;
    }
    setUrlError(null);
    setNewType(parsed.type);
    setPreviewLoading(true);
    try {
      let name = newName.trim();
      if (!name) {
        const info = await window.nndd.invoke<{ name: string } | null>(
          IpcChannel.MYLIST_FETCH_INFO,
          { url: parsed.normalizedUrl, type: parsed.type }
        ).catch(() => null);
        if (info?.name) {
          name = info.name;
          setNewName(info.name);
        }
      }
      const tempMl: MyList = {
        myListUrl: parsed.normalizedUrl,
        myListName: name || parsed.normalizedUrl,
        type: parsed.type,
        isDir: false,
        unPlayVideoCount: 0,
        myListVideoIds: {},
      };
      await fetchItems(tempMl);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleAdd = async (): Promise<void> => {
    const url = newUrl.trim();
    if (!url) return;
    const parsed = parseMylistSource(url);
    if (!parsed) {
      setUrlError('マイリスト/チャンネル/ユーザー/シリーズのURLまたはIDを認識できませんでした');
      return;
    }
    let name = newName.trim();
    if (!name) {
      const info = await window.nndd.invoke<{ name: string } | null>(
        IpcChannel.MYLIST_FETCH_INFO,
        { url: parsed.normalizedUrl, type: parsed.type }
      ).catch(() => null);
      name = info?.name ?? parsed.normalizedUrl;
    }
    const ml: MyList = {
      myListUrl: parsed.normalizedUrl,
      myListName: name,
      type: parsed.type,
      isDir: false,
      unPlayVideoCount: 0,
      myListVideoIds: {},
    };
    await window.nndd.invoke(IpcChannel.MYLIST_ADD, ml);
    setNewUrl('');
    setNewName('');
    setUrlError(null);
    reloadMylists();
  };

  const handleRemove = async (ml: MyList): Promise<void> => {
    await window.nndd.invoke(IpcChannel.MYLIST_REMOVE, ml.myListUrl);
    if (selected?.kind === 'mylist' && selected.mylist.myListUrl === ml.myListUrl) {
      setSelected(null);
      setItems([]);
    }
    reloadMylists();
  };

  const handleRenewAll = async (): Promise<void> => {
    setRenewingAll(true);
    try {
      await window.nndd.invoke(IpcChannel.MYLIST_RENEW_ALL);
      if (selected?.kind === 'mylist') await fetchItems(selected.mylist);
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
  const handleDownload = (videoId: string, audioOnly?: boolean): void => {
    const commentOnly = !audioOnly && downloadedIds.has(videoId);
    window.nndd.invoke(IpcChannel.DOWNLOAD_ENQUEUE, { videoId, commentOnly, audioOnly });
    showToast(
      audioOnly ? '音声のみDLリストに追加しました'
        : commentOnly ? 'コメントのみDLリストに追加しました'
        : 'DLリストに追加しました'
    );
  };
  const handleNiconico = (videoId: string): void => {
    window.nndd.invoke(window.nndd.channels.SYS_OPEN_PATH, `https://www.nicovideo.jp/watch/${videoId}`);
  };

  /** 一時表示中のマイリストを DB に登録 */
  const handleAddCurrentMylist = async (): Promise<void> => {
    if (selected?.kind !== 'mylist') return;
    await window.nndd.invoke(IpcChannel.MYLIST_ADD, selected.mylist);
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
    if (selected?.kind === 'mylist' && selected.mylist.myListUrl === ml.myListUrl) {
      setSelected({ kind: 'mylist', mylist: { ...selected.mylist, myListName: trimmed } });
    }
  };

  // --- プレイリスト (完全ローカル) 操作 ---
  const handleCreatePlaylist = async (): Promise<void> => {
    const name = newPlaylistName.trim();
    if (!name) return;
    await window.nndd.invoke(IpcChannel.PLAYLIST_CREATE, name);
    setNewPlaylistName('');
    reloadPlaylists();
  };

  const handleRemovePlaylist = async (pl: Playlist): Promise<void> => {
    if (!window.confirm(`「${pl.name}」を削除しますか?`)) return;
    await window.nndd.invoke(IpcChannel.PLAYLIST_REMOVE, pl.id);
    if (selected?.kind === 'playlist' && selected.playlist.id === pl.id) {
      setSelected(null);
      setItems([]);
    }
    reloadPlaylists();
  };

  const handleRenamePlaylist = async (pl: Playlist, name: string): Promise<void> => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === pl.name) {
      setEditingPlaylistId(null);
      return;
    }
    await window.nndd.invoke(IpcChannel.PLAYLIST_RENAME, { id: pl.id, name: trimmed });
    setEditingPlaylistId(null);
    reloadPlaylists();
    if (selected?.kind === 'playlist' && selected.playlist.id === pl.id) {
      setSelected({ kind: 'playlist', playlist: { ...selected.playlist, name: trimmed } });
    }
  };

  const handleRemoveVideoFromPlaylist = async (videoId: string): Promise<void> => {
    if (selected?.kind !== 'playlist') return;
    await window.nndd.invoke(IpcChannel.PLAYLIST_REMOVE_VIDEO, { playlistId: selected.playlist.id, videoId });
    setItems((prev) => prev.filter((it) => it.videoId !== videoId));
  };

  const moveItem = (index: number, dir: -1 | 1): void => {
    if (selected?.kind !== 'playlist') return;
    const target = index + dir;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    setItems(next);
    window.nndd
      .invoke(IpcChannel.PLAYLIST_REORDER, {
        playlistId: selected.playlist.id,
        videoIds: next.map((it) => it.videoId)
      })
      .catch(console.error);
  };

  // 選択クリック処理 (shift/ctrl)
  const handleItemClick = (videoId: string, e: React.MouseEvent): void => {
    if (e.shiftKey && lastClickedId) {
      const ids = filteredItems.map((it) => it.videoId);
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
      ? filteredItems.filter((it) => selectedIds.has(it.videoId))
      : filteredItems;
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
    : `一括DL (${filteredItems.length}件)`;
  const isPlaylistSelected = selected?.kind === 'playlist';

  return (
    <div className="h-full flex">
      <aside className="w-72 border-r border-nndd-border bg-nndd-panel flex flex-col overflow-hidden">
        <div className="p-2 border-b border-nndd-border space-y-1 shrink-0">
          <div className="text-xs font-bold text-nndd-subtext">マイリスト追加</div>
          <input
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            onBlur={() => void handleUrlPreview()}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleUrlPreview(); }}
            placeholder="URL or ID (マイリスト/チャンネル/ユーザー/シリーズ)"
            className="w-full bg-nndd-bg border border-nndd-border px-2 py-1 text-xs"
          />
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="表示名 (省略可)"
            className="w-full bg-nndd-bg border border-nndd-border px-2 py-1 text-xs"
          />
          {newUrl.trim() && !urlError && (
            <div className="text-xs text-nndd-subtext">
              種別: {typeLabel(newType)} {typeNameJa(newType)} {previewLoading && '(取得中…)'}
            </div>
          )}
          {urlError && (
            <div className="text-xs text-red-500 dark:text-red-400">⚠ {urlError}</div>
          )}
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
          <div className="px-2 py-1 text-xs font-bold text-nndd-subtext bg-nndd-bg sticky top-0">
            マイリスト
          </div>
          {mylists.length === 0 && (
            <div className="p-3 text-xs text-nndd-subtext">登録されているマイリストはありません。</div>
          )}
          {mylists.map((ml) => (
            <div
              key={ml.myListUrl}
              className={[
                'flex items-center gap-1 px-2 py-1 text-xs border-b border-nndd-border cursor-pointer',
                selected?.kind === 'mylist' && selected.mylist.myListUrl === ml.myListUrl ? 'bg-nndd-bg' : 'hover:bg-nndd-border'
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

          <div className="px-2 py-1 text-xs font-bold text-nndd-subtext bg-nndd-bg sticky top-0 border-t border-nndd-border mt-1">
            プレイリスト (ローカル)
          </div>
          <div className="p-2 border-b border-nndd-border flex gap-1">
            <input
              value={newPlaylistName}
              onChange={(e) => setNewPlaylistName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreatePlaylist(); }}
              placeholder="新しいプレイリスト名"
              className="flex-1 min-w-0 bg-nndd-bg border border-nndd-border px-2 py-1 text-xs"
            />
            <button
              onClick={handleCreatePlaylist}
              className="text-xs px-3 py-1 bg-nndd-accent text-white rounded hover:opacity-80"
            >
              作成
            </button>
          </div>
          {playlists.length === 0 && (
            <div className="p-3 text-xs text-nndd-subtext">プレイリストがありません。</div>
          )}
          {playlists.map((pl) => (
            <div
              key={pl.id}
              className={[
                'flex items-center gap-1 px-2 py-1 text-xs border-b border-nndd-border cursor-pointer',
                selected?.kind === 'playlist' && selected.playlist.id === pl.id ? 'bg-nndd-bg' : 'hover:bg-nndd-border'
              ].join(' ')}
              onClick={() => editingPlaylistId !== pl.id && fetchPlaylistItems(pl)}
              onContextMenu={(e) => {
                e.preventDefault();
                setEditingPlaylistId(pl.id);
                setEditingPlaylistName(pl.name);
              }}
            >
              <span className="text-nndd-subtext shrink-0">📑</span>
              {editingPlaylistId === pl.id ? (
                <input
                  autoFocus
                  value={editingPlaylistName}
                  onChange={(e) => setEditingPlaylistName(e.target.value)}
                  onBlur={() => handleRenamePlaylist(pl, editingPlaylistName)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRenamePlaylist(pl, editingPlaylistName);
                    if (e.key === 'Escape') setEditingPlaylistId(null);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="flex-1 min-w-0 bg-nndd-bg border border-nndd-accent px-1 py-0 text-xs outline-none"
                />
              ) : (
                <span className="flex-1 truncate" title={pl.name}>{pl.name}</span>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); handleRemovePlaylist(pl); }}
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
          <div className="p-3 text-nndd-subtext text-sm">左からマイリストまたはプレイリストを選択してください。</div>
        )}
        {selected && (
          <>
            {/* ヘッダー */}
            <div className="shrink-0 p-2 border-b border-nndd-border bg-nndd-panel flex items-center gap-2 flex-wrap">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold truncate">
                  {selected.kind === 'mylist' ? selected.mylist.myListName : selected.playlist.name}
                </div>
                {selected.kind === 'mylist' && (
                  <div
                    className="text-xs text-nndd-subtext truncate cursor-pointer hover:underline"
                    title="クリックでIDをコピー"
                    onClick={() => {
                      const id = extractId(selected.mylist.myListUrl);
                      navigator.clipboard.writeText(id);
                      showToast('IDをコピーしました');
                    }}
                  >
                    {extractId(selected.mylist.myListUrl)}
                  </div>
                )}
              </div>
              {selectedIds.size > 0 && (
                <button
                  onClick={() => setSelectedIds(new Set())}
                  className="text-xs px-2 py-1 bg-nndd-border rounded hover:bg-nndd-accent hover:text-white"
                >
                  選択解除
                </button>
              )}
              {selected.kind === 'mylist' && !mylists.some((m) => m.myListUrl === selected.mylist.myListUrl) && (
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
                  disabled={loading || filteredItems.length === 0}
                  onPlay={(audioOnly) => {
                    if (filteredItems.length === 0) return;
                    const videoIds = filteredItems.map((it) => it.videoId);
                    const startIdx = selectedIds.size > 0
                      ? filteredItems.findIndex((it) => selectedIds.has(it.videoId))
                      : 0;
                    window.nndd.invoke(IpcChannel.VIDEO_OPEN_PLAYER, {
                      videoId: videoIds[startIdx >= 0 ? startIdx : 0],
                      searchPlaylist: videoIds,
                      audioOnly: audioOnly || undefined,
                    });
                  }}
                />
                <input
                  value={searchText}
                  onChange={(e) => handleSearchTextChange(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSearchConfirm(); }}
                  placeholder="タイトルで絞り込み"
                  className="bg-nndd-bg border border-nndd-border px-2 py-1 text-xs"
                />
                {loadingAll && (
                  <span className="text-nndd-subtext animate-pulse">
                    全件読込中… ({loadedCount.toLocaleString()}/{totalItems.toLocaleString()}件)
                  </span>
                )}
                <span className="text-nndd-subtext">{filteredItems.length} 件</span>
              </div>
            )}

            {/* ページネーションバー (固定、マイリストのみ) */}
            {selected.kind === 'mylist' && (items.length > 0 || loading) && totalItems > PAGE_SIZE && (
              <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-nndd-border bg-nndd-panel text-xs">
                <span className="text-nndd-subtext">
                  {totalItems > 0
                    ? `${totalItems.toLocaleString()} 件中 ${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, totalItems)} 件表示`
                    : ''}
                </span>
                <div className="flex items-center gap-1 ml-auto">
                  <button
                    onClick={() => selected.kind === 'mylist' && void fetchItems(selected.mylist, currentPage - 1)}
                    disabled={loading || currentPage <= 1}
                    className="px-2 py-0.5 bg-nndd-border rounded hover:bg-nndd-accent disabled:opacity-40"
                  >◀ 前</button>
                  <span className="text-nndd-subtext px-2">
                    {currentPage} / {Math.ceil(totalItems / PAGE_SIZE)}
                  </span>
                  <button
                    onClick={() => selected.kind === 'mylist' && void fetchItems(selected.mylist, currentPage + 1)}
                    disabled={loading || currentPage >= Math.ceil(totalItems / PAGE_SIZE)}
                    className="px-2 py-0.5 bg-nndd-border rounded hover:bg-nndd-accent disabled:opacity-40"
                  >次 ▶</button>
                </div>
              </div>
            )}

            <div className="flex-1 overflow-auto p-3">
              {loading ? (
                <div className="text-nndd-subtext text-sm">読み込み中…</div>
              ) : filteredItems.length === 0 ? (
                <div className="text-nndd-subtext text-sm">
                  {searchText.trim()
                    ? '該当する動画がありません。'
                    : isPlaylistSelected
                      ? '動画がありません。動画の右クリックメニューから「プレイリストに追加」してください。'
                      : '動画なし'}
                </div>
              ) : displayMode === 'grid' ? (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
                  {filteredItems.map((it) => {
                    const idx = items.findIndex((x) => x.videoId === it.videoId);
                    return (
                    <div
                      key={it.videoId}
                      onClick={(e) => handleItemClick(it.videoId, e)}
                      className={[
                        'relative rounded cursor-pointer',
                        selectedIds.has(it.videoId) ? 'ring-2 ring-nndd-accent' : ''
                      ].join(' ')}
                    >
                      <VideoCard
                        data={it}
                        onPlay={handlePlay}
                        onDownload={handleDownload}
                        onNiconico={handleNiconico}
                        onPlayAudioOnly={handlePlayAudioOnly}
                        isDownloaded={downloadedIds.has(it.videoId)}
                        onRemove={isPlaylistSelected ? handleRemoveVideoFromPlaylist : undefined}
                      />
                      {isPlaylistSelected && (
                        <div className="absolute left-1 top-1 flex flex-col gap-0.5 z-10">
                          <button
                            onClick={(e) => { e.stopPropagation(); moveItem(idx, -1); }}
                            disabled={idx <= 0}
                            className="w-5 h-5 text-xs bg-black/60 text-white rounded disabled:opacity-30"
                            title="上へ"
                          >▲</button>
                          <button
                            onClick={(e) => { e.stopPropagation(); moveItem(idx, 1); }}
                            disabled={idx === items.length - 1}
                            className="w-5 h-5 text-xs bg-black/60 text-white rounded disabled:opacity-30"
                            title="下へ"
                          >▼</button>
                        </div>
                      )}
                    </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  {filteredItems.map((it) => {
                    const idx = items.findIndex((x) => x.videoId === it.videoId);
                    return (
                    <div
                      key={it.videoId}
                      className={[
                        'flex items-center gap-1 rounded',
                        selectedIds.has(it.videoId) ? 'ring-2 ring-nndd-accent' : ''
                      ].join(' ')}
                    >
                      {isPlaylistSelected && (
                        <div className="flex flex-col gap-0.5 shrink-0">
                          <button
                            onClick={() => moveItem(idx, -1)}
                            disabled={idx <= 0}
                            className="w-5 h-4 text-xs bg-nndd-border rounded disabled:opacity-30"
                            title="上へ"
                          >▲</button>
                          <button
                            onClick={() => moveItem(idx, 1)}
                            disabled={idx === items.length - 1}
                            className="w-5 h-4 text-xs bg-nndd-border rounded disabled:opacity-30"
                            title="下へ"
                          >▼</button>
                        </div>
                      )}
                      <div
                        className="flex-1 min-w-0 cursor-pointer"
                        onClick={(e) => handleItemClick(it.videoId, e)}
                      >
                        <VideoCard
                          data={it}
                          layout="list"
                          onPlay={handlePlay}
                          onDownload={handleDownload}
                          onNiconico={handleNiconico}
                          onPlayAudioOnly={handlePlayAudioOnly}
                          isDownloaded={downloadedIds.has(it.videoId)}
                          onRemove={isPlaylistSelected ? handleRemoveVideoFromPlaylist : undefined}
                        />
                      </div>
                    </div>
                    );
                  })}
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
function mylistItemToCard(it: MyListItem): VideoCardData {
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

/** PlaylistItem → VideoCardData (追加時のスナップショットのみ、統計情報はなし) */
function playlistItemToCard(it: PlaylistItem): VideoCardData {
  return {
    videoId: it.videoId,
    title: it.title,
    thumbnailUrl: it.thumbnailUrl,
    length: it.lengthSec,
    viewCount: 0,
    commentCount: 0,
    mylistCount: 0,
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

function typeNameJa(t: RssTypeValue): string {
  switch (t) {
    case RssType.MY_LIST: return 'マイリスト';
    case RssType.CHANNEL: return 'チャンネル';
    case RssType.COMMUNITY: return 'コミュニティ (終了済)';
    case RssType.USER_UPLOAD_VIDEO: return 'ユーザー投稿';
    case RssType.SERIES: return 'シリーズ';
    default: return '不明';
  }
}
