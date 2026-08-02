import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { app } from 'electron';
import { getConfigStore } from '../../config/ConfigStore';
import { createLogger } from '../../util/Logger';

const log = createLogger('LocalTranscode');

/** mpegts.js / <video> がそのまま再生できる映像コーデック (FLV CodecID) */
const NATIVE_PLAYABLE_FLV_CODEC_IDS = new Set([7]); // 7 = AVC (H.264)

/** 拡張子だけで判定してよい (中身を見るまでもなく再生可能な) ブラウザネイティブ対応拡張子 */
const NATIVE_EXTS = new Set(['.mp4', '.webm', '.mkv', '.m4a']);

type ContainerFormat = 'flv' | 'mp4' | 'other';

/**
 * 本家NNDD (旧クライアント) 時代にダウンロードされたファイルは、拡張子が投稿当時の
 * 形式 (`.flv`/`.swf`) のまま残っているだけで、ニコニコ動画側はすでにMP4/HLS配信へ
 * 移行済み (`.swf` は2018年にサーバー側で順次MP4へ変換された) のため、実体はMP4化
 * されているケースが大半。拡張子で入口を絞るのではなく、ファイル先頭バイトの実コンテナ
 * 形式を判定し、判定結果に応じて常に正しい拡張子でハードリンクして返すことで、
 * 再生方式選択 (VideoPlayer.tsx の拡張子ベース判定) を実体に一致させる。
 * ffmpegは使用しない。本物のFlash SWF (ActionScript使用) や、FLVコンテナで非対応
 * コーデック (flv1/Sorenson H.263等) は救済手段がないため再生不可のまま。
 */
export class LocalTranscodeCache {
  static cacheDir(): string {
    const custom = getConfigStore().get('cacheRoot');
    const dir = custom
      ? path.join(String(custom), 'cache', 'movie', 'transcoded')
      : path.join(app.getPath('userData'), 'nndd-cache', 'movie', 'transcoded');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  private static cacheKey(filePath: string): string {
    const stat = fs.statSync(filePath);
    return crypto
      .createHash('sha1')
      .update(`${filePath}:${stat.size}:${stat.mtimeMs}`)
      .digest('hex');
  }

  /** ファイル先頭バイトから実コンテナ形式を判定する。 */
  private static detectContainer(filePath: string): ContainerFormat {
    const fd = fs.openSync(filePath, 'r');
    try {
      const buf = Buffer.alloc(12);
      const n = fs.readSync(fd, buf, 0, 12, 0);
      if (n >= 3 && buf[0] === 0x46 && buf[1] === 0x4c && buf[2] === 0x56) return 'flv';
      if (n >= 8 && buf.toString('ascii', 4, 8) === 'ftyp') return 'mp4';
      return 'other';
    } finally {
      fs.closeSync(fd);
    }
  }

  /**
   * FLVタグ構造を辿り、最初の video tag の CodecID (下位4bit) を取得する。
   * ffmpeg不使用の軽量パーサー。見つからなければ null。
   */
  private static detectFlvVideoCodecId(filePath: string): number | null {
    const fd = fs.openSync(filePath, 'r');
    try {
      const stat = fs.fstatSync(fd);
      // scriptタグ等が大きいケースを見込み、先頭256KBまでを探索対象とする
      const scanLimit = Math.min(stat.size, 256 * 1024);
      const buf = Buffer.alloc(scanLimit);
      fs.readSync(fd, buf, 0, scanLimit, 0);

      if (buf.length < 9) return null;
      const headerSize = buf.readUInt32BE(5);
      let offset = headerSize + 4; // header + PreviousTagSize0

      while (offset + 11 <= buf.length) {
        const tagType = buf[offset];
        const dataSize = buf.readUIntBE(offset + 1, 3);
        const dataOffset = offset + 11;
        if (dataOffset + dataSize > buf.length) break;

        if (tagType === 9 && dataSize >= 1) {
          return buf[dataOffset] & 0x0f;
        }

        offset = dataOffset + dataSize + 4; // + PreviousTagSize
      }
      return null;
    } catch {
      return null;
    } finally {
      fs.closeSync(fd);
    }
  }

  /** 同一ボリューム内はハードリンク、失敗時はコピーでファイルを複製する。 */
  private static linkOrCopy(src: string, dest: string): void {
    try {
      fs.linkSync(src, dest);
    } catch {
      fs.copyFileSync(src, dest);
    }
  }

  /** キャッシュディレクトリに指定拡張子でハードリンク (失敗時コピー) したパスを返す。 */
  private static relinkAs(filePath: string, ext: string): string | null {
    let key: string;
    try {
      key = this.cacheKey(filePath);
    } catch (e) {
      log.warn('cacheKey failed:', e);
      return null;
    }
    const outputPath = path.join(this.cacheDir(), `${key}${ext}`);
    if (fs.existsSync(outputPath)) return outputPath;

    log.info(`拡張子とコンテナ不一致 (実体は${ext}):`, filePath, '->', outputPath);
    try {
      this.linkOrCopy(filePath, outputPath);
      return outputPath;
    } catch (e) {
      log.warn('link/copy failed:', e);
      return null;
    }
  }

  /**
   * ローカル動画ファイルが再生可能か判定する。
   * - ブラウザネイティブ対応拡張子 (.mp4等) はそのまま返す
   * - それ以外 (.flv/.swf等) は中身を見て実コンテナを判定し、mp4/flvであれば
   *   常に判定結果に応じた正しい拡張子でハードリンクしたキャッシュパスを返す
   * - 本当にFLVコンテナで非対応コーデックの場合、または実体不明 (本物のFlash SWF、
   *   壊れたダウンロード等) の場合は null
   */
  static async ensurePlayable(filePath: string): Promise<string | null> {
    const ext = path.extname(filePath).toLowerCase();
    if (NATIVE_EXTS.has(ext)) return filePath;

    let container: ContainerFormat;
    try {
      container = this.detectContainer(filePath);
    } catch (e) {
      log.warn('detectContainer failed:', e);
      return null;
    }

    if (container === 'mp4') {
      return this.relinkAs(filePath, '.mp4');
    }

    if (container === 'flv') {
      const codecId = this.detectFlvVideoCodecId(filePath);
      if (codecId === null || !NATIVE_PLAYABLE_FLV_CODEC_IDS.has(codecId)) {
        log.warn('FLV非対応コーデック (codecId=' + codecId + '):', filePath);
        return null;
      }
      if (ext === '.flv') return filePath;
      return this.relinkAs(filePath, '.flv');
    }

    log.warn('不明なコンテナ形式 (本物のFlash SWF、または壊れたファイルの可能性):', filePath);
    return null;
  }
}
