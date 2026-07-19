import fs from 'node:fs';
import path from 'node:path';
import type { WatchPageInfo, VariantStreamData } from '@shared/types';
import { NicoContext } from '../NicoContext';
import { WatchSession } from './WatchSession';
import { M3U8Parser } from './M3U8Parser';
import type { MasterPlaylist } from './M3U8Parser';
import { SegmentDownloader } from './SegmentDownloader';
import { FFmpegManager } from './FFmpegManager';
import { MediabunnyMuxer } from './MediabunnyMuxer';
import { StreamJsonWriter } from './StreamJsonWriter';
import { concatBinary } from './SegmentConcat';
import { createLogger } from '../../util/Logger';
import { getConfigStore } from '../../config/ConfigStore';

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
  /** 音声のみダウンロード (映像トラックを取得しない) */
  audioOnly?: boolean;
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
      const sessionResult = await session.ensure(opts.audioOnly);
      log.info('session ensured:', sessionResult.contentUrl);

      opts.onPhaseChange?.('master_playlist');
      const ctx = NicoContext.get();
      const masterText = await ctx.http.getText(sessionResult.contentUrl);
      const master = M3U8Parser.parseMaster(masterText, sessionResult.contentUrl);

      if (opts.audioOnly) {
        await this.downloadAudioOnly(master, masterText, sessionResult.contentUrl, opts);
      } else {
        await this.downloadWithVideo(master, opts);
      }

      opts.onPhaseChange?.('done');
    } finally {
      session.dispose();
    }
  }

  /**
   * 音声のみダウンロード。
   * HLS fMP4 の audio init+segment は init+segment を単純連結するだけで
   * 有効な .m4a になるため、mux (ffmpeg/mediabunny) 工程を経由しない。
   */
  private static async downloadAudioOnly(
    master: MasterPlaylist,
    masterText: string,
    masterUrl: string,
    opts: VideoDownloadOptions
  ): Promise<void> {
    const ctx = NicoContext.get();

    opts.onPhaseChange?.('variant_playlist');
    let audioVariantText: string;
    let audioVariantUrl: string;
    if (master.audios.length > 0) {
      const chosenAudio = master.audios[0];
      audioVariantText = await ctx.http.getText(chosenAudio.url);
      audioVariantUrl = chosenAudio.url;
    } else if (master.streams.length > 0) {
      // DMS が音声トラックを #EXT-X-STREAM-INF (video用と同じタグ) で提供する場合
      log.info('master playlistのSTREAM-INFを音声トラックとして解釈します');
      const chosenStream = master.streams[0];
      audioVariantText = await ctx.http.getText(chosenStream.url);
      audioVariantUrl = chosenStream.url;
    } else {
      // DMS は音声トラック単体指定 (outputs=[[audio.id]]) の場合、
      // master m3u8 ではなく variant m3u8 (セグメント一覧) を直接返すことがある。
      // その場合 contentUrl 自体を variant playlist として扱う。
      log.info('master playlistに音声トラック定義なし。contentUrlをvariant playlistとして解釈します');
      audioVariantText = masterText;
      audioVariantUrl = masterUrl;
    }
    log.debug('audio variant playlist text:', audioVariantText);
    const audioVariant = M3U8Parser.parseVariant(
      audioVariantText,
      audioVariantUrl
    );
    if (!audioVariant.mapUrl) {
      throw new Error('init segment が見つかりません');
    }

    opts.onPhaseChange?.('key');
    let audioKey: Buffer | undefined;
    let audioIv: Buffer | undefined;
    if (audioVariant.key) {
      audioKey = await ctx.http.getBinary(audioVariant.key.url);
      audioIv = audioVariant.key.iv
        ? this.parseIv(audioVariant.key.iv)
        : Buffer.alloc(16);
    }

    const audioDir = path.join(opts.tempDir, 'audio');
    fs.mkdirSync(audioDir, { recursive: true });
    const audioInitPath = path.join(audioDir, audioVariant.mapFilename!);
    if (!fs.existsSync(audioInitPath)) {
      const buf = await ctx.http.getBinary(audioVariant.mapUrl);
      fs.writeFileSync(audioInitPath, buf);
    }

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

    opts.onPhaseChange?.('merge');
    fs.mkdirSync(path.dirname(opts.outputPath), { recursive: true });
    concatBinary(
      [
        audioInitPath,
        ...audioVariant.segments.map((s) => path.join(audioDir, s.filename))
      ],
      opts.outputPath
    );
  }

  private static async downloadWithVideo(
    master: MasterPlaylist,
    opts: VideoDownloadOptions
  ): Promise<void> {
    const ctx = NicoContext.get();
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

      // 結合 (ffmpeg or mediabunny)
      opts.onPhaseChange?.('merge');
      fs.mkdirSync(path.dirname(opts.outputPath), { recursive: true });
      const muxImpl = getConfigStore().get('downloadMuxImplementation') ?? 'ffmpeg';
      const mergeOpts = {
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
      };
      log.info('mux implementation:', muxImpl);
      if (muxImpl === 'mediabunny') {
        await MediabunnyMuxer.merge(mergeOpts);
      } else {
        await FFmpegManager.merge(mergeOpts);
      }
  }

  private static parseIv(ivHex: string): Buffer {
    let s = ivHex.trim();
    if (s.startsWith('0x') || s.startsWith('0X')) s = s.slice(2);
    if (s.length < 32) s = s.padStart(32, '0');
    return Buffer.from(s, 'hex');
  }
}
