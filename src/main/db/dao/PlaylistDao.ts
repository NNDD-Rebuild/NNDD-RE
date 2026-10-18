import type { Playlist, PlaylistItem } from '@shared/types';
import { NnddDatabase } from '../Database';
import { Q } from '../schema';

interface PlaylistRow {
  id: number;
  name: string;
  createdAt: number | null;
  updatedAt: number | null;
  icon: string | null;
  serverMylistId: string | null;
  syncKey: string | null;
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
 * 自作プレイリスト DAO (ローカル。serverMylistId があればニコニコ側のマイリストと同期)
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

  updateIcon(id: number, icon: string | null): void {
    this.db.prepare(Q.UPDATE_PLAYLIST_ICON).run(icon, id);
  }

  /** 削除。同期しているニコニコ側のマイリストは消さない (取り消せない操作なので別途明示的に行う) */
  remove(id: number): void {
    this.db.transaction(() => {
      // 同期していたプレイリストの登録キーは「取り込み除外」にする (ニコニコ側に残ったマイリストから復活させない)
      const key = this.getSyncKey(id);
      if (key) this.dismissKey(key);
      this.db.prepare(Q.DELETE_PLAYLIST_ITEMS).run(id);
      this.db.prepare(Q.DELETE_PLAYLIST_SYNC_BASE).run(id);
      this.db.prepare(Q.DELETE_PLAYLIST).run(id);
    });
  }

  /** 同期先のニコニコ側マイリストと登録キーを結びつける。基準は作り直すので消す */
  linkServer(id: number, mylistId: string, syncKey: string): void {
    this.db.transaction(() => {
      this.db.prepare('UPDATE playlist SET serverMylistId = ?, syncKey = ? WHERE id = ?').run(mylistId, syncKey, id);
      this.db.prepare(Q.DELETE_PLAYLIST_SYNC_BASE).run(id);
    });
  }

  /** 同期を解除する。登録キーは「取り込み除外」にして、ニコニコ側に残るマイリストから復活させない */
  unlink(id: number): void {
    this.db.transaction(() => {
      const key = this.getSyncKey(id);
      if (key) this.dismissKey(key);
      this.db.prepare('UPDATE playlist SET serverMylistId = NULL, syncKey = NULL WHERE id = ?').run(id);
      this.db.prepare(Q.DELETE_PLAYLIST_SYNC_BASE).run(id);
    });
  }

  getSyncKey(id: number): string | null {
    const row = this.db.prepare('SELECT syncKey FROM playlist WHERE id = ?').get(id) as
      | { syncKey: string | null }
      | undefined;
    return row?.syncKey ?? null;
  }

  /** 登録キーだけ設定する (キー導入前に同期したプレイリストへの後付け) */
  setSyncKey(id: number, syncKey: string): void {
    this.db.prepare('UPDATE playlist SET syncKey = ? WHERE id = ?').run(syncKey, id);
  }

  /** ローカルのプレイリストが持つ登録キー一覧 */
  listSyncKeys(): string[] {
    const rows = this.db.prepare('SELECT syncKey FROM playlist WHERE syncKey IS NOT NULL').all() as {
      syncKey: string;
    }[];
    return rows.map((r) => r.syncKey);
  }

  dismissKey(syncKey: string): void {
    this.db.prepare('INSERT OR IGNORE INTO playlist_sync_dismissed (syncKey) VALUES (?)').run(syncKey);
  }

  listDismissedKeys(): string[] {
    const rows = this.db.prepare('SELECT syncKey FROM playlist_sync_dismissed').all() as { syncKey: string }[];
    return rows.map((r) => r.syncKey);
  }

  /** 別の PC で作られたニコニコ側マイリストを、プレイリストとして取り込む (動画は別途マージで取り込む) */
  createLinked(name: string, mylistId: string, syncKey: string): Playlist {
    const now = Date.now() / 1000;
    const info = this.db
      .prepare('INSERT INTO playlist (name, createdAt, updatedAt, serverMylistId, syncKey) VALUES (?, ?, ?, ?, ?)')
      .run(name, now, now, mylistId, syncKey);
    return {
      id: Number(info.lastInsertRowid),
      name,
      createdAt: new Date(now * 1000),
      updatedAt: new Date(now * 1000),
      serverMylistId: mylistId,
      syncKey
    };
  }

  getServerMylistId(id: number): string | null {
    const row = this.db.prepare('SELECT serverMylistId FROM playlist WHERE id = ?').get(id) as
      | { serverMylistId: string | null }
      | undefined;
    return row?.serverMylistId ?? null;
  }

  /** 前回同期した時点の動画ID一覧。未同期なら空 */
  getSyncBase(id: number): string[] {
    const rows = this.db.prepare(Q.SELECT_PLAYLIST_SYNC_BASE).all(id) as { videoId: string }[];
    return rows.map((r) => r.videoId);
  }

  setSyncBase(id: number, videoIds: string[]): void {
    this.db.transaction(() => {
      this.db.prepare(Q.DELETE_PLAYLIST_SYNC_BASE).run(id);
      const insert = this.db.prepare(Q.INSERT_PLAYLIST_SYNC_BASE);
      for (const videoId of videoIds) insert.run(id, videoId);
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
    this.db.prepare('DELETE FROM playlist_sync_dismissed').run();
    this.db.prepare(Q.DELETE_ALL_PLAYLIST_SYNC_BASE).run();
    this.db.prepare(Q.DELETE_ALL_PLAYLIST_ITEM).run();
    this.db.prepare(Q.DELETE_ALL_PLAYLIST).run();
  }

  private rowToPlaylist(r: PlaylistRow): Playlist {
    return {
      id: r.id,
      name: r.name,
      createdAt: new Date((r.createdAt ?? 0) * 1000),
      updatedAt: new Date((r.updatedAt ?? 0) * 1000),
      icon: r.icon,
      serverMylistId: r.serverMylistId,
      syncKey: r.syncKey
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
