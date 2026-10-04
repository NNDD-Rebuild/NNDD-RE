import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import type { MyListItem, WatchPageInfo } from '@shared/types';
import { IpcChannel } from '@shared/types';
import type { PlayInfo } from './playerUtils';

type SeriesPage = { items: { videoId: string }[]; page: number; totalPages: number };

type ActivePlaylist =
  | { type: 'search'; list: string[]; idx: number }
  | { type: 'folder'; list: string[]; idx: number }
  | { type: 'series'; list: MyListItem[]; idx: number };

/**
 * 連続再生 (シリーズ / 関連動画 / フォルダ / 検索結果プレイリスト) と前後スキップ。
 *
 * 各リストは state (描画用) と ref (イベントハンドラ・タイマー内で最新値を読む用) の両方で持つ。
 * 返す関数はいずれも ref だけを読むため、マウント時に一度だけ登録されるリスナーから呼んでも古くならない。
 */
export function usePlaylist({
  watchVideoId,
  currentVideoId,
  isLocal,
  isLocalRef,
  watchRef,
  playInfoRef,
  audioOnlyRef
}: {
  /** watch?.videoId (関連動画の取得トリガ) */
  watchVideoId: string | undefined;
  /** watch?.videoId ?? playInfoRef.current?.videoId */
  currentVideoId: string | undefined;
  isLocal: boolean;
  isLocalRef: MutableRefObject<boolean>;
  watchRef: MutableRefObject<WatchPageInfo | null>;
  playInfoRef: MutableRefObject<PlayInfo | null>;
  audioOnlyRef: MutableRefObject<boolean>;
}) {
  const [autoNextSeries, setAutoNextSeries] = useState(false);
  const autoNextSeriesRef = useRef(false);
  const seriesItemsRef = useRef<MyListItem[]>([]);
  const [seriesItems, setSeriesItems] = useState<MyListItem[]>([]);
  const seriesPageRef = useRef(1);
  const seriesTotalPagesRef = useRef(1);
  const seriesIdRef = useRef('');
  const [autoNextRelated, setAutoNextRelated] = useState(false);
  const autoNextRelatedRef = useRef(false);
  const relatedItemsRef = useRef<MyListItem[]>([]);
  const [autoNextFolder, setAutoNextFolder] = useState(false);
  const autoNextFolderRef = useRef(false);
  const [folderVideos, setFolderVideos] = useState<string[]>([]);
  const folderVideosRef = useRef<string[]>([]);
  const currentLocalPathRef = useRef<string>('');
  const [searchPlaylist, setSearchPlaylist] = useState<string[]>([]);
  const searchPlaylistRef = useRef<string[]>([]);

  useEffect(() => { searchPlaylistRef.current = searchPlaylist; }, [searchPlaylist]);

  // 関連動画の連続再生ON時、動画切り替わりごとに次動画候補をバックグラウンド取得。
  // シリーズと違い関連動画リストは動画ごとに変わるため、関連動画タブを開いていない間も
  // ここで都度取得しないと2本目以降で relatedItemsRef が更新されず連続再生が止まる。
  useEffect(() => {
    if (!autoNextRelated || !watchVideoId) return;
    window.nndd
      .invoke<MyListItem[]>(IpcChannel.VIDEO_GET_RELATED, watchVideoId)
      .then((items) => { relatedItemsRef.current = items; })
      .catch(() => {});
  }, [watchVideoId, autoNextRelated]);

  // autoNextFolder: マウント時に設定から復元
  useEffect(() => {
    window.nndd.invoke<boolean>(window.nndd.channels.CONFIG_GET, 'player.autoNextFolder')
      .then((v) => {
        if (v != null) {
          autoNextFolderRef.current = v;
          setAutoNextFolder(v);
        }
      })
      .catch(() => {});
  }, []);

  /** 検索結果プレイリストを ref → state の順で更新 */
  const updateSearchPlaylist = (list: string[]): void => {
    searchPlaylistRef.current = list;
    setSearchPlaylist(list);
  };

  /** フォルダ内動画リストを ref → state の順で更新 */
  const updateFolderVideos = (list: string[]): void => {
    folderVideosRef.current = list;
    setFolderVideos(list);
  };

  /** 自動で次へ進む連続再生が有効か (再生失敗時のスキップ判定に使う) */
  const isAutoPlayActive = (): boolean =>
    autoNextSeriesRef.current || searchPlaylistRef.current.length > 0 || autoNextFolderRef.current;

  /** プリロード対象となる次の動画ID (ストリーミング再生時のみ) */
  const getNextVideoId = (): string | null => {
    if (isLocalRef.current) return null;
    const currentId = watchRef.current?.videoId ?? playInfoRef.current?.videoId;
    if (autoNextSeriesRef.current) {
      const items = seriesItemsRef.current;
      const idx = items.findIndex((i) => i.videoId === currentId);
      if (idx >= 0 && idx < items.length - 1) return items[idx + 1].videoId;
    }
    if (autoNextRelatedRef.current) {
      const items = relatedItemsRef.current;
      if (items.length > 0) return items[0].videoId;
    }
    const pl = searchPlaylistRef.current;
    if (pl.length > 0) {
      const idx = pl.indexOf(currentId ?? '');
      if (idx >= 0 && idx < pl.length - 1) return pl[idx + 1];
    }
    return null;
  };

  /** 連続再生で次の動画を開く。開けなかった (次が無い) 場合は false */
  const advanceToNextVideo = (): boolean => {
    const isAudio = audioOnlyRef.current || undefined;

    if (autoNextSeriesRef.current) {
      const items = seriesItemsRef.current;
      const currentId = watchRef.current?.videoId ?? playInfoRef.current?.videoId;
      const idx = items.findIndex((i) => i.videoId === currentId);
      if (idx >= 0 && idx < items.length - 1) {
        window.nndd.invoke(IpcChannel.VIDEO_OPEN_PLAYER, {
          videoId: items[idx + 1].videoId, autoNext: true, audioOnly: isAudio,
        });
        return true;
      }
      if (idx === items.length - 1 && seriesPageRef.current < seriesTotalPagesRef.current) {
        const nextPage = seriesPageRef.current + 1;
        window.nndd.invoke<SeriesPage>(
          IpcChannel.SERIES_FETCH, seriesIdRef.current, undefined, nextPage
        ).then((r) => {
          seriesItemsRef.current = r.items as MyListItem[];
          seriesPageRef.current = r.page;
          seriesTotalPagesRef.current = r.totalPages;
          if (r.items.length > 0) {
            window.nndd.invoke(IpcChannel.VIDEO_OPEN_PLAYER, {
              videoId: r.items[0].videoId, autoNext: true, audioOnly: isAudio,
            });
          }
        }).catch(() => {});
        return true;
      }
    }

    if (autoNextRelatedRef.current) {
      const items = relatedItemsRef.current;
      if (items.length > 0) {
        window.nndd.invoke(IpcChannel.VIDEO_OPEN_PLAYER, {
          videoId: items[0].videoId, autoNext: true, audioOnly: isAudio,
        });
        return true;
      }
    }

    if (autoNextFolderRef.current && isLocalRef.current) {
      const vids = folderVideosRef.current;
      const idx = vids.indexOf(currentLocalPathRef.current);
      if (idx >= 0 && idx < vids.length - 1) {
        window.nndd.invoke(IpcChannel.VIDEO_OPEN_PLAYER, {
          localPath: vids[idx + 1], folderPlaylist: vids, autoNext: true, audioOnly: isAudio,
        });
        return true;
      }
    }

    const pl = searchPlaylistRef.current;
    if (pl.length > 0) {
      const currentId = watchRef.current?.videoId ?? playInfoRef.current?.videoId;
      const idx = pl.indexOf(currentId ?? '');
      if (idx >= 0 && idx < pl.length - 1) {
        window.nndd.invoke(IpcChannel.VIDEO_OPEN_PLAYER, {
          videoId: pl[idx + 1], searchPlaylist: pl, autoNext: true, audioOnly: isAudio,
        });
        return true;
      }
    }

    return false;
  };

  const getActivePlaylist = (): ActivePlaylist | null => {
    const currentId = watchRef.current?.videoId ?? playInfoRef.current?.videoId;

    const pl = searchPlaylistRef.current;
    if (pl.length > 0 && currentId) {
      const idx = pl.indexOf(currentId);
      if (idx >= 0) return { type: 'search', list: pl, idx };
    }

    const vids = folderVideosRef.current;
    if (vids.length > 0 && isLocalRef.current) {
      const idx = vids.indexOf(currentLocalPathRef.current);
      if (idx >= 0) return { type: 'folder', list: vids, idx };
    }

    const items = seriesItemsRef.current;
    if (items.length > 0 && currentId) {
      const idx = items.findIndex((i) => i.videoId === currentId);
      if (idx >= 0) return { type: 'series', list: items, idx };
    }

    return null;
  };

  const skipToNext = (): void => {
    const isAudio = audioOnlyRef.current || undefined;
    const active = getActivePlaylist();
    if (!active) return;

    if (active.type === 'search') {
      if (active.idx < active.list.length - 1) {
        window.nndd.invoke(IpcChannel.VIDEO_OPEN_PLAYER, {
          videoId: active.list[active.idx + 1], searchPlaylist: active.list, audioOnly: isAudio,
        });
      }
      return;
    }

    if (active.type === 'folder') {
      if (active.idx < active.list.length - 1) {
        window.nndd.invoke(IpcChannel.VIDEO_OPEN_PLAYER, {
          localPath: active.list[active.idx + 1], folderPlaylist: active.list, audioOnly: isAudio,
        });
      }
      return;
    }

    if (active.type === 'series') {
      if (active.idx < active.list.length - 1) {
        window.nndd.invoke(IpcChannel.VIDEO_OPEN_PLAYER, {
          videoId: active.list[active.idx + 1].videoId, audioOnly: isAudio,
        });
        return;
      }
      if (seriesPageRef.current < seriesTotalPagesRef.current) {
        const nextPage = seriesPageRef.current + 1;
        window.nndd.invoke<SeriesPage>(
          IpcChannel.SERIES_FETCH, seriesIdRef.current, undefined, nextPage
        ).then((r) => {
          seriesItemsRef.current = r.items as MyListItem[];
          setSeriesItems(r.items as MyListItem[]);
          seriesPageRef.current = r.page;
          seriesTotalPagesRef.current = r.totalPages;
          if (r.items.length > 0) {
            window.nndd.invoke(IpcChannel.VIDEO_OPEN_PLAYER, {
              videoId: r.items[0].videoId, audioOnly: isAudio,
            });
          }
        }).catch(() => {});
      }
    }
  };

  const skipToPrev = (): void => {
    const isAudio = audioOnlyRef.current || undefined;
    const active = getActivePlaylist();
    if (!active) return;

    if (active.type === 'search') {
      if (active.idx > 0) {
        window.nndd.invoke(IpcChannel.VIDEO_OPEN_PLAYER, {
          videoId: active.list[active.idx - 1], searchPlaylist: active.list, audioOnly: isAudio,
        });
      }
      return;
    }

    if (active.type === 'folder') {
      if (active.idx > 0) {
        window.nndd.invoke(IpcChannel.VIDEO_OPEN_PLAYER, {
          localPath: active.list[active.idx - 1], folderPlaylist: active.list, audioOnly: isAudio,
        });
      }
      return;
    }

    if (active.type === 'series') {
      if (active.idx > 0) {
        window.nndd.invoke(IpcChannel.VIDEO_OPEN_PLAYER, {
          videoId: active.list[active.idx - 1].videoId, audioOnly: isAudio,
        });
        return;
      }
      if (seriesPageRef.current > 1) {
        const prevPage = seriesPageRef.current - 1;
        window.nndd.invoke<SeriesPage>(
          IpcChannel.SERIES_FETCH, seriesIdRef.current, undefined, prevPage
        ).then((r) => {
          seriesItemsRef.current = r.items as MyListItem[];
          setSeriesItems(r.items as MyListItem[]);
          seriesPageRef.current = r.page;
          seriesTotalPagesRef.current = r.totalPages;
          if (r.items.length > 0) {
            window.nndd.invoke(IpcChannel.VIDEO_OPEN_PLAYER, {
              videoId: r.items[r.items.length - 1].videoId, audioOnly: isAudio,
            });
          }
        }).catch(() => {});
      }
    }
  };

  const canSkipNext = useMemo(() => {
    if (searchPlaylist.length > 0 && currentVideoId) {
      const idx = searchPlaylist.indexOf(currentVideoId);
      return idx >= 0 && idx < searchPlaylist.length - 1;
    }
    if (folderVideos.length > 0 && isLocal) {
      const idx = folderVideos.indexOf(currentLocalPathRef.current);
      return idx >= 0 && idx < folderVideos.length - 1;
    }
    if (seriesItems.length > 0 && currentVideoId) {
      const idx = seriesItems.findIndex((i) => i.videoId === currentVideoId);
      if (idx >= 0 && idx < seriesItems.length - 1) return true;
      return seriesPageRef.current < seriesTotalPagesRef.current;
    }
    return undefined;
  }, [searchPlaylist, folderVideos, seriesItems, currentVideoId, isLocal]);

  const canSkipPrev = useMemo(() => {
    if (searchPlaylist.length > 0 && currentVideoId) {
      const idx = searchPlaylist.indexOf(currentVideoId);
      return idx > 0;
    }
    if (folderVideos.length > 0 && isLocal) {
      const idx = folderVideos.indexOf(currentLocalPathRef.current);
      return idx > 0;
    }
    if (seriesItems.length > 0 && currentVideoId) {
      const idx = seriesItems.findIndex((i) => i.videoId === currentVideoId);
      if (idx > 0) return true;
      return seriesPageRef.current > 1;
    }
    return undefined;
  }, [searchPlaylist, folderVideos, seriesItems, currentVideoId, isLocal]);

  // ── UI (チェックボックス / VideoInfoView) からの変更 ──────────
  const onAutoNextFolderChange = (checked: boolean): void => {
    autoNextFolderRef.current = checked;
    setAutoNextFolder(checked);
    window.nndd.invoke(window.nndd.channels.CONFIG_SET, 'player.autoNextFolder', checked).catch(() => {});
  };

  const onAutoNextSeriesChange = (v: boolean): void => {
    autoNextSeriesRef.current = v;
    setAutoNextSeries(v);
    if (v) { autoNextRelatedRef.current = false; setAutoNextRelated(false); }
  };

  const onSeriesPageLoaded = (items: MyListItem[], page: number, totalPages: number, sid: string): void => {
    seriesItemsRef.current = items;
    setSeriesItems(items);
    seriesPageRef.current = page;
    seriesTotalPagesRef.current = totalPages;
    seriesIdRef.current = sid;
  };

  const onAutoNextRelatedChange = (v: boolean): void => {
    autoNextRelatedRef.current = v;
    setAutoNextRelated(v);
    if (v) { autoNextSeriesRef.current = false; setAutoNextSeries(false); }
  };

  const onRelatedLoaded = (items: MyListItem[]): void => { relatedItemsRef.current = items; };

  return {
    autoNextSeries,
    autoNextRelated,
    autoNextFolder,
    autoNextFolderRef,
    folderVideos,
    currentLocalPathRef,
    canSkipNext,
    canSkipPrev,
    updateSearchPlaylist,
    updateFolderVideos,
    isAutoPlayActive,
    getNextVideoId,
    advanceToNextVideo,
    skipToNext,
    skipToPrev,
    onAutoNextFolderChange,
    onAutoNextSeriesChange,
    onSeriesPageLoaded,
    onAutoNextRelatedChange,
    onRelatedLoaded
  };
}
