import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { BinaryInstaller } from '../../util/BinaryInstaller';
import { createLogger } from '../../util/Logger';
import { concatBinary } from './SegmentConcat';

const log = createLogger('FFmpeg');

export interface MergeSegmentsOptions {
  /** init映像セグメント (fMP4) のパス */
  videoInitPath: string;
  /** 映像m4sセグメントのパス一覧 (順序通り) */
  videoSegmentPaths: string[];
  /** init音声セグメント */
  audioInitPath: string;
  /** 音声m4sセグメント */
  audioSegmentPaths: string[];
  /** 最終MP4出力先 */
  outputPath: string;
  /** 中間ファイル一時ディレクトリ */
  tempDir: string;
  /** 進捗コールバック (時間 ms / 動画長 ms 推定) */
  onProgress?: (currentMs: number, totalMs: number | null) => void;
  signal?: AbortSignal;
}

/**
 * FFmpeg を用いて HLS fMP4 セグメントを 1本の MP4 に結合する。
 *
 * 元: Niconicome V3 の DMSFileHandler.cs / VideoEncoder.cs に相当。
 *
 * 手順:
 *  1. video.init + video segments を連結して video.mp4 を作る
 *  2. audio.init + audio segments を連結して audio.mp4 を作る
 *  3. 両者を ffmpeg で muxing して 最終 output.mp4 にする
 *     (映像・音声とも stream copy なので無劣化)
 */
export class FFmpegManager {
  /**
   * セグメントを結合する。
   */
  static async merge(opts: MergeSegmentsOptions): Promise<void> {
    fs.mkdirSync(opts.tempDir, { recursive: true });
    const videoCombined = path.join(opts.tempDir, '_video.mp4');
    const audioCombined = path.join(opts.tempDir, '_audio.mp4');

    // 1. 映像セグメント結合 (init + segments のバイナリ連結)
    concatBinary(
      [opts.videoInitPath, ...opts.videoSegmentPaths],
      videoCombined
    );
    log.debug('video combined:', videoCombined);

    // 2. 音声セグメント結合
    concatBinary(
      [opts.audioInitPath, ...opts.audioSegmentPaths],
      audioCombined
    );
    log.debug('audio combined:', audioCombined);

    // 3. ffmpeg で mux
    const args = [
      '-y',
      '-loglevel', 'error',
      '-i', videoCombined,
      '-i', audioCombined,
      '-c:v', 'copy',
      '-c:a', 'copy',
      '-movflags', '+faststart',
      opts.outputPath
    ];
    await this.runFfmpeg(args, opts.signal, opts.onProgress);

    // 中間ファイル削除
    try {
      fs.unlinkSync(videoCombined);
      fs.unlinkSync(audioCombined);
    } catch {
      // ignore
    }
  }

  /**
   * 複数バイナリファイルを単純連結。fMP4 セグメントの結合に使う
   * (HLS用のfMP4は init + cmfv/cmfa を直接連結するだけで再生可能)。
   */
  static concatBinary(files: string[], output: string): void {
    concatBinary(files, output);
  }

  /**
   * ffmpeg を子プロセスで実行。
   */
  private static runFfmpeg(
    args: string[],
    signal: AbortSignal | undefined,
    onProgress?: (currentMs: number, totalMs: number | null) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const ffmpegPath = BinaryInstaller.findFfmpeg();
      log.debug('spawn ffmpeg:', ffmpegPath, args.join(' '));
      const proc = spawn(ffmpegPath, args, {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let stderr = '';
      proc.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf-8');
        stderr += text;
        // "time=00:01:23.45" を拾う
        if (onProgress) {
          const m = text.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
          if (m) {
            const ms =
              Number(m[1]) * 3_600_000 +
              Number(m[2]) * 60_000 +
              Math.floor(Number(m[3]) * 1000);
            onProgress(ms, null);
          }
        }
      });

      const onAbort = (): void => {
        try {
          proc.kill('SIGTERM');
        } catch {
          // ignore
        }
      };
      signal?.addEventListener('abort', onAbort);

      proc.on('error', (err) => {
        signal?.removeEventListener('abort', onAbort);
        reject(err);
      });
      proc.on('close', (code) => {
        signal?.removeEventListener('abort', onAbort);
        if (signal?.aborted) {
          reject(new Error('ffmpeg aborted'));
          return;
        }
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`ffmpeg exited with code ${code}\n${stderr}`));
        }
      });
    });
  }
}
