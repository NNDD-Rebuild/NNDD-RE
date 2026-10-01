import { useEffect, useMemo, useRef, useState } from 'react';
import type { NNDDREVideo } from '@shared/types';
import { IpcChannel } from '@shared/types';
import { watchUrl } from '@shared/utils/nicoUrl';
import { ContextMenuPopup, MenuItem } from '../common/VideoCard';
import { useAppStore } from '@renderer/store/useAppStore';
import { useLibraryVideos } from '@renderer/hooks/library/useLibraryVideos';
import { useLibraryFolderTree } from '@renderer/hooks/library/useLibraryFolderTree';
import { useLanLibrary } from '@renderer/hooks/library/useLanLibrary';
import { useLibraryFolderCreate } from '@renderer/hooks/library/useLibraryFolderCreate';
import {
  LAN_FOLDER,
  extractVideoId,
  type LibraryDisplayMode,
  type LibraryItemHandlers,
  type SortCol,
  type SortDir,
  type ViewMode
} from './libraryUtils';
import { FolderCreateArea, LibraryFolderList, LibraryTagList, TabBtn } from './LibrarySidebarParts';
import { LanLibraryPane } from './LanLibraryPane';
import { LibraryToolbar } from './LibraryToolbar';
import { LibraryGridView } from './LibraryGridView';
import { LibraryTableView } from './LibraryTableView';

export function LibraryView(): JSX.Element {
  const [scanning, setScanning] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [mode, setMode] = useState<ViewMode>('folder');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [searchText, setSearchText] = useState('');
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const globalLibraryMode = useAppStore((s) => s.libraryViewMode);
  const [displayMode, setDisplayMode] = useState<LibraryDisplayMode>(globalLibraryMode);
  const [sortCol, setSortCol] = useState<SortCol>('pubDate');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; video: NNDDREVideo } | null>(null);

  // LAN
  const [lanEnabled, setLanEnabled] = useState(false);
  const lan = useLanLibrary();

  useEffect(() => {
    window.nndd.invoke<SortCol>(window.nndd.channels.CONFIG_GET, 'ui.librarySortCol')
      .then((v) => { if (v === 'videoName' || v === 'time' || v === 'playCount' || v === 'pubDate' || v === 'creationDate') setSortCol(v); })
      .catch(() => {});
    window.nndd.invoke<SortDir>(window.nndd.channels.CONFIG_GET, 'ui.librarySortDir')
      .then((v) => { if (v === 'asc' || v === 'desc') setSortDir(v); })
      .catch(() => {});
    window.nndd.invoke<{ enabled: boolean; address: string; port: number }>(
      window.nndd.channels.CONFIG_GET, 'remoteNndd'
    ).then((cfg) => {
      setLanEnabled(!!(cfg?.enabled && cfg.address));
    }).catch(() => {});
  }, []);

  useEffect(() => { setDisplayMode(globalLibraryMode); }, [globalLibraryMode]);

  const [selectedVideoIds, setSelectedVideoIds] = useState<Set<number>>(new Set());
  const lastClickedIdRef = useRef<number | null>(null);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);

  // 動画一覧の読み込み (初回・タブ復帰時・DL 完了時に reload)
  const { videos, setVideos, loading, fsFolders, reload } = useLibraryVideos();

  const folderCreate = useLibraryFolderCreate(reload);

  const tagStats = useMemo(() => {
    const map = new Map<string, number>();
    for (const v of videos) {
      for (const t of v.tagStrings) {
        map.set(t, (map.get(t) ?? 0) + 1);
      }
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [videos]);

  const { folderTree, folderVideoCounts, expandedFolders, toggleFolderExpand } =
    useLibraryFolderTree(videos, fsFolders);

  const handleFolderDragOver = (path: string, e: React.DragEvent): void => {
    if (e.dataTransfer.types.includes('application/nndd-video-ids')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDragOverFolder(path);
    }
  };

  const filtered = useMemo(() => {
    if (selectedFolder === LAN_FOLDER) return [];
    return videos.filter((v) => {
      if (mode === 'tag' && selectedTag) {
        if (!v.tagStrings.includes(selectedTag)) return false;
      }
      if (mode === 'folder' && selectedFolder !== null) {
        const d = v.uri.replace(/[/\\][^/\\]+$/, '');
        if (d !== selectedFolder) return false;
      }
      if (favoriteOnly && !v.isFavorite) return false;
      if (searchText.trim()) {
        const q = searchText.toLowerCase();
        const hit =
          v.videoName.toLowerCase().includes(q) ||
          v.description.toLowerCase().includes(q) ||
          v.tagStrings.some((t) => t.toLowerCase().includes(q));
        if (!hit) return false;
      }
      return true;
    });
  }, [videos, mode, selectedTag, selectedFolder, favoriteOnly, searchText]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortCol === 'videoName') {
        cmp = a.videoName.localeCompare(b.videoName, 'ja');
      } else if (sortCol === 'time') {
        cmp = a.time - b.time;
      } else if (sortCol === 'playCount') {
        cmp = a.playCount - b.playCount;
      } else if (sortCol === 'creationDate') {
        cmp = a.creationDate.getTime() - b.creationDate.getTime();
      } else {
        const at = a.pubDate?.getTime() ?? 0;
        const bt = b.pubDate?.getTime() ?? 0;
        cmp = at - bt;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filtered, sortCol, sortDir]);

  const handleSort = (col: SortCol): void => {
    if (sortCol === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
  };

  const sortIndicator = (col: SortCol): string => {
    if (sortCol !== col) return '';
    return sortDir === 'asc' ? ' ▲' : ' ▼';
  };

  const handleVideoClick = (v: NNDDREVideo, e: React.MouseEvent): void => {
    setSelected(v.id);
    if (e.ctrlKey || e.metaKey) {
      setSelectedVideoIds((prev) => {
        const next = new Set(prev);
        if (next.has(v.id)) next.delete(v.id);
        else next.add(v.id);
        return next;
      });
      lastClickedIdRef.current = v.id;
    } else if (e.shiftKey && lastClickedIdRef.current !== null) {
      const lastIdx = sorted.findIndex((x) => x.id === lastClickedIdRef.current);
      const currIdx = sorted.findIndex((x) => x.id === v.id);
      const [from, to] = lastIdx <= currIdx ? [lastIdx, currIdx] : [currIdx, lastIdx];
      setSelectedVideoIds(new Set(sorted.slice(from, to + 1).map((x) => x.id)));
    } else {
      setSelectedVideoIds(new Set());
      lastClickedIdRef.current = v.id;
    }
  };

  const handleVideoDragStart = (e: React.DragEvent, v: NNDDREVideo): void => {
    const ids = selectedVideoIds.size > 0 ? [...selectedVideoIds] : [v.id];
    e.dataTransfer.setData('application/nndd-video-ids', JSON.stringify(ids));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleFolderDrop = async (e: React.DragEvent, targetFolder: string): Promise<void> => {
    e.preventDefault();
    setDragOverFolder(null);
    const raw = e.dataTransfer.getData('application/nndd-video-ids');
    if (!raw) return;
    const videoIds = JSON.parse(raw) as number[];
    setMoveError(null);
    setMoving(true);
    try {
      await window.nndd.invoke(IpcChannel.LIBRARY_VIDEO_MOVE, { videoIds, targetFolder });
      setSelectedVideoIds(new Set());
      reload();
    } catch (err) {
      setMoveError(err instanceof Error ? err.message : String(err));
    } finally {
      setMoving(false);
    }
  };

  const handlePlay = (v: NNDDREVideo): void => {
    const dir = v.uri.replace(/[/\\][^/\\]+$/, '');
    const folderPlaylist = sorted
      .filter((x) => x.uri.replace(/[/\\][^/\\]+$/, '') === dir)
      .map((x) => x.uri);
    window.nndd.invoke(window.nndd.channels.VIDEO_OPEN_PLAYER, {
      localPath: v.uri,
      videoId: extractVideoId(v.videoName) ?? undefined,
      folderPlaylist: folderPlaylist.length > 1 ? folderPlaylist : undefined
    });
  };

  const handleDelete = async (v: NNDDREVideo): Promise<void> => {
    const ok = confirm(
      `「${v.videoName}」を削除します。\n動画本体・サムネ・コメント・ThumbInfo.xml も削除されます。\nよろしいですか？`
    );
    if (!ok) return;
    await window.nndd.invoke(window.nndd.channels.LIBRARY_DELETE, v.id);
    setSelected(null);
    reload();
  };

  const handleToggleFavorite = async (v: NNDDREVideo): Promise<void> => {
    const next = !v.isFavorite;
    await window.nndd.invoke(window.nndd.channels.LIBRARY_SET_FAVORITE, v.id, next);
    setVideos((prev) => prev.map((x) => (x.id === v.id ? { ...x, isFavorite: next } : x)));
  };

  const handleVideoContextMenu = (e: React.MouseEvent, v: NNDDREVideo): void => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, video: v });
  };

  const handleOpenFolder = (v: NNDDREVideo): void => {
    const dir = v.uri.replace(/[/\\][^/\\]+$/, '');
    window.nndd.invoke(window.nndd.channels.SYS_OPEN_PATH, dir);
  };

  const handleOpenNiconico = (v: NNDDREVideo): void => {
    const m = v.videoName.match(/\[((?:sm|nm|so|ax|sd|ca|cd|cw|zb|ze|yo)\d+)\]/);
    const videoId = m ? m[1] : null;
    if (!videoId) return;
    window.nndd.invoke(window.nndd.channels.SYS_OPEN_PATH, watchUrl(videoId));
  };

  const handleScan = async (): Promise<void> => {
    setScanning(true);
    try {
      await window.nndd.invoke(window.nndd.channels.LIBRARY_SCAN);
      reload();
    } finally {
      setScanning(false);
    }
  };

  const handleFolderDelete = async (folderPath: string): Promise<void> => {
    const label = folderPath.split(/[/\\]/).pop() || folderPath;
    const ok = confirm(
      `フォルダ「${label}」を削除します。\n配下の動画ファイルもすべて削除されます。\nよろしいですか？`
    );
    if (!ok) return;
    await window.nndd.invoke(IpcChannel.LIBRARY_FOLDER_DELETE, folderPath);
    if (selectedFolder === folderPath) setSelectedFolder(null);
    reload();
  };

  /** 表示中の一覧を連続再生 (選択中の動画、なければクリック中の動画、なければ先頭から) */
  const handleContinuousPlay = (audioOnly: boolean): void => {
    if (sorted.length === 0) return;
    const paths = sorted.map((x) => x.uri);
    const startIdx = selectedVideoIds.size > 0
      ? sorted.findIndex((x) => selectedVideoIds.has(x.id))
      : selected !== null
      ? sorted.findIndex((x) => x.id === selected)
      : 0;
    const startVideo = sorted[startIdx >= 0 ? startIdx : 0];
    window.nndd.invoke(IpcChannel.VIDEO_OPEN_PLAYER, {
      localPath: startVideo.uri,
      videoId: extractVideoId(startVideo.videoName) ?? undefined,
      folderPlaylist: paths,
      audioOnly: audioOnly || undefined,
    });
  };

  const itemHandlers: LibraryItemHandlers = {
    onClick: handleVideoClick,
    onPlay: handlePlay,
    onDragStart: handleVideoDragStart,
    onContextMenu: handleVideoContextMenu,
    onToggleFavorite: handleToggleFavorite,
    onOpenFolder: handleOpenFolder,
    onOpenNiconico: handleOpenNiconico,
    onDelete: handleDelete
  };

  const isLanTab = selectedFolder === LAN_FOLDER;

  return (
    <div className="h-full flex">
      {/* 左ペイン: タグ / フォルダ */}
      <aside className="w-64 border-r border-nndd-border bg-nndd-panel flex flex-col">
        <div className="flex border-b border-nndd-border text-xs">
          <TabBtn active={mode === 'folder'} onClick={() => setMode('folder')}>フォルダ</TabBtn>
          <TabBtn active={mode === 'tag'} onClick={() => setMode('tag')}>タグ</TabBtn>
        </div>

        <div className="flex-1 overflow-auto p-2 text-sm">
          {mode === 'tag' && (
            <LibraryTagList tagStats={tagStats} selectedTag={selectedTag} onSelectTag={setSelectedTag} />
          )}

          {mode === 'folder' && (
            <LibraryFolderList
              totalCount={videos.length}
              selectedFolder={selectedFolder}
              onSelectFolder={setSelectedFolder}
              folderTree={folderTree}
              dragOverFolder={dragOverFolder}
              expandedFolders={expandedFolders}
              folderVideoCounts={folderVideoCounts}
              onToggleExpand={toggleFolderExpand}
              onDeleteFolder={(path) => void handleFolderDelete(path)}
              onDragOverFolder={handleFolderDragOver}
              onDragLeaveFolder={() => setDragOverFolder(null)}
              onDropFolder={handleFolderDrop}
              lanEnabled={lanEnabled}
              lanReachable={lan.lanReachable}
              lanLoading={lan.lanLoading}
              lanVideoCount={lan.lanVideos.length}
              onSelectLan={() => {
                setSelectedFolder(LAN_FOLDER);
                void lan.loadLan();
              }}
            />
          )}
        </div>

        {/* フォルダ追加エリア */}
        {mode === 'folder' && !isLanTab && (
          <FolderCreateArea
            folderCreateError={folderCreate.folderCreateError}
            showFolderInput={folderCreate.showFolderInput}
            setShowFolderInput={folderCreate.setShowFolderInput}
            newFolderName={folderCreate.newFolderName}
            setNewFolderName={folderCreate.setNewFolderName}
            onCreate={folderCreate.handleFolderCreate}
          />
        )}
      </aside>

      {/* 右ペイン */}
      <main className="flex-1 flex flex-col">
        {isLanTab ? (
          /* LANライブラリペイン */
          <LanLibraryPane
            lanSearchText={lan.lanSearchText}
            onLanSearchTextChange={lan.setLanSearchText}
            lanReachable={lan.lanReachable}
            lanLoading={lan.lanLoading}
            lanVideos={lan.lanVideos}
            playingLanId={lan.playingLanId}
            onReload={lan.loadLan}
            onPlay={lan.handleLanPlay}
          />
        ) : (
          /* ローカルライブラリペイン */
          <>
            <LibraryToolbar
              searchText={searchText}
              onSearchTextChange={setSearchText}
              favoriteOnly={favoriteOnly}
              onToggleFavoriteOnly={() => setFavoriteOnly((v) => !v)}
              filteredCount={filtered.length}
              moving={moving}
              selectedCount={selectedVideoIds.size}
              moveError={moveError}
              displayMode={displayMode}
              onToggleDisplayMode={() => setDisplayMode(displayMode === 'table' ? 'grid' : 'table')}
              continuousPlayDisabled={sorted.length === 0}
              onContinuousPlay={handleContinuousPlay}
              scanning={scanning}
              onScan={handleScan}
            />
            <div className="flex-1 overflow-auto">
              {loading ? (
                <div className="p-4 text-nndd-subtext">読み込み中…</div>
              ) : filtered.length === 0 ? (
                <div className="p-4 text-nndd-subtext">
                  {videos.length === 0
                    ? 'ライブラリは空です。動画をダウンロードするとここに表示されます。'
                    : '該当する動画はありません。'}
                </div>
              ) : displayMode === 'grid' ? (
                <LibraryGridView
                  videos={sorted}
                  selected={selected}
                  selectedVideoIds={selectedVideoIds}
                  {...itemHandlers}
                />
              ) : (
                <LibraryTableView
                  videos={sorted}
                  selected={selected}
                  selectedVideoIds={selectedVideoIds}
                  onSort={handleSort}
                  sortIndicator={sortIndicator}
                  {...itemHandlers}
                />
              )}
            </div>
          </>
        )}
      </main>
      {ctxMenu && (
        <ContextMenuPopup
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
        >
          <MenuItem onClick={() => { void handleToggleFavorite(ctxMenu.video); setCtxMenu(null); }}>
            {ctxMenu.video.isFavorite ? '☆ お気に入りから外す' : '★ お気に入りに追加'}
          </MenuItem>
        </ContextMenuPopup>
      )}
    </div>
  );
}
