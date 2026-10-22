import { useEffect, useMemo, useRef, useState } from 'react';
import type { MyList, MyListItem, Playlist, PlaylistItem } from '@shared/types';
import type { PlaylistSyncResult } from '@shared/types/playlist';
import { IpcChannel, RssType } from '@shared/types';
import { toUserFriendlyErrorMessage } from '@shared/utils/errorMessage';
import { seriesUrl, watchUrl } from '@shared/utils/nicoUrl';
import type { VideoCardData } from '../common/VideoCard';
import { VirtualizedItemList } from '../common/VirtualizedItemList';
import { ErrorNotice } from '../common/ErrorNotice';
import { ContextMenuPopup, MenuItem } from '../common/VideoCard';
import { useAppStore } from '../../store/useAppStore';
import { useWatchedIds } from '@renderer/hooks/useWatchedIds';
import { useLibraryCheck } from '@renderer/hooks/useLibraryCheck';
import { useMylistSearch } from '@renderer/hooks/mylist/useMylistSearch';
import { useMylistAccountImport } from '@renderer/hooks/mylist/useMylistAccountImport';
import { useMylistAddForm } from '@renderer/hooks/mylist/useMylistAddForm';
import { usePendingMylistNavigation } from '@renderer/hooks/mylist/usePendingMylistNavigation';
import { useMylistBulkMenu } from '@renderer/hooks/mylist/useMylistBulkMenu';
import {
  PAGE_SIZE,
  mylistItemToCard,
  playlistItemToCard,
  typeLabel,
  WATCH_LATER_NAME,
  type Selected,
  type SeriesFetchResult
} from './mylistUtils';
import { MyListAddForm, type AddKind } from './MyListAddForm';
import { AccountMylistPanel } from './AccountMylistPanel';
import { ListSidebarRow } from './ListSidebarRow';
import { MyListHeader } from './MyListHeader';
import { MylistDeleteDialog } from './MylistDeleteDialog';
import { PlaylistDeleteDialog } from './PlaylistDeleteDialog';
import { MyListFilterBar } from './MyListFilterBar';
import { MyListPagination } from './MyListPagination';
import { MyListItemCell } from './MyListItemCell';
import type { DownloadKind } from '@shared/types/download';
import { enqueueDownload } from '../../util/enqueueDownload';

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
  const [autoDlResult, setAutoDlResult] = useState<string | null>(null);
  // ページネーション (マイリストのみ)
  const [currentPage, setCurrentPage] = useState(1);
  const [totalItems, setTotalItems] = useState(0);

  // タイトル検索 (選択中リスト内) と、検索・一括DL用の全ページキャッシュ
  const {
    searchText,
    allItems,
    setAllItems,
    loadingAll,
    setLoadingAll,
    loadedCount,
    setLoadedCount,
    cancelLoadAllRef,
    filteredItems,
    resetSearch,
    fetchAllMylistPages,
    handleSearchTextChange,
    handleSearchConfirm
  } = useMylistSearch({ selected, items, totalItems });
  const scrollRef = useRef<HTMLDivElement>(null);

  // プレイリスト作成フォーム (ニコニコ同期は意図せず外部にマイリストを作らないよう既定 OFF)
  // 追加フォームの種別と、プレイリスト・フォルダの新規作成名
  const [addKind, setAddKind] = useState<AddKind>('mylist');
  const [createName, setCreateName] = useState('');
  const [newPlaylistSync, setNewPlaylistSync] = useState(false);
  // プレイリスト行の右クリックメニュー
  const [playlistCtx, setPlaylistCtx] = useState<{ x: number; y: number; pl: Playlist } | null>(null);

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

  // アイコン選択ポップオーバー
  const [iconPickerUrl, setIconPickerUrl] = useState<string | null>(null);
  const [iconPickerPlaylistId, setIconPickerPlaylistId] = useState<number | null>(null);

  // マイリストのフォルダ (展開状態・ドラッグ中の項目・新規フォルダ名)
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [dragUrl, setDragUrl] = useState<string | null>(null);

  // 一括DL中
  const [bulkDling, setBulkDling] = useState(false);
  const { downloadedIds, checkDownloaded } = useLibraryCheck();
  const videoIds = useMemo(() => items.map((it) => it.videoId), [items]);
  const watchedIds = useWatchedIds(videoIds);

  const showToast = useAppStore((s) => s.showToast);
  const isLoggedIn = useAppStore((s) => s.isLoggedIn);
  // mylists が更新された後に処理するために ref で保持
  const mylistsRef = useRef<MyList[]>([]);
  // あとで見る: 動画ID → サーバー側 itemId (削除用)
  const watchLaterItemIdsRef = useRef<Map<string, number>>(new Map());
  // 自分のマイリスト: 動画ID → サーバー側 itemId (削除用)
  const mylistItemIdsRef = useRef<Map<string, number>>(new Map());
  // 左ペイン「×」の確認ダイアログ
  const [deleteTarget, setDeleteTarget] = useState<MyList | null>(null);
  const [deletePlaylistTarget, setDeletePlaylistTarget] = useState<Playlist | null>(null);
  const [deleting, setDeleting] = useState(false);
  // 自分のマイリストID (書き込み=動画の削除・名前変更ができるリストの判定用)
  const [ownMylistIds, setOwnMylistIds] = useState<Set<string>>(new Set());

  const reloadMylists = (): void => {
    window.nndd
      .invoke<MyList[]>(IpcChannel.MYLIST_LIST)
      .then((list) => {
        mylistsRef.current = list;
        setMylists(list);
      });
  };

  /** 自分のマイリストか (書き込み操作の可否) */
  const isOwnMylist = (ml: MyList): boolean => {
    if (ml.isDir || ml.type !== RssType.MY_LIST) return false;
    const id = ml.myListUrl.match(/(?:mylist\/|^)(\d+)/)?.[1];
    return !!id && ownMylistIds.has(id);
  };

  const reloadPlaylists = (): void => {
    window.nndd.invoke<Playlist[]>(IpcChannel.PLAYLIST_LIST).then(setPlaylists);
  };

  // アカウントから取得
  const account = useMylistAccountImport({ mylists, reloadMylists });

  // グローバル設定変更を即時反映
  useEffect(() => { setDisplayMode(globalMode); }, [globalMode]);

  useEffect(() => {
    reloadMylists();
    reloadPlaylists();
    // 自分のマイリストの一覧 (ログアウト中は空)
    if (isLoggedIn) {
      window.nndd
        .invoke<string[]>(IpcChannel.MYLIST_OWN_IDS)
        .then((ids) => setOwnMylistIds(new Set(ids)))
        .catch(() => setOwnMylistIds(new Set()));
      // 別の PC で作った同期用マイリスト (登録キー付き) があれば、プレイリストとして取り込む
      window.nndd
        .invoke<Array<{ id: number; name: string }>>(IpcChannel.PLAYLIST_ADOPT_SERVER)
        .then((adopted) => {
          if (adopted.length === 0) return;
          reloadPlaylists();
          showToast(`ニコニコのマイリストから ${adopted.length} 件をプレイリストとして取り込みました`);
        })
        .catch(() => undefined);
    } else {
      setOwnMylistIds(new Set());
    }
  }, [isLoggedIn]);

  const importRevision = useAppStore((s) => s.importRevision);
  useEffect(() => {
    if (importRevision === 0) return;
    // インポートで ID が振り直されるため選択は解除する
    setSelected(null);
    setItems([]);
    setTotalItems(0);
    reloadMylists();
    reloadPlaylists();
  }, [importRevision]);

  // 右ペインの一覧取得 (fetchItems / fetchPlaylistItems / showSeries 共通) の連番。
  // リスト・ページを素早く切り替えたとき、最後に投げた取得の結果だけを反映する
  const itemsSeqRef = useRef(0);

  const fetchItems = async (ml: MyList, page = 1): Promise<void> => {
    const seq = ++itemsSeqRef.current;
    setLoading(true);
    setError(null);
    setSelected({ kind: 'mylist', mylist: ml });
    setSelectedIds(new Set());
    setLastClickedId(null);
    setCurrentPage(page);
    resetSearch();
    try {
      if (ml.type === RssType.SERIES) {
        const seriesId = ml.myListUrl.match(/series\/(\d+)/)?.[1] ?? ml.myListUrl;
        const result = await window.nndd.invoke<SeriesFetchResult>(IpcChannel.SERIES_FETCH, seriesId);
        if (seq !== itemsSeqRef.current) return;
        if (!result) { setItems([]); setTotalItems(0); return; }
        const mapped = result.items.map((it) => ({ ...it, pubDate: new Date(it.pubDate) }));
        setItems(mapped.map(mylistItemToCard));
        setTotalItems(mapped.length);
        void checkDownloaded(mapped.map((i) => i.videoId));
      } else {
        const data = await window.nndd.invoke<{ items: MyListItem[]; total: number }>(
          IpcChannel.MYLIST_FETCH_PAGE,
          { url: ml.myListUrl, type: ml.type, page, pageSize: PAGE_SIZE }
        );
        if (seq !== itemsSeqRef.current) return;
        const mapped = data.items.map((d) => ({ ...d, pubDate: new Date(d.pubDate) }));
        // 同期ONのマイリストは、削除に使う itemId (動画IDとは別) を控えておく。ページ送りでも引き継ぐ
        if (page === 1) mylistItemIdsRef.current = new Map();
        for (const d of mapped) {
          if (d.itemId !== undefined) mylistItemIdsRef.current.set(d.videoId, d.itemId);
        }
        setItems(mapped.map(mylistItemToCard));
        setTotalItems(data.total);
        void checkDownloaded(mapped.map((i) => i.videoId));
      }
    } catch (e) {
      if (seq !== itemsSeqRef.current) return;
      setError(toUserFriendlyErrorMessage(e));
      setItems([]);
      setTotalItems(0);
    } finally {
      if (seq === itemsSeqRef.current) {
        setLoading(false);
        requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: 0 }));
      }
    }
  };

  const fetchPlaylistItems = async (pl: Playlist): Promise<void> => {
    const seq = ++itemsSeqRef.current;
    setLoading(true);
    setError(null);
    setSelected({ kind: 'playlist', playlist: pl });
    setSelectedIds(new Set());
    setLastClickedId(null);
    resetSearch();
    try {
      // ニコニコと同期中のプレイリストは、開くたびに先にマージする (失敗してもローカルの中身は表示する)
      if (pl.serverMylistId && isLoggedIn) await syncPlaylist(pl);
      const list = await window.nndd.invoke<PlaylistItem[]>(IpcChannel.PLAYLIST_GET_ITEMS, pl.id);
      if (seq !== itemsSeqRef.current) return;
      setItems(list.map(playlistItemToCard));
      setTotalItems(list.length);
      void checkDownloaded(list.map((it) => it.videoId));
    } catch (e) {
      if (seq !== itemsSeqRef.current) return;
      setError(toUserFriendlyErrorMessage(e));
      setItems([]);
      setTotalItems(0);
    } finally {
      if (seq === itemsSeqRef.current) setLoading(false);
    }
  };

  /** pendingSeriesId で指定されたシリーズを一時表示 (SERIES_FETCH → 直接setItems) */
  const showSeries = async (seriesId: string): Promise<void> => {
    const seq = ++itemsSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const result = await window.nndd.invoke<SeriesFetchResult>(IpcChannel.SERIES_FETCH, seriesId).catch(() => null);
      // 取得中に別のリストを選んだ場合は、後から届いたシリーズで表示を奪わない
      if (seq !== itemsSeqRef.current) return;
      if (!result) return;
      const url = seriesUrl(seriesId);
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
      // 前のリストの検索語・全件キャッシュが残ると、シリーズの一覧ではなく前のリストの絞り込み結果が表示されるため消す
      resetSearch();
      setTotalItems(result.items.length);
      setCurrentPage(1);
      const seriesMapped = result.items.map((it) => ({
        ...it,
        pubDate: new Date(it.pubDate),
      }));
      setItems(seriesMapped.map(mylistItemToCard));
      void checkDownloaded(seriesMapped.map((i) => i.videoId));
    } finally {
      if (seq === itemsSeqRef.current) setLoading(false);
    }
  };

  // マイリスト追加フォーム (URLから種別を自動判定)
  const addForm = useMylistAddForm({
    fetchItems,
    reloadMylists,
    isLoggedIn,
    onCreated: (ml) => {
      // 作成したマイリストは自分のものなので、すぐ書き込み (動画の削除など) できるようにして開く
      const id = ml.myListUrl.match(/(?:mylist\/|^)(\d+)/)?.[1];
      if (id) setOwnMylistIds((prev) => new Set(prev).add(id));
      void fetchItems(ml);
      showToast(`「${ml.myListName}」をニコニコに作成しました`);
    }
  });

  // プレイヤーウィンドウからのナビゲーション
  usePendingMylistNavigation({ mylistsRef, fetchItems, showSeries });

  const { bulkMenuOpen, setBulkMenuOpen, bulkMenuRef } = useMylistBulkMenu();

  // 左ペインの「×」: 確認ダイアログを開く (実行は下の2つ)
  const handleRemove = (ml: MyList): void => setDeleteTarget(ml);

  const afterMylistRemoved = (ml: MyList): void => {
    if (selected?.kind === 'mylist' && selected.mylist.myListUrl === ml.myListUrl) {
      setSelected(null);
      setItems([]);
    }
    reloadMylists();
  };

  /** RE の登録だけ外す (ニコニコ上のマイリストは残る) */
  const handleRemoveLocal = async (ml: MyList): Promise<void> => {
    setDeleteTarget(null);
    await window.nndd.invoke(IpcChannel.MYLIST_REMOVE, ml.myListUrl);
    afterMylistRemoved(ml);
  };

  /** ニコニコ上のマイリストごと削除する (取り消せない) */
  const handleDeleteServer = async (ml: MyList): Promise<void> => {
    setDeleting(true);
    try {
      await window.nndd.invoke(IpcChannel.MYLIST_DELETE_SERVER, { url: ml.myListUrl });
      const id = ml.myListUrl.match(/(?:mylist\/|^)(\d+)/)?.[1];
      if (id) {
        setOwnMylistIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
      setDeleteTarget(null);
      afterMylistRemoved(ml);
      showToast(`「${ml.myListName}」をニコニコから削除しました`);
    } catch (e) {
      showToast(`ニコニコのマイリストを削除できませんでした: ${toUserFriendlyErrorMessage(e)}`);
    } finally {
      setDeleting(false);
    }
  };

  // 一括更新: 全マイリストを再取得して未再生数を更新する (DLキューには追加しない)
  const handleRenewAll = async (): Promise<void> => {
    setRenewingAll(true);
    setAutoDlResult(null);
    // 一括更新中に別のリスト・ページへ移動していたら、開始時に選択していたリストへ表示を戻さない
    const seqAtStart = itemsSeqRef.current;
    try {
      const results = await window.nndd.invoke<
        Record<string, { fetched: number; queued: number; error?: string }>
      >(IpcChannel.MYLIST_AUTO_DOWNLOAD_ALL);
      const total = Object.keys(results).length;
      const errors = Object.values(results).filter((r) => r.error).length;
      setAutoDlResult(
        errors > 0
          ? `${total - errors}件のマイリストを更新 (${errors}件で取得失敗)`
          : `${total}件のマイリストを更新しました`
      );
      if (selected?.kind === 'mylist' && seqAtStart === itemsSeqRef.current) await fetchItems(selected.mylist);
      reloadMylists();
    } catch (e) {
      setAutoDlResult(toUserFriendlyErrorMessage(e));
    } finally {
      setRenewingAll(false);
    }
  };

  const handleCreateFolder = async (): Promise<void> => {
    const name = createName.trim();
    if (!name) return;
    await window.nndd.invoke(IpcChannel.MYLIST_ADD, {
      myListUrl: `folder:${crypto.randomUUID()}`,
      myListName: name,
      type: RssType.MY_LIST,
      isDir: true,
      unPlayVideoCount: 0,
      myListVideoIds: {},
      parentUrl: null
    } satisfies MyList);
    setCreateName('');
    reloadMylists();
  };

  /** url を parentUrl (null でルート) のフォルダへ移動。自分自身や子孫フォルダへは移動しない */
  const handleMove = async (url: string, parentUrl: string | null): Promise<void> => {
    setDragUrl(null);
    if (url === parentUrl) return;
    const parentOf = new Map(mylists.map((m) => [m.myListUrl, m.parentUrl ?? null]));
    for (let cur = parentUrl; cur; cur = parentOf.get(cur) ?? null) {
      if (cur === url) return;
    }
    await window.nndd.invoke(IpcChannel.MYLIST_MOVE, { url, parentUrl });
    if (parentUrl) setExpandedFolders((prev) => new Set(prev).add(parentUrl));
    reloadMylists();
  };

  const toggleFolder = (url: string): void => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (!next.delete(url)) next.add(url);
      return next;
    });
  };

  // プレイリストを開いているときは、リストの並び順で次の動画へ自動再生する
  // (検索結果の連続再生と同じ searchPlaylist で渡す。絞り込み中は絞り込んだ一覧が対象)
  const playlistQueue = (): string[] | undefined =>
    selected?.kind === 'playlist' ? filteredItems.map((it) => it.videoId) : undefined;
  const handlePlay = (videoId: string): void => {
    window.nndd.invoke(IpcChannel.VIDEO_OPEN_PLAYER, { videoId, searchPlaylist: playlistQueue() });
  };
  const handlePlayAudioOnly = (videoId: string): void => {
    window.nndd.invoke(IpcChannel.VIDEO_OPEN_PLAYER, {
      videoId,
      audioOnly: true,
      searchPlaylist: playlistQueue()
    });
  };
  const handleDownload = (videoId: string, kind?: DownloadKind): void => {
    showToast(enqueueDownload(videoId, downloadedIds.has(videoId), kind));
  };
  const handleNiconico = (videoId: string): void => {
    window.nndd.invoke(window.nndd.channels.SYS_OPEN_PATH, watchUrl(videoId));
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
    try {
      await window.nndd.invoke(IpcChannel.MYLIST_UPDATE_NAME, { url: ml.myListUrl, name: trimmed });
    } catch (e) {
      // 同期ONのマイリストはサーバー反映に失敗するとローカルも変わらない
      setEditingUrl(null);
      showToast(`名前を変更できませんでした: ${toUserFriendlyErrorMessage(e)}`);
      return;
    }
    setEditingUrl(null);
    reloadMylists();
    if (selected?.kind === 'mylist' && selected.mylist.myListUrl === ml.myListUrl) {
      setSelected({ kind: 'mylist', mylist: { ...selected.mylist, myListName: trimmed } });
    }
  };

  const handleIconChange = async (ml: MyList, icon: string | null): Promise<void> => {
    await window.nndd.invoke(IpcChannel.MYLIST_UPDATE_ICON, { url: ml.myListUrl, icon });
    setIconPickerUrl(null);
    reloadMylists();
    if (selected?.kind === 'mylist' && selected.mylist.myListUrl === ml.myListUrl) {
      setSelected({ kind: 'mylist', mylist: { ...selected.mylist, icon } });
    }
  };

  const handlePlaylistIconChange = async (pl: Playlist, icon: string | null): Promise<void> => {
    await window.nndd.invoke(IpcChannel.PLAYLIST_UPDATE_ICON, { id: pl.id, icon });
    setIconPickerPlaylistId(null);
    reloadPlaylists();
    if (selected?.kind === 'playlist' && selected.playlist.id === pl.id) {
      setSelected({ kind: 'playlist', playlist: { ...selected.playlist, icon } });
    }
  };

  // --- プレイリスト (完全ローカル) 操作 ---
  const handleCreatePlaylist = async (): Promise<void> => {
    const name = createName.trim();
    if (!name) return;
    const created = await window.nndd.invoke<Playlist>(IpcChannel.PLAYLIST_CREATE, name);
    setCreateName('');
    if (newPlaylistSync) {
      if (isLoggedIn) await enablePlaylistSync(created, false);
      else showToast('ログインしていないため、ニコニコには作成しませんでした');
    }
    reloadPlaylists();
  };

  const syncSummary = (r: PlaylistSyncResult): string => {
    const parts = [`取り込み ${r.pulled} 件 / 送信 ${r.pushed} 件`];
    if (r.deletedLocal + r.deletedServer > 0) parts.push(`削除 ${r.deletedLocal + r.deletedServer} 件`);
    if (r.failed > 0) parts.push(`反映失敗 ${r.failed} 件 (次回再試行)`);
    return parts.join(' / ');
  };

  /** 同期中のプレイリストをマージする。削除が大量なら確認してから削除を含めて再実行する */
  const syncPlaylist = async (pl: Playlist, force = false): Promise<void> => {
    try {
      const r = await window.nndd.invoke<
        { ok: true; result: PlaylistSyncResult } | { ok: false; reason: string }
      >(IpcChannel.PLAYLIST_SERVER_SYNC, { id: pl.id, force });
      if (!r.ok) return;
      if (r.result.aborted === 'massDelete') {
        const ok = window.confirm(
          `「${pl.name}」の同期で削除が多く見つかりました。\n` +
            `プレイリストから ${r.result.deletedLocal} 件、ニコニコのマイリストから ${r.result.deletedServer} 件を削除します。実行しますか?`
        );
        if (ok) await syncPlaylist(pl, true);
        return;
      }
      const changed = r.result.pulled + r.result.pushed + r.result.deletedLocal + r.result.deletedServer + r.result.failed;
      if (changed > 0) showToast(`「${pl.name}」をニコニコと同期しました: ${syncSummary(r.result)}`);
    } catch (e) {
      showToast(`ニコニコとの同期に失敗しました: ${toUserFriendlyErrorMessage(e)}`);
    }
  };

  /** プレイリストのニコニコ同期を ON にする (同名の非公開マイリストを作成して初回マージ) */
  const enablePlaylistSync = async (pl: Playlist, confirmFirst: boolean): Promise<void> => {
    if (
      confirmFirst &&
      !window.confirm(
        `「${pl.name}」と同じ名前の非公開マイリストをニコニコに作成し、動画を同期します。よろしいですか?\n` +
          '(同期を解除しても、ニコニコ側のマイリストは消えません)'
      )
    ) {
      return;
    }
    try {
      const r = await window.nndd.invoke<
        { ok: true; result?: PlaylistSyncResult; error?: string } | { ok: false; reason: string }
      >(IpcChannel.PLAYLIST_SET_SYNC, { id: pl.id, enabled: true });
      if (!r.ok) {
        showToast(r.reason === 'notLoggedIn' ? 'ログインすると同期できます' : '同期を開始できませんでした');
        return;
      }
      if (r.error) showToast(`マイリストは作成しましたが、動画の同期に失敗しました: ${r.error}`);
      else if (r.result) showToast(`ニコニコと同期を開始しました: ${syncSummary(r.result)}`);
      reloadPlaylists();
    } catch (e) {
      showToast(`ニコニコ側のマイリストを作成できませんでした: ${toUserFriendlyErrorMessage(e)}`);
    }
  };

  const disablePlaylistSync = async (pl: Playlist): Promise<void> => {
    await window.nndd.invoke(IpcChannel.PLAYLIST_SET_SYNC, { id: pl.id, enabled: false });
    reloadPlaylists();
    showToast('ニコニコとの同期を解除しました (ニコニコ側のマイリストはそのまま残ります)');
  };

  // 左ペインの「×」: 確認ダイアログを開く (実行は下の2つ)
  const handleRemovePlaylist = (pl: Playlist): void => setDeletePlaylistTarget(pl);

  const afterPlaylistRemoved = (pl: Playlist): void => {
    if (selected?.kind === 'playlist' && selected.playlist.id === pl.id) {
      setSelected(null);
      setItems([]);
    }
    reloadPlaylists();
  };

  /** プレイリストだけ削除する (同期先のニコニコのマイリストは残る) */
  const handleRemovePlaylistLocal = async (pl: Playlist): Promise<void> => {
    setDeletePlaylistTarget(null);
    await window.nndd.invoke(IpcChannel.PLAYLIST_REMOVE, pl.id);
    afterPlaylistRemoved(pl);
  };

  /** 同期先のニコニコのマイリストごと削除する (取り消せない) */
  const handleRemovePlaylistWithServer = async (pl: Playlist): Promise<void> => {
    setDeleting(true);
    try {
      await window.nndd.invoke(IpcChannel.PLAYLIST_REMOVE_WITH_SERVER, { id: pl.id });
      setDeletePlaylistTarget(null);
      afterPlaylistRemoved(pl);
      showToast(`「${pl.name}」をニコニコのマイリストごと削除しました`);
    } catch (e) {
      showToast(`ニコニコのマイリストを削除できませんでした: ${toUserFriendlyErrorMessage(e)}`);
    } finally {
      setDeleting(false);
    }
  };

  const handleRenamePlaylist = async (pl: Playlist, name: string): Promise<void> => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === pl.name) {
      setEditingPlaylistId(null);
      return;
    }
    try {
      await window.nndd.invoke(IpcChannel.PLAYLIST_RENAME, { id: pl.id, name: trimmed });
    } catch (e) {
      // 同期中のプレイリストはサーバー反映に失敗するとローカルも変わらない
      setEditingPlaylistId(null);
      showToast(`名前を変更できませんでした: ${toUserFriendlyErrorMessage(e)}`);
      return;
    }
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

  // あとで見る (サーバー側。常にサーバーを正とし、ローカルには保存しない)
  const fetchWatchLaterItems = async (): Promise<void> => {
    const seq = ++itemsSeqRef.current;
    setLoading(true);
    setError(null);
    setSelected({ kind: 'watchLater' });
    setSelectedIds(new Set());
    setLastClickedId(null);
    resetSearch();
    try {
      const data = await window.nndd.invoke<{ items: MyListItem[]; total: number }>(
        IpcChannel.WATCH_LATER_FETCH
      );
      if (seq !== itemsSeqRef.current) return;
      const mapped = data.items.map((d) => ({ ...d, pubDate: new Date(d.pubDate) }));
      // 削除には動画IDではなく itemId が要るので、取得結果から対応表を作っておく
      watchLaterItemIdsRef.current = new Map(
        mapped.flatMap((d) => (d.itemId !== undefined ? [[d.videoId, d.itemId] as const] : []))
      );
      setItems(mapped.map(mylistItemToCard));
      setTotalItems(data.total);
      void checkDownloaded(mapped.map((i) => i.videoId));
    } catch (e) {
      if (seq !== itemsSeqRef.current) return;
      setError(toUserFriendlyErrorMessage(e));
      setItems([]);
      setTotalItems(0);
    } finally {
      if (seq === itemsSeqRef.current) setLoading(false);
    }
  };

  // 自分のマイリストから動画を削除 (ニコニコ側のマイリストから消える)
  const handleRemoveFromOwnMylist = async (videoId: string): Promise<void> => {
    if (selected?.kind !== 'mylist' || !isOwnMylist(selected.mylist)) return;
    const itemId = mylistItemIdsRef.current.get(videoId);
    if (itemId === undefined) return;
    try {
      await window.nndd.invoke(IpcChannel.MYLIST_SERVER_REMOVE_ITEM, {
        url: selected.mylist.myListUrl,
        itemIds: [itemId]
      });
      mylistItemIdsRef.current.delete(videoId);
      setItems((prev) => prev.filter((it) => it.videoId !== videoId));
      setTotalItems((n) => Math.max(0, n - 1));
    } catch (e) {
      showToast(`マイリストから削除できませんでした: ${toUserFriendlyErrorMessage(e)}`);
    }
  };

  const handleRemoveFromWatchLater = async (videoId: string): Promise<void> => {
    if (selected?.kind !== 'watchLater') return;
    const itemId = watchLaterItemIdsRef.current.get(videoId);
    if (itemId === undefined) return;
    try {
      await window.nndd.invoke(IpcChannel.WATCH_LATER_REMOVE, { itemIds: [itemId] });
      watchLaterItemIdsRef.current.delete(videoId);
      setItems((prev) => prev.filter((it) => it.videoId !== videoId));
      setTotalItems((n) => Math.max(0, n - 1));
    } catch (e) {
      showToast(`あとで見るから削除できませんでした: ${toUserFriendlyErrorMessage(e)}`);
    }
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

  /** 選択なしで一括DLした際、複数ページにまたがるマイリストなら全ページ分を対象にする */
  const handleBulkDownload = async (subDir?: string): Promise<void> => {
    if (bulkDling) return;
    setBulkDling(true);
    // 全件取得中に別のリスト・ページへ移動したら、古い実行は toast・読込中表示・allItems を触らない
    const seqAtStart = itemsSeqRef.current;
    try {
      let candidates: VideoCardData[];
      let dlSet = downloadedIds;
      if (selectedIds.size > 0) {
        candidates = filteredItems.filter((it) => selectedIds.has(it.videoId));
      } else if (selected?.kind === 'mylist' && allItems === null && totalItems > items.length) {
        setLoadingAll(true);
        setLoadedCount(0);
        cancelLoadAllRef.current = false;
        const all = await fetchAllMylistPages(selected.mylist).catch(() => null);
        if (seqAtStart !== itemsSeqRef.current) return;
        setLoadingAll(false);
        if (!all) {
          showToast('全件取得に失敗しました');
          return;
        }
        setAllItems(all);
        candidates = all;
        dlSet = (await checkDownloaded(all.map((i) => i.videoId))) ?? new Set();
      } else {
        candidates = filteredItems;
      }
      if (candidates.length === 0) return;
      const targets = candidates.filter((it) => !dlSet.has(it.videoId));
      const skipped = candidates.length - targets.length;
      if (targets.length === 0) {
        showToast('選択した動画は全てDL済みです');
        return;
      }
      for (const it of targets) {
        await window.nndd.invoke(IpcChannel.DOWNLOAD_ENQUEUE, { videoId: it.videoId, subDir });
      }
      showToast(
        skipped > 0
          ? `${targets.length}件をDLリストに追加しました(DL済み${skipped}件はスキップ)`
          : `${targets.length}件をDLリストに追加しました`
      );
    } finally {
      setBulkDling(false);
    }
  };

  const registeredIds = new Set(mylists.map((m) => m.myListUrl));
  const mylistChildren = new Map<string | null, MyList[]>();
  for (const m of mylists) {
    const key = m.parentUrl && registeredIds.has(m.parentUrl) ? m.parentUrl : null;
    const arr = mylistChildren.get(key);
    if (arr) arr.push(m);
    else mylistChildren.set(key, [m]);
  }

  const renderMylistRows = (parentUrl: string | null, depth: number): JSX.Element[] =>
    (mylistChildren.get(parentUrl) ?? []).flatMap((ml) => {
      const expanded = expandedFolders.has(ml.myListUrl);
      const row = (
        <ListSidebarRow
          key={ml.myListUrl}
          icon={ml.icon ?? (ml.isDir ? '📁' : typeLabel(ml.type))}
          name={ml.myListName}
          title={ml.isDir ? ml.myListName : ml.myListUrl}
          iconResetLabel={ml.isDir ? '既定に戻す' : '種別デフォルトに戻す'}
          depth={depth}
          folder={ml.isDir ? { expanded, onToggle: () => toggleFolder(ml.myListUrl) } : undefined}
          drag={{
            onDragStart: () => setDragUrl(ml.myListUrl),
            onDragEnd: () => setDragUrl(null),
            onDrop: ml.isDir && dragUrl ? () => handleMove(dragUrl, ml.myListUrl) : undefined
          }}
          isSelected={selected?.kind === 'mylist' && selected.mylist.myListUrl === ml.myListUrl}
          isEditing={editingUrl === ml.myListUrl}
          editingName={editingName}
          iconPickerOpen={iconPickerUrl === ml.myListUrl}
          onSelect={() => fetchItems(ml)}
          onStartEdit={() => {
            setEditingUrl(ml.myListUrl);
            setEditingName(ml.myListName);
          }}
          onEditingNameChange={setEditingName}
          onCommitRename={() => handleRename(ml, editingName)}
          onCancelEdit={() => setEditingUrl(null)}
          onToggleIconPicker={() => setIconPickerUrl(iconPickerUrl === ml.myListUrl ? null : ml.myListUrl)}
          onCloseIconPicker={() => setIconPickerUrl(null)}
          onIconChange={(icon) => handleIconChange(ml, icon)}
          onRemove={() => handleRemove(ml)}
        />
      );
      return ml.isDir && expanded ? [row, ...renderMylistRows(ml.myListUrl, depth + 1)] : [row];
    });
  const bulkLabel = selectedIds.size > 0
    ? `一括DL (${selectedIds.size}件選択)`
    : selected?.kind === 'mylist' && !searchText.trim() && totalItems > items.length
      ? `一括DL (全${totalItems}件)`
      : `一括DL (${filteredItems.length}件)`;
  const isPlaylistSelected = selected?.kind === 'playlist';

  return (
    <div className="h-full flex">
      <aside className="w-72 border-r border-nndd-border bg-nndd-panel flex flex-col overflow-hidden">
        <MyListAddForm
          kind={addKind}
          onKindChange={setAddKind}
          createName={createName}
          onCreateNameChange={setCreateName}
          createSync={newPlaylistSync}
          onCreateSyncChange={setNewPlaylistSync}
          isLoggedIn={isLoggedIn}
          createPending={addForm.createPending}
          createPublic={addForm.createPublic}
          onCreatePublicChange={addForm.setCreatePublic}
          creating={addForm.creating}
          onConfirmCreate={() => void addForm.handleConfirmCreate()}
          onCancelCreate={addForm.handleCancelCreate}
          onCreate={() => void (addKind === 'playlist' ? handleCreatePlaylist() : handleCreateFolder())}
          newUrl={addForm.newUrl}
          onNewUrlChange={addForm.setNewUrl}
          newName={addForm.newName}
          onNewNameChange={addForm.setNewName}
          newType={addForm.newType}
          urlError={addForm.urlError}
          previewLoading={addForm.previewLoading}
          urlHistory={addForm.urlHistory}
          onUrlPreview={addForm.handleUrlPreview}
          onAdd={addForm.handleAdd}
          renewingAll={renewingAll}
          onRenewAll={handleRenewAll}
          accountFetching={account.accountFetching}
          onFetchAccount={account.handleFetchAccount}
          autoDlResult={autoDlResult}
          accountError={account.accountError}
        />

        {/* アカウントマイリスト取得結果 */}
        {account.accountMylists !== null && (
          <AccountMylistPanel
            accountMylists={account.accountMylists}
            registeredIds={registeredIds}
            importingIds={account.importingIds}
            onImportAll={account.handleImportAll}
            onClose={() => account.setAccountMylists(null)}
            onImportOne={account.handleImportOne}
          />
        )}

        <div className="flex-1 overflow-auto">
          <div className="px-2 py-1 text-xs font-bold text-nndd-subtext bg-nndd-bg sticky top-0">
            マイリスト
          </div>
          {isLoggedIn && (
            <div
              onClick={() => void fetchWatchLaterItems()}
              className={[
                'flex items-center gap-1 px-2 py-1 text-xs border-b border-nndd-border cursor-pointer',
                selected?.kind === 'watchLater' ? 'bg-nndd-bg' : 'hover:bg-nndd-border'
              ].join(' ')}
              title="ニコニコのあとで見る (常にサーバーと同期)"
            >
              <span className="text-nndd-subtext shrink-0">🕒</span>
              <span className="flex-1 truncate">{WATCH_LATER_NAME}</span>
            </div>
          )}
          {mylists.length === 0 && (
            <div className="p-3 text-xs text-nndd-subtext">登録されているマイリストはありません。</div>
          )}
          <div
            onDragOver={dragUrl ? (e) => e.preventDefault() : undefined}
            onDrop={dragUrl ? (e) => { e.preventDefault(); handleMove(dragUrl, null); } : undefined}
          >
            {renderMylistRows(null, 0)}
          </div>

          <div className="px-2 py-1 text-xs font-bold text-nndd-subtext bg-nndd-bg sticky top-0 border-t border-nndd-border mt-1">
            プレイリスト
          </div>
          {playlists.length === 0 && (
            <div className="p-3 text-xs text-nndd-subtext">プレイリストがありません。</div>
          )}
          {playlists.map((pl) => (
            <ListSidebarRow
              key={pl.id}
              icon={pl.icon ?? '📑'}
              name={pl.name}
              title={pl.name}
              iconResetLabel="既定に戻す"
              isSelected={selected?.kind === 'playlist' && selected.playlist.id === pl.id}
              isEditing={editingPlaylistId === pl.id}
              editingName={editingPlaylistName}
              iconPickerOpen={iconPickerPlaylistId === pl.id}
              onSelect={() => fetchPlaylistItems(pl)}
              onStartEdit={() => {
                setEditingPlaylistId(pl.id);
                setEditingPlaylistName(pl.name);
              }}
              onEditingNameChange={setEditingPlaylistName}
              onCommitRename={() => handleRenamePlaylist(pl, editingPlaylistName)}
              onCancelEdit={() => setEditingPlaylistId(null)}
              onToggleIconPicker={() => setIconPickerPlaylistId(iconPickerPlaylistId === pl.id ? null : pl.id)}
              onCloseIconPicker={() => setIconPickerPlaylistId(null)}
              onIconChange={(icon) => handlePlaylistIconChange(pl, icon)}
              onRemove={() => handleRemovePlaylist(pl)}
              onContextMenu={(e) => setPlaylistCtx({ x: e.clientX, y: e.clientY, pl })}
              syncBadge={pl.serverMylistId ? 'ニコニコと同期中' : undefined}
            />
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
            <MyListHeader
              selected={selected}
              selectedCount={selectedIds.size}
              onClearSelection={() => setSelectedIds(new Set())}
              showAddCurrent={selected.kind === 'mylist' && !mylists.some((m) => m.myListUrl === selected.mylist.myListUrl)}
              onAddCurrent={handleAddCurrentMylist}
              bulkMenuRef={bulkMenuRef}
              bulkMenuOpen={bulkMenuOpen}
              setBulkMenuOpen={setBulkMenuOpen}
              bulkDling={bulkDling}
              bulkDisabled={items.length === 0}
              bulkLabel={bulkLabel}
              onBulkDownload={handleBulkDownload}
              displayMode={displayMode}
              onDisplayModeChange={setDisplayMode}
              showToast={showToast}
            />

            {error && <ErrorNotice kind="video" className="text-sm p-2">エラー: {error}</ErrorNotice>}

            {items.length > 0 && (
              <MyListFilterBar
                loading={loading}
                filteredItems={filteredItems}
                selectedIds={selectedIds}
                searchText={searchText}
                onSearchTextChange={handleSearchTextChange}
                onSearchConfirm={handleSearchConfirm}
                loadingAll={loadingAll}
                loadedCount={loadedCount}
                totalItems={totalItems}
              />
            )}

            {/* ページネーションバー (固定、マイリストのみ) */}
            {selected.kind === 'mylist' && (items.length > 0 || loading) && totalItems > PAGE_SIZE && (
              <MyListPagination
                totalItems={totalItems}
                currentPage={currentPage}
                loading={loading}
                onPageChange={(page) => selected.kind === 'mylist' && void fetchItems(selected.mylist, page)}
              />
            )}

            <div ref={scrollRef} className="flex-1 overflow-auto p-3">
              {loading ? (
                <div className="text-nndd-subtext text-sm">読み込み中…</div>
              ) : filteredItems.length === 0 ? (
                <div className="text-nndd-subtext text-sm">
                  {searchText.trim()
                    ? '該当する動画がありません。'
                    : isPlaylistSelected
                      ? '動画がありません。動画の右クリックメニューから「プレイリストに追加」してください。'
                      : selected.kind === 'watchLater'
                        ? 'あとで見るに動画がありません。動画の右クリックメニューから「あとで見るに追加」できます。'
                        : '動画なし'}
                </div>
              ) : (
                <VirtualizedItemList
                  items={filteredItems}
                  layout={displayMode}
                  scrollElementRef={scrollRef}
                  getKey={(it) => it.videoId}
                  renderItem={(it) => (
                    <MyListItemCell
                      item={it}
                      index={items.findIndex((x) => x.videoId === it.videoId)}
                      itemCount={items.length}
                      displayMode={displayMode}
                      isSelected={selectedIds.has(it.videoId)}
                      isPlaylist={isPlaylistSelected}
                      isDownloaded={downloadedIds.has(it.videoId)}
                      isWatched={watchedIds.has(it.videoId)}
                      onItemClick={handleItemClick}
                      onMove={moveItem}
                      onPlay={handlePlay}
                      onDownload={handleDownload}
                      onNiconico={handleNiconico}
                      onPlayAudioOnly={handlePlayAudioOnly}
                      onRemove={
                        isPlaylistSelected
                          ? handleRemoveVideoFromPlaylist
                          : selected.kind === 'watchLater'
                            ? handleRemoveFromWatchLater
                            : selected.kind === 'mylist' && isOwnMylist(selected.mylist)
                              ? handleRemoveFromOwnMylist
                              : undefined
                      }
                    />
                  )}
                />
              )}
            </div>
          </>
        )}
      </main>
      {deleteTarget && (
        <MylistDeleteDialog
          mylist={deleteTarget}
          isOwn={isOwnMylist(deleteTarget)}
          busy={deleting}
          onCancel={() => setDeleteTarget(null)}
          onRemoveLocal={() => void handleRemoveLocal(deleteTarget)}
          onDeleteServer={() => void handleDeleteServer(deleteTarget)}
        />
      )}
      {deletePlaylistTarget && (
        <PlaylistDeleteDialog
          playlist={deletePlaylistTarget}
          busy={deleting}
          onCancel={() => setDeletePlaylistTarget(null)}
          onRemoveLocal={() => void handleRemovePlaylistLocal(deletePlaylistTarget)}
          onDeleteServer={() => void handleRemovePlaylistWithServer(deletePlaylistTarget)}
        />
      )}
      {playlistCtx && (
        <ContextMenuPopup x={playlistCtx.x} y={playlistCtx.y} onClose={() => setPlaylistCtx(null)}>
          <MenuItem
            onClick={() => {
              setEditingPlaylistId(playlistCtx.pl.id);
              setEditingPlaylistName(playlistCtx.pl.name);
              setPlaylistCtx(null);
            }}
          >
            ✏ 名前を変更
          </MenuItem>
          {playlistCtx.pl.serverMylistId ? (
            <>
              <MenuItem
                onClick={() => {
                  const pl = playlistCtx.pl;
                  setPlaylistCtx(null);
                  void syncPlaylist(pl).then(() => {
                    if (selected?.kind === 'playlist' && selected.playlist.id === pl.id) void fetchPlaylistItems(pl);
                  });
                }}
              >
                🔄 今すぐ同期
              </MenuItem>
              <MenuItem
                onClick={() => {
                  const pl = playlistCtx.pl;
                  setPlaylistCtx(null);
                  void disablePlaylistSync(pl);
                }}
              >
                ⛔ ニコニコとの同期を解除
              </MenuItem>
            </>
          ) : (
            isLoggedIn && (
              <MenuItem
                onClick={() => {
                  const pl = playlistCtx.pl;
                  setPlaylistCtx(null);
                  void enablePlaylistSync(pl, true);
                }}
              >
                🔄 ニコニコと同期する
              </MenuItem>
            )
          )}
        </ContextMenuPopup>
      )}
    </div>
  );
}
