import { useState } from 'react';
import type { Playlist } from '@shared/types';
import { IpcChannel } from '@shared/types';
import type { VideoCardData } from './VideoCard';

interface Props {
  data: VideoCardData;
}

/**
 * VideoCard の右クリックメニューに常時挿入される「プレイリストに追加」項目。
 * クリックでサブポップオーバーを開き、複数プレイリストへのトグル追加・新規作成ができる。
 */
export function AddToPlaylistMenuItem({ data }: Props): JSX.Element {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [containing, setContaining] = useState<Set<number>>(new Set());
  const [newName, setNewName] = useState('');

  const loadState = async (): Promise<void> => {
    setLoading(true);
    try {
      const [list, ids] = await Promise.all([
        window.nndd.invoke<Playlist[]>(IpcChannel.PLAYLIST_LIST),
        window.nndd.invoke<number[]>(IpcChannel.PLAYLIST_LIST_CONTAINING, data.videoId)
      ]);
      setPlaylists(list);
      setContaining(new Set(ids));
    } finally {
      setLoading(false);
    }
  };

  const handleToggleOpen = (): void => {
    setOpen((prev) => {
      const next = !prev;
      if (next) loadState().catch(console.error);
      return next;
    });
  };

  const toggleVideo = async (playlistId: number): Promise<void> => {
    if (containing.has(playlistId)) {
      await window.nndd.invoke(IpcChannel.PLAYLIST_REMOVE_VIDEO, { playlistId, videoId: data.videoId });
      setContaining((prev) => {
        const next = new Set(prev);
        next.delete(playlistId);
        return next;
      });
    } else {
      await window.nndd.invoke(IpcChannel.PLAYLIST_ADD_VIDEO, {
        playlistId,
        videoId: data.videoId,
        title: data.title,
        thumbnailUrl: data.thumbnailUrl,
        lengthSec: typeof data.length === 'number' ? data.length : 0
      });
      setContaining((prev) => new Set(prev).add(playlistId));
    }
  };

  const createAndAdd = async (): Promise<void> => {
    const name = newName.trim();
    if (!name) return;
    const created = await window.nndd.invoke<Playlist>(IpcChannel.PLAYLIST_CREATE, name);
    setPlaylists((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name, 'ja')));
    setNewName('');
    await toggleVideo(created.id);
  };

  return (
    <div className="relative">
      <button
        onClick={handleToggleOpen}
        className="w-full px-3 py-1.5 text-left hover:bg-nndd-border whitespace-nowrap flex items-center justify-between gap-2"
      >
        <span>📑 プレイリストに追加</span>
        <span>▸</span>
      </button>
      {open && (
        <div
          className="absolute left-full top-0 bg-nndd-panel border border-nndd-border rounded shadow-lg py-1 text-xs min-w-[180px] max-h-64 overflow-y-auto z-[10000]"
          onClick={(e) => e.stopPropagation()}
        >
          {loading && <div className="px-3 py-1.5 text-nndd-subtext">読み込み中...</div>}
          {!loading && playlists.length === 0 && (
            <div className="px-3 py-1.5 text-nndd-subtext">プレイリストがありません</div>
          )}
          {!loading &&
            playlists.map((p) => (
              <label
                key={p.id}
                className="flex items-center gap-2 px-3 py-1.5 hover:bg-nndd-border cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={containing.has(p.id)}
                  onChange={() => {
                    toggleVideo(p.id).catch(console.error);
                  }}
                />
                <span className="truncate">{p.name}</span>
              </label>
            ))}
          <div className="border-t border-nndd-border mt-1 pt-1 px-2 flex gap-1">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') createAndAdd().catch(console.error);
              }}
              placeholder="新規作成"
              className="flex-1 min-w-0 bg-nndd-bg border border-nndd-border rounded px-1.5 py-0.5"
            />
            <button
              onClick={() => createAndAdd().catch(console.error)}
              className="px-1.5 bg-nndd-accent text-white rounded"
            >
              ＋
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
