import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { app } from 'electron';
import type { NicoHttp } from '../nicovideo/NicoHttp';
import { createLogger } from './Logger';

const log = createLogger('ImageCache');

/**
 * サムネイル・ユーザーアイコンをローカルキャッシュして
 * `nndd-re-local://video?path=...` URL に差し替えるキャッシュ機構。
 *
 * - キャッシュ先: userData/cache/image/
 * - ファイル名  : sha1(originalUrl) + 拡張子
 * - nndd-re-local:// は LocalVideoProtocol が userData 配下を許可しているため追加設定不要
 */
export class ImageCache {
  private static _enabled = true;
  private static _maxSizeMb = 1000;
  private static _dir: string | null = null;
  private static _cachedKeys = new Set<string>();

  static get cacheDir(): string {
    if (!this._dir) {
      this._dir = path.join(app.getPath('userData'), 'nndd-cache', 'image');
    }
    return this._dir;
  }

  static setEnabled(v: boolean): void {
    this._enabled = v;
    log.info('ImageCache enabled:', v);
  }

  static isEnabled(): boolean {
    return this._enabled;
  }

  static setMaxSizeMb(v: number): void {
    this._maxSizeMb = (typeof v === 'number' && isFinite(v) && v >= 0) ? v : 1000;
  }

  /** 起動時に一度だけ呼ぶ。ディレクトリをスキャンしてメモリセットに読み込む */
  static async init(): Promise<void> {
    try {
      const files = await fs.promises.readdir(this.cacheDir);
      this._cachedKeys = new Set(files);
      log.info(`ImageCache init: ${files.length} files loaded`);
    } catch {}
  }

  // ----- internal helpers -----

  private static fileName(url: string): string {
    const hash = crypto.createHash('sha1').update(url).digest('hex');
    return `${hash}${guessExt(url)}`;
  }

  static cachePath(url: string): string {
    return path.join(this.cacheDir, this.fileName(url));
  }

  static toLocalUrl(filePath: string): string {
    return `nndd-re-local://video?path=${encodeURIComponent(filePath)}`;
  }

  // ----- public API -----

  /** キャッシュ済みなら nndd-re-local:// URL を返す。未キャッシュなら null */
  static getCached(url: string): string | null {
    if (!this._enabled || !url) return null;
    const name = this.fileName(url);
    if (this._cachedKeys.has(name)) return this.toLocalUrl(path.join(this.cacheDir, name));
    return null;
  }

  /**
   * キャッシュ済みなら即 local URL を返す。
   * 未キャッシュなら NicoHttp でダウンロードしてキャッシュ後に local URL を返す。
   * 失敗した場合は元 URL をそのまま返す (フォールバック)。
   */
  static async getOrFetch(url: string, http: NicoHttp): Promise<string> {
    if (!this._enabled || !url) return url;
    const cached = this.getCached(url);
    if (cached) return cached;

    try {
      const buf = await http.getBinary(url, {
        noCookieReceive: true,
        timeoutMs: 10000
      });
      const name = this.fileName(url);
      const p = path.join(this.cacheDir, name);
      fs.writeFileSync(p, buf);
      this._cachedKeys.add(name);
      log.debug('cached:', name, '<-', url);
      void this.evictIfNeeded();
      return this.toLocalUrl(p);
    } catch (e) {
      log.warn('fetch failed, using original URL:', url, String(e));
      return url;
    }
  }

  /** 上限超過時に古いファイルから削除 */
  private static async evictIfNeeded(): Promise<void> {
    if (this._maxSizeMb === 0) return;
    const maxBytes = this._maxSizeMb * 1024 * 1024;
    const d = this.cacheDir;
    try {
      const files = await fs.promises.readdir(d);
      const entries = await Promise.all(
        files.map(async f => {
          const p = path.join(d, f);
          const stat = await fs.promises.stat(p);
          return { path: p, name: f, size: stat.size, mtime: stat.mtimeMs };
        })
      );
      entries.sort((a, b) => a.mtime - b.mtime);
      let total = entries.reduce((s, e) => s + e.size, 0);
      for (const entry of entries) {
        if (total <= maxBytes) break;
        try {
          await fs.promises.unlink(entry.path);
          this._cachedKeys.delete(entry.name);
          total -= entry.size;
        } catch {}
      }
    } catch {}
  }

  /**
   * キャッシュ済みなら即ローカル URL、未キャッシュなら元 URL を返す (同期)。
   * 未キャッシュ URL はバックグラウンドでダウンロード・保存する。
   */
  static cacheUrlList(urls: string[], http: NicoHttp): string[] {
    if (!this._enabled) return urls;
    return urls.map(u => {
      if (!u) return u;
      const cached = this.getCached(u);
      if (cached) return cached;
      void this.getOrFetch(u, http); // fire & forget
      return u;
    });
  }

  /** キャッシュの使用状況を返す */
  static info(): { sizeBytes: number; fileCount: number; dir: string } {
    const d = this.cacheDir;
    try {
      const files = fs.readdirSync(d);
      let size = 0;
      for (const f of files) {
        try { size += fs.statSync(path.join(d, f)).size; } catch {}
      }
      return { sizeBytes: size, fileCount: files.length, dir: d };
    } catch {
      return { sizeBytes: 0, fileCount: 0, dir: d };
    }
  }

  /** キャッシュを全削除 */
  static clear(): void {
    const d = this.cacheDir;
    let count = 0;
    try {
      for (const f of fs.readdirSync(d)) {
        try { fs.unlinkSync(path.join(d, f)); count++; } catch {}
      }
      this._cachedKeys.clear();
      log.info(`image cache cleared: ${count} files removed`);
    } catch {}
  }
}

function guessExt(url: string): string {
  const m = url.match(/\.(jpe?g|png|gif|webp|avif|svg)(\?.*)?$/i);
  if (!m) return '.jpg';
  const ext = m[1].toLowerCase();
  return `.${ext === 'jpeg' ? 'jpg' : ext}`;
}
