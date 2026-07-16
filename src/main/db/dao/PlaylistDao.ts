import type { Playlist, PlaylistItem } from '@shared/types';
import { NnddDatabase } from '../Database';
import { Q } from '../schema';

interface PlaylistRow {
  id: number;
  name: string;
  createdAt: number | null;
  updatedAt: number | null;
}

interface PlaylistItemRow {
  id: number;
  playlist_id: number;
  videoId: string;
  title: string | null;
  thumbnailUrl: string | null;
  lengthSec: number | null;
  sortOrder: number;
  addedAt: number | null;
}

/**
 * 自作プレイリスト DAO (ローカル完結、サーバー同期なし)
 */
export class PlaylistDao {
  constructor(private readonly db: NnddDatabase) {}

  list(): Playlist[] {
    const rows = this.db.prepare(Q.SELECT_PLAYLISTS).all() as PlaylistRow[];
    return rows.map((r) => this.rowToPlaylist(r));
  }

  create(name: string): Playlist {
    const now = Date.now() / 1000;
    const info = this.db.prepare(Q.INSERT_PLAYLIST).run(name, now, now);
    return { id: Number(info.lastInsertRowid), name, createdAt: new Date(now * 1000), updatedAt: new Date(now * 1000) };
  }

  rename(id: number, name: string): void {
    this.db.prepare(Q.UPDATE_PLAYLIST_NAME).run(name, Date.now() / 1000, id);
  }

  remove(id: number): void {
    this.db.transaction(() => {
      this.db.prepare(Q.DELETE_PLAYLIST_ITEMS).run(id);
      this.db.prepare(Q.DELETE_PLAYLIST).run(id);
    });
  }

  getItems(playlistId: number): PlaylistItem[] {
    const rows = this.db.prepare(Q.SELECT_PLAYLIST_ITEMS).all(playlistId) as PlaylistItemRow[];
    return rows.map((r) => this.rowToItem(r));
  }

  addVideo(
    playlistId: number,
    item: { videoId: string; title: string; thumbnailUrl: string; lengthSec: number }
  ): void {
    const row = this.db.prepare(Q.SELECT_PLAYLIST_ITEM_MAX_ORDER).get(playlistId) as
      | { maxOrder: number | null }
      | undefined;
    const nextOrder = (row?.maxOrder ?? -1) + 1;
    this.db
      .prepare(Q.INSERT_PLAYLIST_ITEM)
      .run(playlistId, item.videoId, item.title, item.thumbnailUrl, item.lengthSec, nextOrder, Date.now() / 1000);
  }

  removeVideo(playlistId: number, videoId: string): void {
    this.db.prepare(Q.DELETE_PLAYLIST_ITEM).run(playlistId, videoId);
  }

  /** 並び替え: 渡された順序で sortOrder を全置換 (VideoDao.setTags と同じ全置換パターン) */
  reorder(playlistId: number, videoIds: string[]): void {
    this.db.transaction(() => {
      const stmt = this.db.prepare(Q.UPDATE_PLAYLIST_ITEM_ORDER);
      videoIds.forEach((videoId, idx) => stmt.run(idx, playlistId, videoId));
    });
  }

  /** VideoCard右クリックメニューで「追加済み」チェック表示に使う */
  listPlaylistIdsForVideo(videoId: string): number[] {
    const rows = this.db.prepare(Q.SELECT_PLAYLISTS_CONTAINING_VIDEO).all(videoId) as {
      playlist_id: number;
    }[];
    return rows.map((r) => r.playlist_id);
  }

  /** 全プレイリスト・全アイテムを削除 */
  clearAll(): void {
    this.db.prepare(Q.DELETE_ALL_PLAYLIST_ITEM).run();
    this.db.prepare(Q.DELETE_ALL_PLAYLIST).run();
  }

  private rowToPlaylist(r: PlaylistRow): Playlist {
    return {
      id: r.id,
      name: r.name,
      createdAt: new Date((r.createdAt ?? 0) * 1000),
      updatedAt: new Date((r.updatedAt ?? 0) * 1000)
    };
  }

  private rowToItem(r: PlaylistItemRow): PlaylistItem {
    return {
      videoId: r.videoId,
      title: r.title ?? '',
      thumbnailUrl: r.thumbnailUrl ?? '',
      lengthSec: r.lengthSec ?? 0,
      sortOrder: r.sortOrder,
      addedAt: new Date((r.addedAt ?? 0) * 1000)
    };
  }
}
