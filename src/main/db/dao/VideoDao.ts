import type { NNDDREVideo } from '@shared/types';
import { NnddDatabase } from '../Database';
import { Q } from '../schema';

interface VideoRow {
  id: number;
  key: string | null;
  uri: string;
  videoName: string;
  modificationDate: number;
  creationDate: number;
  thumbUrl: string;
  playCount: number;
  time: number;
  lastPlayDate: number | null;
  yetReading: number;
  pubDate: number | null;
}

/**
 * NNDDREVideo DAO
 * 元: src/org/mineap/nndd/library/sqlite/dao/NNDDREVideoDao.as
 */
export class VideoDao {
  constructor(private readonly db: NnddDatabase) {}

  list(): NNDDREVideo[] {
    const rows = this.db.prepare(Q.SELECT_VIDEO_ALL).all() as VideoRow[];
    return rows.map((r) => this.rowToVideo(r, []));
  }

  /**
   * 全動画を取得し、それぞれにタグも結合して返す。
   * 大量データ向けに JOIN ではなく後段でまとめてバルクロードする。
   */
  listWithTags(): NNDDREVideo[] {
    const rows = this.db.prepare(Q.SELECT_VIDEO_ALL).all() as VideoRow[];
    const result: NNDDREVideo[] = [];
    const tagStmt = this.db.prepare(Q.SELECT_TAGS_BY_VIDEO);
    for (const r of rows) {
      const tags = (tagStmt.all(r.id) as { tag: string }[]).map((t) => t.tag);
      result.push(this.rowToVideo(r, tags));
    }
    return result;
  }

  getByKey(key: string): NNDDREVideo | null {
    const row = this.db.prepare(Q.SELECT_VIDEO_BY_KEY).get(key) as
      | VideoRow
      | undefined;
    if (!row) return null;
    const tags = (
      this.db.prepare(Q.SELECT_TAGS_BY_VIDEO).all(row.id) as { tag: string }[]
    ).map((t) => t.tag);
    return this.rowToVideo(row, tags);
  }

  getById(id: number): NNDDREVideo | null {
    const row = this.db.prepare(Q.SELECT_VIDEO_BY_ID).get(id) as
      | VideoRow
      | undefined;
    if (!row) return null;
    const tags = (
      this.db.prepare(Q.SELECT_TAGS_BY_VIDEO).all(row.id) as { tag: string }[]
    ).map((t) => t.tag);
    return this.rowToVideo(row, tags);
  }

  insertOrUpdate(video: NNDDREVideo, dirpathId: number | null): number {
    const key = this.extractKey(video.uri);
    return this.db.transaction(() => {
      const stmt = this.db.prepare(Q.INSERT_VIDEO);
      const info = stmt.run(
        key,
        video.uri,
        dirpathId,
        video.videoName,
        video.modificationDate.getTime() / 1000,
        video.creationDate.getTime() / 1000,
        video.thumbUrl,
        video.playCount,
        video.time,
        video.lastPlayDate ? video.lastPlayDate.getTime() / 1000 : null,
        video.yetReading ? 1 : 0,
        video.pubDate ? video.pubDate.getTime() / 1000 : null
      );
      const id = Number(info.lastInsertRowid);
      this.setTags(id, video.tagStrings);
      return id;
    });
  }

  delete(id: number): void {
    this.db.transaction(() => {
      this.db.prepare(Q.DELETE_VIDEO_TAGS).run(id);
      this.db.prepare(Q.DELETE_VIDEO).run(id);
    });
  }

  /**
   * 動画に紐づくタグを設定 (既存タグはまとめて置換)
   */
  setTags(videoId: number, tags: string[]): void {
    this.db.transaction(() => {
      this.db.prepare(Q.DELETE_VIDEO_TAGS).run(videoId);
      const insertTag = this.db.prepare(Q.INSERT_TAG);
      const selectTagId = this.db.prepare(Q.SELECT_TAG_ID);
      const insertVideoTag = this.db.prepare(Q.INSERT_VIDEO_TAG);
      for (const t of tags) {
        if (!t) continue;
        insertTag.run(t);
        const row = selectTagId.get(t) as { id: number } | undefined;
        if (row) insertVideoTag.run(videoId, row.id);
      }
    });
  }

  /**
   * dirpath (動画格納先) を挿入し、ID を返す。
   */
  ensureFileDir(dirpath: string): number {
    return this.db.transaction(() => {
      this.db.prepare(Q.INSERT_FILE).run(dirpath);
      const row = this.db.prepare(Q.SELECT_FILE_ID).get(dirpath) as
        | { id: number }
        | undefined;
      return row?.id ?? 0;
    });
  }

  /**
   * 不要な file レコードを掃除。
   */
  cleanupOrphanFiles(): void {
    this.db.prepare(Q.DELETE_UNUSED_FILE).run();
  }

  /**
   * 動画のURIを更新 (フォルダ移動時)。
   */
  updateUri(id: number, newUri: string): void {
    this.db.prepare('UPDATE NNDDREVideo SET uri = ? WHERE id = ?').run(newUri, id);
  }

  /**
   * 再生回数を +1 し lastPlayDate を更新。
   * key はファイル名の `[sm12345]` から抽出した動画ID。
   */
  incrementPlayCount(key: string): void {
    this.db.prepare(Q.INCREMENT_PLAY_COUNT).run(Date.now() / 1000, key);
  }

  private rowToVideo(r: VideoRow, tags: string[]): NNDDREVideo {
    return {
      id: r.id,
      uri: r.uri,
      videoName: r.videoName,
      tagStrings: tags,
      modificationDate: new Date(r.modificationDate * 1000),
      creationDate: new Date(r.creationDate * 1000),
      thumbUrl: r.thumbUrl,
      playCount: r.playCount,
      time: r.time,
      lastPlayDate: r.lastPlayDate ? new Date(r.lastPlayDate * 1000) : null,
      yetReading: r.yetReading === 1,
      pubDate: r.pubDate ? new Date(r.pubDate * 1000) : null
    };
  }

  /**
   * URI からキー(ニコニコ動画ID部分)を抽出。
   * 元: NamedArrayLibraryManager で `[sm12345]` 形式から抽出していた。
   */
  private extractKey(uri: string): string {
    const m = uri.match(/\[((?:sm|nm|so|ax|sd|ca|cd|cw|zb|ze|yo)\d+)\]/);
    return m ? m[1] : uri;
  }
}
