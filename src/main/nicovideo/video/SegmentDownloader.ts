import fs from 'node:fs';
import path from 'node:path';
import type { HlsSegment } from '@shared/types';
import { NicoContext } from '../NicoContext';
import { Aes128Decryptor } from './Aes128Decryptor';
import { createLogger } from '../../util/Logger';

const log = createLogger('SegmentDownloader');

export interface SegmentDownloadOptions {
  /** 保存先ディレクトリ */
  outputDir: string;
  /** AES-128 鍵バイナリ (暗号化時のみ) */
  key?: Buffer;
  /** AES-128 IV (暗号化時のみ) */
  iv?: Buffer;
  /** 並列数 (デフォルト 3) */
  concurrency?: number;
  /** リトライ回数 (デフォルト 3) */
  maxRetries?: number;
  /** リトライ間隔 (ms, デフォルト 5000) */
  retryWaitMs?: number;
  /** 進捗コールバック */
  onProgress?: (done: number, total: number) => void;
  /** AbortController で中断可能 */
  signal?: AbortSignal;
}

/**
 * HLS セグメントを並列ダウンロードし、復号後にディスク保存する。
 * 元: Niconicome V3 SegmentDownloader.cs
 *
 * 復号後のセグメントは {outputDir}/{segment.filename} に書く。
 * 既にファイルが存在する場合はスキップ (レジューム対応)。
 */
export class SegmentDownloader {
  /**
   * 単一セグメントをダウンロード+復号して保存。
   */
  static async downloadOne(
    seg: HlsSegment,
    opts: SegmentDownloadOptions
  ): Promise<void> {
    const dest = path.join(opts.outputDir, seg.filename);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
      // 既にダウンロード済み
      return;
    }

    const maxRetries = opts.maxRetries ?? 3;
    const retryWait = opts.retryWaitMs ?? 5000;
    let lastErr: unknown = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (opts.signal?.aborted) {
        throw new Error('aborted');
      }
      try {
        const ciphertext = await NicoContext.get().http.getBinary(seg.url, {
          signal: opts.signal
        });
        const plaintext =
          opts.key && opts.iv
            ? Aes128Decryptor.decrypt(ciphertext, opts.key, opts.iv)
            : ciphertext;
        fs.writeFileSync(dest, plaintext);
        return;
      } catch (e) {
        lastErr = e;
        log.warn(
          `segment ${seg.filename} download attempt ${attempt + 1}/${maxRetries + 1} failed:`,
          e
        );
        if (attempt < maxRetries) {
          await this.delay(retryWait);
        }
      }
    }
    throw new Error(
      `segment download failed after ${maxRetries + 1} attempts: ${seg.filename}: ${lastErr}`
    );
  }

  /**
   * セグメント群を並列ダウンロード。
   */
  static async downloadAll(
    segments: HlsSegment[],
    opts: SegmentDownloadOptions
  ): Promise<void> {
    fs.mkdirSync(opts.outputDir, { recursive: true });

    const concurrency = Math.max(1, opts.concurrency ?? 3);
    let done = 0;
    let idx = 0;
    const total = segments.length;

    const worker = async (): Promise<void> => {
      while (true) {
        if (opts.signal?.aborted) return;
        const i = idx++;
        if (i >= segments.length) return;
        await this.downloadOne(segments[i], opts);
        done++;
        opts.onProgress?.(done, total);
      }
    };

    const workers: Promise<void>[] = [];
    for (let w = 0; w < concurrency; w++) {
      workers.push(worker());
    }
    await Promise.all(workers);
  }

  private static delay(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
