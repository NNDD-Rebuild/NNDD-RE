import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { createLogger } from '../../util/Logger';
import { getConfigStore } from '../../config/ConfigStore';

const log = createLogger('YtDlpStreamer');

/**
 * ストリーミングキャッシュの管理。
 * yt-dlp で取得した動画を MP4 形式でキャッシュし、
 * `<video>` タグで再生可能にする。
 */
export class YtDlpStreamer {

  /**
   * ストリーミングキャッシュの保存先。
   * 以前は `app.getPath('temp')/nndd-stream` (アプリ起動/終了で全消去) だったが、
   * 「キャッシュとして残してシーク可能に」という要件のため、
   * `app.getPath('userData')/cache/movie` に永続化する。
   */
  static cacheDir(): string {
    const custom = getConfigStore().get('cacheRoot');
    const dir = custom
      ? path.join(custom, 'cache', 'movie')
      : path.join(app.getPath('userData'), 'nndd-cache', 'movie');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  /**
   * 全キャッシュファイルを削除 (ユーザー操作によるキャッシュクリア用)。
   * 自動では呼ばない。
   */
  static cleanupAll(): void {
    try {
      const dir = this.cacheDir();
      for (const f of fs.readdirSync(dir)) {
        const p = path.join(dir, f);
        try {
          fs.unlinkSync(p);
        } catch (e) {
          log.warn('cleanup failed', p, e);
        }
      }
    } catch (e) {
      log.warn('cleanupAll error', e);
    }
  }

  /** キャッシュサイズ取得 (バイト) */
  static cacheSizeBytes(): number {
    try {
      const dir = this.cacheDir();
      let total = 0;
      for (const f of fs.readdirSync(dir)) {
        try {
          total += fs.statSync(path.join(dir, f)).size;
        } catch {
          // ignore
        }
      }
      return total;
    } catch {
      return 0;
    }
  }

  /**
   * 既存キャッシュのパスを返す。なければ null。
   */
  static getCachedPath(videoId: string): string | null {
    const dir = this.cacheDir();
    const existing = fs.readdirSync(dir).find(
      (f) => f === `${videoId}.mp4` || f.startsWith(`${videoId}_`)
    );
    return existing ? path.join(dir, existing) : null;
  }

}
