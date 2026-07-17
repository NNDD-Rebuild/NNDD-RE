import fs from 'node:fs';
import path from 'node:path';
import { LibraryManager } from '../db/LibraryManager';
import { createLogger } from '../util/Logger';
import { VideoFileSuffix } from '@shared/constants';
import type { NNDDREVideo } from '@shared/types';
import { ThumbInfoXmlReader } from '../nicovideo/video/ThumbInfoXmlReader';
import { InfoTxtReader } from '../nicovideo/video/InfoTxtReader';

const log = createLogger('LibraryScanner');

/**
 * ライブラリディレクトリを再帰的にスキャンし、見つかった動画を DB に登録する。
 *
 * 元: src/org/mineap/nndd/library/LibraryDirSearchUtil.as
 *     + LocalVideoInfoLoader.as
 *
 * 命名規則 `タイトル[sm12345].mp4` から動画IDを抽出する。
 * 同ディレクトリの `[サムネイル情報].xml` を読んで補完情報を取得する。
 */
export class LibraryScanner {
  /**
   * 動画ファイル拡張子
   */
  static VIDEO_EXTS = ['.mp4', '.flv', '.swf', '.webm', '.mkv', '.m4a'];

  /**
   * ライブラリディレクトリ全体をスキャン。
   */
  static async scan(
    library: LibraryManager,
    onProgress?: (current: string, count: number) => void
  ): Promise<{ added: number; updated: number; total: number }> {
    const root = library.videoDir;
    let added = 0;
    let updated = 0;
    let total = 0;

    if (!fs.existsSync(root)) {
      log.warn('library directory not found:', root);
      return { added, updated, total };
    }

    const walk = async (dir: string): Promise<void> => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (e) {
        log.warn('readdir failed:', dir, e);
        return;
      }
      for (const ent of entries) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          await walk(p);
        } else if (ent.isFile()) {
          const ext = path.extname(ent.name).toLowerCase();
          if (!this.VIDEO_EXTS.includes(ext)) continue;
          total++;
          onProgress?.(p, total);
          const result = await this.registerOne(library, p);
          if (result === 'added') added++;
          else if (result === 'updated') updated++;
        }
      }
    };

    await walk(root);
    library.videoDao.cleanupOrphanFiles();
    log.info(`scan complete: added=${added} updated=${updated} total=${total}`);
    return { added, updated, total };
  }

  /**
   * 動画ファイル1個をDBに登録/更新。
   */
  private static async registerOne(
    library: LibraryManager,
    filePath: string
  ): Promise<'added' | 'updated' | 'skipped'> {
    const fileName = path.basename(filePath);
    const baseName = fileName.replace(/\.[^.]+$/, '');
    const videoId = this.extractVideoId(baseName);
    const title = this.extractTitle(baseName, videoId);

    if (!videoId) {
      log.debug('skip (no videoId):', filePath);
      return 'skipped';
    }

    const dir = path.dirname(filePath);
    const stat = fs.statSync(filePath);

    // 既存レコード?
    const existing = library.videoDao.getByKey(videoId);

    // 付帯ファイル (新形式優先、旧形式フォールバック)
    const thumbImagePathNew = path.join(dir, `${baseName}${VideoFileSuffix.THUMB_IMAGE}`);
    const thumbImagePathLegacy = path.join(dir, `${baseName}${VideoFileSuffix.THUMB_IMAGE_LEGACY}`);
    const thumbImagePath = fs.existsSync(thumbImagePathNew)
      ? thumbImagePathNew
      : thumbImagePathLegacy;
    const thumbInfoXmlPath = path.join(
      dir,
      `${baseName}${VideoFileSuffix.THUMB_INFO_XML}`
    );

    // サムネXMLから情報を補完
    const meta = this.readThumbInfoXml(thumbInfoXmlPath);

    const video: NNDDREVideo = existing ?? {
      id: 0,
      uri: filePath,
      videoName: fileName,
      tagStrings: meta?.tags ?? [],
      modificationDate: stat.mtime,
      creationDate: stat.birthtime || stat.ctime,
      thumbUrl: fs.existsSync(thumbImagePath) ? thumbImagePath : '',
      playCount: 0,
      time: meta?.length ?? 0,
      lastPlayDate: null,
      yetReading: true,
      pubDate: meta?.pubDate ?? null
    };

    if (existing) {
      // パスが変わっていたら更新
      video.uri = filePath;
      video.videoName = fileName;
      video.modificationDate = stat.mtime;
      // サムネイルが後から追加された場合も反映
      if (fs.existsSync(thumbImagePath)) {
        video.thumbUrl = thumbImagePath;
      }
      if (meta) {
        video.tagStrings = meta.tags;
        video.time = meta.length;
        video.pubDate = meta.pubDate;
      }
    } else {
      void title;
    }

    const dirId = library.videoDao.ensureFileDir(dir);
    library.videoDao.insertOrUpdate(video, dirId);
    return existing ? 'updated' : 'added';
  }

  static extractVideoId(baseName: string): string | null {
    const m = baseName.match(/\[((?:sm|nm|so|ax|sd|ca|cd|cw|zb|ze|yo)\d+)\]/);
    return m ? m[1] : null;
  }

  static extractTitle(baseName: string, videoId: string | null): string {
    if (!videoId) return baseName;
    // 新形式: "タイトル - [sm123]" → "タイトル"
    // 旧形式: "[sm123]タイトル" → "タイトル"
    return baseName
      .replace(` - [${videoId}]`, '')
      .replace(`[${videoId}]`, '')
      .trim();
  }

  /**
   * `[ThumbInfo].xml` を読んで補完情報を返す。
   * なければ旧 `[info].txt` を試みる (後方互換)。
   */
  static readThumbInfoXml(
    filePath: string
  ): { tags: string[]; length: number; pubDate: Date | null } | null {
    // 新形式: [ThumbInfo].xml
    const parsed = ThumbInfoXmlReader.parseFile(filePath);
    if (parsed) {
      return {
        tags: parsed.tags,
        length: parsed.length,
        pubDate: parsed.registeredAt ? new Date(parsed.registeredAt) : null
      };
    }
    // 旧形式: [info].txt (後方互換)
    const legacyPath = filePath.replace('[ThumbInfo].xml', '[info].txt');
    const legacy = InfoTxtReader.parseFile(legacyPath);
    if (legacy) {
      return {
        tags: legacy.tags,
        length: legacy.length,
        pubDate: legacy.registeredAt ? new Date(legacy.registeredAt) : null
      };
    }
    return null;
  }
}
