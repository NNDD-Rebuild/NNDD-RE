import fs from 'node:fs';
import path from 'node:path';
import type { WatchPageInfo, VariantStreamData } from '@shared/types';
import { NicoContext } from '../NicoContext';
import { WatchSession } from './WatchSession';
import { M3U8Parser } from './M3U8Parser';
import { SegmentDownloader } from './SegmentDownloader';
import { FFmpegManager } from './FFmpegManager';
import { StreamJsonWriter } from './StreamJsonWriter';
import { createLogger } from '../../util/Logger';

const log = createLogger('VideoDownloader');

export interface VideoDownloadOptions {
  /** 保存先 MP4 のフルパス */
  outputPath: string;
  /** 中間ディレクトリ (セグメント保存用) */
  tempDir: string;
  /** 並列数 (デフォルト 3) */
  concurrency?: number;
  /** リトライ回数 */
  maxRetries?: number;
  /** 進捗イベント */
  onPhaseChange?: (phase: VideoDownloadPhase, detail?: string) => void;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

export type VideoDownloadPhase =
  | 'session'
  | 'master_playlist'
  | 'variant_playlist'
  | 'key'
  | 'video_segments'
  | 'audio_segments'
  | 'merge'
  | 'done';

/**
 * 動画ダウンロード一連のフロー。
 *
 * 元: Niconicome V3 Integrate/VideoDownloader.cs
 *
 * 流れ:
 *   1. WatchSession 確立 → master.m3u8 URL 取得
 *   2. master.m3u8 取得 → 最高品質バリアント選択
 *   3. 映像/音声バリアントプレイリスト取得 + AESキー取得
 *   4. 映像セグメント並列ダウンロード (復号)
 *   5. 音声セグメント並列ダウンロード (復号)
 *   6. FFmpegで結合 → 最終MP4
 *   7. stream.json 書き出し
 */
export class VideoDownloader {
  static async download(
    watch: WatchPageInfo,
    opts: VideoDownloadOptions
  ): Promise<void> {
    const session = new WatchSession(watch);
    try {
      opts.onPhaseChange?.('session');
      const sessionResult = await session.ensure();
      log.info('session ensured:', sessionResult.contentUrl);

      opts.onPhaseChange?.('master_playlist');
      const ctx = NicoContext.get();
      const masterText = await ctx.http.getText(sessionResult.contentUrl);
      const master = M3U8Parser.parseMaster(masterText, sessionResult.contentUrl);
      if (master.streams.length === 0) {
        throw new Error('master playlistから映像ストリームが見つかりません');
      }

      // 最高解像度を選択
      master.streams.sort((a, b) => b.bandwidth - a.bandwidth);
      const chosenVideo = master.streams[0];
      const chosenAudio =
        master.audios.find((a) => a.groupId === chosenVideo.audioGroupId) ??
        master.audios[0];
      if (!chosenAudio) {
        throw new Error('音声ストリームが見つかりません');
      }

      log.info('selected variant:', {
        bandwidth: chosenVideo.bandwidth,
        resolution: chosenVideo.resolution,
        videoUrl: chosenVideo.url,
        audioUrl: chosenAudio.url
      });

      opts.onPhaseChange?.('variant_playlist');
      const videoVariantText = await ctx.http.getText(chosenVideo.url);
      const videoVariant = M3U8Parser.parseVariant(
        videoVariantText,
        chosenVideo.url
      );
      const audioVariantText = await ctx.http.getText(chosenAudio.url);
      const audioVariant = M3U8Parser.parseVariant(
        audioVariantText,
        chosenAudio.url
      );

      if (!videoVariant.mapUrl || !audioVariant.mapUrl) {
        throw new Error('init segment が見つかりません');
      }

      // 鍵取得
      opts.onPhaseChange?.('key');
      let videoKey: Buffer | undefined;
      let videoIv: Buffer | undefined;
      let audioKey: Buffer | undefined;
      let audioIv: Buffer | undefined;
      if (videoVariant.key) {
        videoKey = await ctx.http.getBinary(videoVariant.key.url);
        videoIv = videoVariant.key.iv
          ? this.parseIv(videoVariant.key.iv)
          : Buffer.alloc(16);
      }
      if (audioVariant.key) {
        audioKey = await ctx.http.getBinary(audioVariant.key.url);
        audioIv = audioVariant.key.iv
          ? this.parseIv(audioVariant.key.iv)
          : Buffer.alloc(16);
      }

      const videoDir = path.join(opts.tempDir, 'video');
      const audioDir = path.join(opts.tempDir, 'audio');
      fs.mkdirSync(videoDir, { recursive: true });
      fs.mkdirSync(audioDir, { recursive: true });

      // init segment ダウンロード
      const videoInitPath = path.join(videoDir, videoVariant.mapFilename!);
      const audioInitPath = path.join(audioDir, audioVariant.mapFilename!);
      if (!fs.existsSync(videoInitPath)) {
        const buf = await ctx.http.getBinary(videoVariant.mapUrl);
        fs.writeFileSync(videoInitPath, buf);
      }
      if (!fs.existsSync(audioInitPath)) {
        const buf = await ctx.http.getBinary(audioVariant.mapUrl);
        fs.writeFileSync(audioInitPath, buf);
      }

      // セグメント並列DL (映像)
      opts.onPhaseChange?.('video_segments');
      await SegmentDownloader.downloadAll(videoVariant.segments, {
        outputDir: videoDir,
        key: videoKey,
        iv: videoIv,
        concurrency: opts.concurrency,
        maxRetries: opts.maxRetries,
        onProgress: opts.onProgress,
        signal: opts.signal
      });

      // セグメント並列DL (音声)
      opts.onPhaseChange?.('audio_segments');
      await SegmentDownloader.downloadAll(audioVariant.segments, {
        outputDir: audioDir,
        key: audioKey,
        iv: audioIv,
        concurrency: opts.concurrency,
        maxRetries: opts.maxRetries,
        onProgress: opts.onProgress,
        signal: opts.signal
      });

      // stream.json 書き出し
      const variantData: VariantStreamData = {
        resolution: chosenVideo.resolution,
        bandwidth: chosenVideo.bandwidth,
        videoKey: videoKey ? videoKey.toString('base64') : '',
        audioKey: audioKey ? audioKey.toString('base64') : '',
        videoIV: videoVariant.key?.iv ?? '',
        audioIV: audioVariant.key?.iv ?? '',
        videoMapFileName: videoVariant.mapFilename ?? '',
        audioMapFileName: audioVariant.mapFilename ?? '',
        videoSegments: videoVariant.segments.map((s) => ({
          fileName: s.filename,
          duration: s.duration.toFixed(3)
        })),
        audioSegments: audioVariant.segments.map((s) => ({
          fileName: s.filename,
          duration: s.duration.toFixed(3)
        }))
      };
      StreamJsonWriter.write(opts.tempDir, variantData);

      // FFmpegで結合
      opts.onPhaseChange?.('merge');
      fs.mkdirSync(path.dirname(opts.outputPath), { recursive: true });
      await FFmpegManager.merge({
        videoInitPath,
        videoSegmentPaths: videoVariant.segments.map((s) =>
          path.join(videoDir, s.filename)
        ),
        audioInitPath,
        audioSegmentPaths: audioVariant.segments.map((s) =>
          path.join(audioDir, s.filename)
        ),
        outputPath: opts.outputPath,
        tempDir: opts.tempDir,
        signal: opts.signal
      });

      opts.onPhaseChange?.('done');
    } finally {
      session.dispose();
    }
  }

  private static parseIv(ivHex: string): Buffer {
    let s = ivHex.trim();
    if (s.startsWith('0x') || s.startsWith('0X')) s = s.slice(2);
    if (s.length < 32) s = s.padStart(32, '0');
    return Buffer.from(s, 'hex');
  }
}
