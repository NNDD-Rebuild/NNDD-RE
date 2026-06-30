import { useEffect, useMemo, useRef, useState } from 'react';
import type { NNDDREVideo } from '@shared/types';
import { IpcChannel } from '@shared/types';
import { ContinuousPlayButton } from '../common/ContinuousPlayButton';
import { useAppStore } from '@renderer/store/useAppStore';

type ViewMode = 'tag' | 'folder';
type LibraryDisplayMode = 'table' | 'grid';
type SortCol = 'videoName' | 'time' | 'playCount' | 'pubDate' | 'creationDate';
type SortDir = 'asc' | 'desc';

interface LanVideo {
  videoId: string;
  filename: string;
  isEconomy: boolean;
}

const LAN_FOLDER = '__lan__';

export function LibraryView(): JSX.Element {
  const [videos, setVideos] = useState<NNDDREVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [mode, setMode] = useState<ViewMode>('folder');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [searchText, setSearchText] = useState('');
  const globalLibraryMode = useAppStore((s) => s.libraryViewMode);
  const [displayMode, setDisplayMode] = useState<LibraryDisplayMode>(globalLibraryMode);
  const [sortCol, setSortCol] = useState<SortCol>('pubDate');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  // LAN
  const [lanEnabled, setLanEnabled] = useState(false);
  const [lanVideos, setLanVideos] = useState<LanVideo[]>([]);
  const [lanReachable, setLanReachable] = useState<boolean | null>(null);
  const [lanLoading, setLanLoading] = useState(false);
  const [playingLanId, setPlayingLanId] = useState<string | null>(null);
  const [lanSearchText, setLanSearchText] = useState('');

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

  const [showFolderInput, setShowFolderInput] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [folderCreateError, setFolderCreateError] = useState<string | null>(null);
  const [fsFolders, setFsFolders] = useState<string[]>([]);

  const [selectedVideoIds, setSelectedVideoIds] = useState<Set<number>>(new Set());
  const lastClickedIdRef = useRef<number | null>(null);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);

  const reload = (): void => {
    setLoading(true);
    Promise.all([
      window.nndd.invoke<NNDDREVideo[]>(window.nndd.channels.LIBRARY_LIST),
      window.nndd.invoke<string[]>(window.nndd.channels.LIBRARY_FOLDER_LIST)
    ])
      .then(([rows, dirs]) => {
        const fixed = rows.map((v) => ({
          ...v,
          modificationDate: new Date(v.modificationDate),
          creationDate: new Date(v.creationDate),
          lastPlayDate: v.lastPlayDate ? new Date(v.lastPlayDate) : null,
          pubDate: v.pubDate ? new Date(v.pubDate) : null
        }));
        setVideos(fixed);
        setFsFolders(dirs);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(reload, []);

  useEffect(() => {
    const off = window.nndd.on(
      window.nndd.channels.DOWNLOAD_PROGRESS_EVENT,
      (...args: unknown[]) => {
        const item = args[0] as { status?: string } | null;
        if (item?.status === 'success') reload();
      }
    );
    return off;
  }, []);

  const loadLan = async (): Promise<void> => {
    setLanLoading(true);
    try {
      const status = await window.nndd.invoke<{ reachable: boolean }>(window.nndd.channels.LAN_STATUS);
      setLanReachable(status.reachable);
      if (status.reachable) {
        const list = await window.nndd.invoke<LanVideo[]>(window.nndd.channels.LAN_LIBRARY_LIST);
        setLanVideos(list);
      } else {
        setLanVideos([]);
      }
    } catch {
      setLanReachable(false);
      setLanVideos([]);
    } finally {
      setLanLoading(false);
    }
  };

  const handleLanPlay = async (videoId: string): Promise<void> => {
    setPlayingLanId(videoId);
    try {
      const detail = await window.nndd.invoke<{
        videoId: string;
        videoUrl: string;
        extension: string;
        filename: string;
      } | null>(window.nndd.channels.LAN_VIDEO_STREAM, videoId);
      if (!detail) {
        alert('動画情報の取得に失敗しました');
        return;
      }
      await window.nndd.invoke(window.nndd.channels.VIDEO_OPEN_PLAYER, {
        streamUrl: detail.videoUrl
      });
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setPlayingLanId(null);
    }
  };

  const tagStats = useMemo(() => {
    const map = new Map<string, number>();
    for (const v of videos) {
      for (const t of v.tagStrings) {
        map.set(t, (map.get(t) ?? 0) + 1);
      }
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [videos]);

  const folders = useMemo(() => {
    const set = new Set<string>();
    for (const v of videos) {
      const d = v.uri.replace(/[/\\][^/\\]+$/, '');
      set.add(d);
    }
    for (const d of fsFolders) {
      set.add(d);
    }
    return [...set].sort();
  }, [videos, fsFolders]);

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
      if (searchText.trim()) {
        const q = searchText.toLowerCase();
        if (!v.videoName.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [videos, mode, selectedTag, selectedFolder, searchText]);

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

  const handleOpenFolder = (v: NNDDREVideo): void => {
    const dir = v.uri.replace(/[/\\][^/\\]+$/, '');
    window.nndd.invoke(window.nndd.channels.SYS_OPEN_PATH, dir);
  };

  const handleOpenNiconico = (v: NNDDREVideo): void => {
    const m = v.videoName.match(/\[((?:sm|nm|so|ax|sd|ca|cd|cw|zb|ze|yo)\d+)\]/);
    const videoId = m ? m[1] : null;
    if (!videoId) return;
    window.nndd.invoke(window.nndd.channels.SYS_OPEN_PATH, `https://www.nicovideo.jp/watch/${videoId}`);
  };

  const extractVideoId = (videoName: string): string | null => {
    const m = videoName.match(/\[((?:sm|nm|so|ax|sd|ca|cd|cw|zb|ze|yo)\d+)\]/);
    return m ? m[1] : null;
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

  const handleFolderCreate = async (): Promise<void> => {
    const name = newFolderName.trim();
    if (!name) return;
    setFolderCreateError(null);
    try {
      await window.nndd.invoke(IpcChannel.LIBRARY_FOLDER_CREATE, name);
      setNewFolderName('');
      setShowFolderInput(false);
      reload();
    } catch (e) {
      setFolderCreateError(e instanceof Error ? e.message : String(e));
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

  const thumbPrimaryUrl = (v: NNDDREVideo): string => {
    const base = v.uri.replace(/\.[^.]+$/, '');
    return `nndd-re-local://video?path=${encodeURIComponent(base + '[ThumbImg].jpeg')}`;
  };
  const thumbFallbackUrl = (v: NNDDREVideo): string => {
    const base = v.uri.replace(/\.[^.]+$/, '');
    return `nndd-re-local://video?path=${encodeURIComponent(base + '.jpg')}`;
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
            <>
              {tagStats.length === 0 && (
                <div className="text-xs text-nndd-subtext">タグなし</div>
              )}
              {tagStats.map(([t, n]) => (
                <button
                  key={t}
                  onClick={() => setSelectedTag(t)}
                  className={[
                    'block w-full text-left px-2 py-0.5 rounded text-xs',
                    selectedTag === t
                      ? 'bg-nndd-accent text-white'
                      : 'hover:bg-nndd-border'
                  ].join(' ')}
                >
                  {t}{' '}
                  <span className="text-nndd-subtext text-[10px]">({n})</span>
                </button>
              ))}
            </>
          )}

          {mode === 'folder' && (
            <>
              {/* すべて */}
              <button
                onClick={() => setSelectedFolder(null)}
                className={[
                  'block w-full text-left px-2 py-0.5 rounded text-xs mb-1',
                  selectedFolder === null
                    ? 'bg-nndd-accent text-white'
                    : 'hover:bg-nndd-border'
                ].join(' ')}
              >
                すべて <span className="text-[10px] opacity-70">({videos.length})</span>
              </button>

              {folders.length === 0 && (
                <div className="text-xs text-nndd-subtext">フォルダなし</div>
              )}
              {folders.map((f) => {
                const count = videos.filter((v) => v.uri.replace(/[/\\][^/\\]+$/, '') === f).length;
                return (
                  <div
                    key={f}
                    className={[
                      'flex items-center gap-1 rounded text-xs group',
                      selectedFolder === f
                        ? 'bg-nndd-accent text-white'
                        : dragOverFolder === f
                        ? 'bg-nndd-accent/50 ring-1 ring-nndd-accent'
                        : 'hover:bg-nndd-border'
                    ].join(' ')}
                    onDragOver={(e) => {
                      if (e.dataTransfer.types.includes('application/nndd-video-ids')) {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        setDragOverFolder(f);
                      }
                    }}
                    onDragLeave={() => setDragOverFolder(null)}
                    onDrop={(e) => void handleFolderDrop(e, f)}
                  >
                    <button
                      onClick={() => setSelectedFolder(f)}
                      className="flex-1 text-left px-2 py-0.5 truncate"
                      title={f}
                    >
                      {f.split(/[/\\]/).pop() || f}{' '}
                      <span className="text-[10px] opacity-70">({count})</span>
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); void handleFolderDelete(f); }}
                      className="shrink-0 px-1 py-0.5 opacity-0 group-hover:opacity-100 hover:text-red-500 dark:hover:text-red-400 transition-opacity"
                      title="フォルダ削除"
                    >
                      🗑
                    </button>
                  </div>
                );
              })}

              {/* LANライブラリ */}
              {lanEnabled && (
                <div className="mt-2 pt-2 border-t border-nndd-border">
                  <button
                    onClick={() => {
                      setSelectedFolder(LAN_FOLDER);
                      void loadLan();
                    }}
                    className={[
                      'flex items-center gap-1 w-full text-left px-2 py-0.5 rounded text-xs',
                      isLanTab
                        ? 'bg-nndd-accent text-white'
                        : 'hover:bg-nndd-border'
                    ].join(' ')}
                  >
                    <span>LANライブラリ</span>
                    {lanReachable === true && (
                      <span className={isLanTab ? 'text-green-200' : 'text-green-400'}>●</span>
                    )}
                    {lanReachable === false && (
                      <span className={isLanTab ? 'text-red-200' : 'text-red-400'}>●</span>
                    )}
                    {isLanTab && !lanLoading && (
                      <span className="text-[10px] opacity-70">({lanVideos.length})</span>
                    )}
                    {lanLoading && <span className="text-[10px] opacity-70">…</span>}
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* フォルダ追加エリア */}
        {mode === 'folder' && !isLanTab && (
          <div className="shrink-0 border-t border-nndd-border p-2">
            {folderCreateError && (
              <div className="text-xs text-red-500 dark:text-red-400 mb-1 break-all" title={folderCreateError}>
                ⚠ {folderCreateError}
              </div>
            )}
            {showFolderInput ? (
              <div className="flex gap-1">
                <input
                  autoFocus
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleFolderCreate();
                    if (e.key === 'Escape') { setShowFolderInput(false); setNewFolderName(''); }
                  }}
                  placeholder="フォルダ名"
                  className="flex-1 bg-nndd-bg border border-nndd-border px-1 py-0.5 text-xs"
                />
                <button
                  onClick={() => void handleFolderCreate()}
                  disabled={!newFolderName.trim()}
                  className="text-xs px-2 py-0.5 bg-nndd-accent text-white rounded disabled:opacity-50"
                >
                  作成
                </button>
                <button
                  onClick={() => { setShowFolderInput(false); setNewFolderName(''); }}
                  className="text-xs px-1 py-0.5 bg-nndd-border rounded"
                >
                  ×
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowFolderInput(true)}
                className="w-full text-xs px-2 py-1 bg-nndd-border rounded hover:bg-nndd-accent/70 text-left"
              >
                + フォルダ追加
              </button>
            )}
          </div>
        )}
      </aside>

      {/* 右ペイン */}
      <main className="flex-1 flex flex-col">
        {isLanTab ? (
          /* LANライブラリペイン */
          <>
            <div className="flex items-center gap-2 p-2 border-b border-nndd-border bg-nndd-panel">
              <input
                value={lanSearchText}
                onChange={(e) => setLanSearchText(e.target.value)}
                placeholder="タイトルで絞り込み"
                className="flex-1 bg-nndd-bg border border-nndd-border px-2 py-1 text-sm"
              />
              {lanReachable === true && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-green-600/20 text-green-400">接続中</span>
              )}
              {lanReachable === false && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-red-600/20 text-red-400">接続失敗</span>
              )}
              <button
                onClick={() => void loadLan()}
                disabled={lanLoading}
                className="text-xs px-3 py-1 bg-nndd-accent text-white rounded hover:opacity-80 disabled:opacity-50"
              >
                {lanLoading ? '読込中…' : '更新'}
              </button>
            </div>
            <div className="flex-1 overflow-auto">
              {lanLoading ? (
                <div className="p-4 text-nndd-subtext">読み込み中…</div>
              ) : lanReachable === false ? (
                <div className="p-4 text-nndd-subtext">接続できませんでした</div>
              ) : lanVideos.length === 0 ? (
                <div className="p-4 text-nndd-subtext">動画がありません</div>
              ) : (() => {
                const q = lanSearchText.trim().toLowerCase();
                const filtered = q
                  ? lanVideos.filter((v) => v.filename.toLowerCase().includes(q) || v.videoId.toLowerCase().includes(q))
                  : lanVideos;
                return filtered.length === 0 ? (
                  <div className="p-4 text-nndd-subtext">該当する動画はありません</div>
                ) : (
                  <table className="nndd-datagrid">
                    <thead>
                      <tr>
                        <th className="w-28">動画ID</th>
                        <th>タイトル</th>
                        <th className="w-24">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((v) => (
                        <tr key={v.videoId}>
                          <td className="text-xs text-nndd-subtext">{v.videoId}</td>
                          <td>
                            <span className="inline-block text-[10px] px-1 py-0.5 rounded bg-blue-600/20 text-blue-400 mr-1.5 align-middle">LAN</span>
                            {v.filename || v.videoId}
                          </td>
                          <td>
                            <button
                              onClick={() => void handleLanPlay(v.videoId)}
                              disabled={playingLanId === v.videoId}
                              className="text-xs px-2 py-0.5 bg-nndd-accent text-white rounded disabled:opacity-50"
                            >
                              {playingLanId === v.videoId ? '…' : '再生'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                );
              })()}
            </div>
          </>
        ) : (
          /* ローカルライブラリペイン */
          <>
            <div className="flex items-center gap-2 p-2 border-b border-nndd-border bg-nndd-panel">
              <input
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="タイトルで絞り込み"
                className="flex-1 bg-nndd-bg border border-nndd-border px-2 py-1 text-sm"
              />
              <span className="text-xs text-nndd-subtext">{filtered.length} 件</span>
              {moving && (
                <span className="text-xs text-nndd-accent animate-pulse">移動中…</span>
              )}
              {!moving && selectedVideoIds.size > 0 && (
                <span className="text-xs text-nndd-accent font-bold">
                  {selectedVideoIds.size} 件選択中 (フォルダへドロップで移動)
                </span>
              )}
              {moveError && (
                <span className="text-xs text-red-500 dark:text-red-400 truncate max-w-xs" title={moveError}>
                  ⚠ {moveError}
                </span>
              )}
              <button
                onClick={() => setDisplayMode(displayMode === 'table' ? 'grid' : 'table')}
                title={displayMode === 'table' ? 'グリッド表示に切り替え' : 'リスト表示に切り替え'}
                className="text-xs px-2 py-1 bg-nndd-border rounded hover:opacity-80"
              >
                {displayMode === 'table' ? '⊞' : '☰'}
              </button>
              <ContinuousPlayButton
                disabled={sorted.length === 0}
                onPlay={(audioOnly) => {
                  if (sorted.length === 0) return;
                  const paths = sorted.map((x) => x.uri);
                  const startIdx = selectedVideoIds.size > 0
                    ? sorted.findIndex((x) => selectedVideoIds.has(x.id))
                    : selected !== null
                    ? sorted.findIndex((x) => x.id === selected)
                    : 0;
                  window.nndd.invoke(IpcChannel.VIDEO_OPEN_PLAYER, {
                    localPath: sorted[startIdx >= 0 ? startIdx : 0].uri,
                    folderPlaylist: paths,
                    audioOnly: audioOnly || undefined,
                  });
                }}
              />
              <button
                onClick={handleScan}
                disabled={scanning}
                className="text-xs px-3 py-1 bg-nndd-accent text-white rounded hover:opacity-80 disabled:opacity-50"
              >
                {scanning ? 'スキャン中…' : 'ライブラリを更新'}
              </button>
            </div>
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
                <div className="p-3 grid grid-cols-6 gap-3">
                  {sorted.map((v) => (
                    <div
                      key={v.id}
                      draggable
                      className={[
                        'flex flex-col cursor-pointer rounded overflow-hidden border',
                        selectedVideoIds.has(v.id)
                          ? 'border-nndd-accent ring-2 ring-nndd-accent'
                          : selected === v.id
                          ? 'border-nndd-accent'
                          : 'border-nndd-border hover:border-nndd-accent'
                      ].join(' ')}
                      onClick={(e) => handleVideoClick(v, e)}
                      onDoubleClick={() => handlePlay(v)}
                      onDragStart={(e) => handleVideoDragStart(e, v)}
                    >
                      <div className="relative bg-black aspect-video overflow-hidden w-full">
                        <img
                          src={thumbPrimaryUrl(v)}
                          alt=""
                          className="absolute inset-0 w-full h-full object-cover"
                          onError={(e) => {
                            const fb = thumbFallbackUrl(v);
                            if (e.currentTarget.src !== fb) e.currentTarget.src = fb;
                            else e.currentTarget.style.display = 'none';
                          }}
                        />
                        {v.time > 0 && (
                          <span className="absolute bottom-1 right-1 bg-black/70 text-white text-[10px] px-1 rounded">
                            {formatDuration(v.time)}
                          </span>
                        )}
                      </div>
                      <div className="p-1.5 bg-nndd-panel flex-1 flex flex-col gap-0.5">
                        <div className="text-xs line-clamp-2 leading-tight" title={v.videoName}>
                          {v.videoName}
                        </div>
                        <div className="text-[10px] text-nndd-subtext mt-auto">
                          {v.pubDate ? v.pubDate.toLocaleDateString('ja-JP') : '-'}
                        </div>
                        <div className="flex gap-1 mt-1 flex-wrap">
                          <button onClick={(e) => { e.stopPropagation(); handlePlay(v); }} className="text-xs px-2 py-0.5 bg-nndd-accent text-white rounded">再生</button>
                          <button onClick={(e) => { e.stopPropagation(); handleOpenFolder(v); }} className="text-xs px-2 py-0.5 bg-nndd-border rounded">フォルダ</button>
                          {extractVideoId(v.videoName) && (
                            <button onClick={(e) => { e.stopPropagation(); handleOpenNiconico(v); }} className="text-xs px-2 py-0.5 bg-nndd-border rounded" title="ニコニコ動画で開く">nico</button>
                          )}
                          <button onClick={(e) => { e.stopPropagation(); void handleDelete(v); }} className="text-xs px-2 py-0.5 bg-nndd-border hover:bg-red-700 hover:text-white rounded">削除</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <table className="nndd-datagrid">
                  <thead>
                    <tr>
                      <th className="w-10"></th>
                      <th className="cursor-pointer select-none hover:opacity-70" onClick={() => handleSort('videoName')}>タイトル{sortIndicator('videoName')}</th>
                      <th className="w-24 cursor-pointer select-none hover:opacity-70" onClick={() => handleSort('time')}>時間{sortIndicator('time')}</th>
                      <th className="w-20 cursor-pointer select-none hover:opacity-70" onClick={() => handleSort('playCount')}>再生数{sortIndicator('playCount')}</th>
                      <th className="w-32 cursor-pointer select-none hover:opacity-70" onClick={() => handleSort('pubDate')}>投稿日{sortIndicator('pubDate')}</th>
                      <th className="w-52">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((v) => (
                      <tr
                        key={v.id}
                        draggable
                        className={[
                          selectedVideoIds.has(v.id) ? 'selected ring-1 ring-nndd-accent' : selected === v.id ? 'selected' : ''
                        ].join(' ')}
                        onClick={(e) => handleVideoClick(v, e)}
                        onDoubleClick={() => handlePlay(v)}
                        onDragStart={(e) => handleVideoDragStart(e, v)}
                      >
                        <td className="p-0.5">
                          <img
                            src={thumbPrimaryUrl(v)}
                            alt=""
                            className="w-9 aspect-video object-cover rounded-sm"
                            onError={(e) => {
                              const fb = thumbFallbackUrl(v);
                              if (e.currentTarget.src !== fb) e.currentTarget.src = fb;
                              else e.currentTarget.style.display = 'none';
                            }}
                          />
                        </td>
                        <td title={v.videoName}>{v.videoName}</td>
                        <td>{formatDuration(v.time)}</td>
                        <td>{v.playCount}</td>
                        <td>{v.pubDate ? v.pubDate.toLocaleDateString('ja-JP') : '-'}</td>
                        <td>
                          <button onClick={(e) => { e.stopPropagation(); handlePlay(v); }} className="text-xs px-2 py-0.5 bg-nndd-accent text-white rounded mr-1">再生</button>
                          <button onClick={(e) => { e.stopPropagation(); handleOpenFolder(v); }} className="text-xs px-2 py-0.5 bg-nndd-border rounded mr-1">フォルダ</button>
                          {extractVideoId(v.videoName) && (
                            <button onClick={(e) => { e.stopPropagation(); handleOpenNiconico(v); }} className="text-xs px-2 py-0.5 bg-nndd-border rounded mr-1" title="ニコニコ動画で開く">nico</button>
                          )}
                          <button onClick={(e) => { e.stopPropagation(); void handleDelete(v); }} className="text-xs px-2 py-0.5 bg-nndd-border hover:bg-red-700 hover:text-white rounded">削除</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={[
        'flex-1 px-2 py-1 text-xs',
        active
          ? 'bg-nndd-bg text-nndd-text border-b-2 border-b-nndd-accent'
          : 'text-nndd-subtext hover:bg-nndd-border hover:text-nndd-text'
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function formatDuration(sec: number): string {
  if (!sec || sec <= 0) return '-';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}
