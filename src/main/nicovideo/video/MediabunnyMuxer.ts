import path from 'node:path';
import fs from 'node:fs';
import {
  Input,
  Output,
  ALL_FORMATS,
  FilePathSource,
  FilePathTarget,
  Mp4OutputFormat,
  EncodedVideoPacketSource,
  EncodedAudioPacketSource,
  EncodedPacketSink
} from 'mediabunny';
import { concatBinary } from './SegmentConcat';
import { createLogger } from '../../util/Logger';
import type { MergeSegmentsOptions } from './FFmpegManager';

const log = createLogger('MediabunnyMuxer');

/**
 * mediabunny (JS実装、ffmpeg非依存) を用いて HLS fMP4 セグメントを 1本の MP4 に結合する。
 * FFmpegManager.merge の代替実装。動作検証段階のため、失敗時は自動フォールバックせず
 * 詳細ログを出して原因を追いやすくする方針 (呼び出し元 DownloadManager 側で制御)。
 *
 * 手順:
 *  1. video.init + video segments を連結して video.mp4 を作る (FFmpegManagerと共通のconcatBinaryを再利用)
 *  2. audio.init + audio segments を連結して audio.mp4 を作る
 *  3. mediabunny の Input/Output 低レベルAPIで、両ファイルのエンコード済みパケットを
 *     デコード/再エンコードなしでそのまま 1本の MP4 に転写する (stream copy 相当)
 */
export class MediabunnyMuxer {
  static async merge(opts: MergeSegmentsOptions): Promise<void> {
    fs.mkdirSync(opts.tempDir, { recursive: true });
    const videoCombined = path.join(opts.tempDir, '_video.mp4');
    const audioCombined = path.join(opts.tempDir, '_audio.mp4');

    concatBinary([opts.videoInitPath, ...opts.videoSegmentPaths], videoCombined);
    log.debug('video combined:', videoCombined);
    concatBinary([opts.audioInitPath, ...opts.audioSegmentPaths], audioCombined);
    log.debug('audio combined:', audioCombined);

    if (opts.signal?.aborted) {
      throw new Error('mediabunny mux aborted');
    }

    const videoInput = new Input({ source: new FilePathSource(videoCombined), formats: ALL_FORMATS });
    const audioInput = new Input({ source: new FilePathSource(audioCombined), formats: ALL_FORMATS });
    let output: Output<Mp4OutputFormat, FilePathTarget> | undefined;

    try {
      const videoTrack = await videoInput.getPrimaryVideoTrack();
      if (!videoTrack) {
        throw new Error(`mediabunny: 映像トラックが見つかりません (${videoCombined})`);
      }
      const audioTrack = await audioInput.getPrimaryAudioTrack();
      if (!audioTrack) {
        throw new Error(`mediabunny: 音声トラックが見つかりません (${audioCombined})`);
      }

      const videoCodec = await videoTrack.getCodec();
      if (!videoCodec) {
        throw new Error('mediabunny: 映像コーデックを判別できません');
      }
      const audioCodec = await audioTrack.getCodec();
      if (!audioCodec) {
        throw new Error('mediabunny: 音声コーデックを判別できません');
      }
      const videoDecoderConfig = await videoTrack.getDecoderConfig();
      const audioDecoderConfig = await audioTrack.getDecoderConfig();
      log.info('tracks detected:', {
        videoCodec,
        audioCodec,
        hasVideoDecoderConfig: !!videoDecoderConfig,
        hasAudioDecoderConfig: !!audioDecoderConfig
      });

      const totalDurationSec = await videoInput.computeDuration([videoTrack]).catch((e) => {
        log.warn('computeDuration failed:', e);
        return 0;
      });
      const totalMs = totalDurationSec > 0 ? totalDurationSec * 1000 : null;
      log.debug('total duration (ms):', totalMs);

      output = new Output({
        format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
        target: new FilePathTarget(opts.outputPath)
      });

      const videoSource = new EncodedVideoPacketSource(videoCodec);
      const audioSource = new EncodedAudioPacketSource(audioCodec);
      output.addVideoTrack(videoSource);
      output.addAudioTrack(audioSource);

      await output.start();
      log.debug('output started:', opts.outputPath);

      const videoSink = new EncodedPacketSink(videoTrack);
      const audioSink = new EncodedPacketSink(audioTrack);

      // AACのエンコーダ遅延(priming samples)等により先頭パケットのtimestampが負になることがある。
      // IsobmffMuxerは負のtimestampを許容しないため、トラックごとに先頭パケットの負オフセット分を
      // 全パケットからシフトして0開始に正規化する。
      let videoPacketCount = 0;
      let videoIsFirst = true;
      let videoTimestampOffset = 0;
      for await (const packet of videoSink.packets()) {
        if (opts.signal?.aborted) {
          await output.cancel();
          throw new Error('mediabunny mux aborted');
        }
        if (videoIsFirst && packet.timestamp < 0) {
          videoTimestampOffset = packet.timestamp;
          log.warn('video first packet has negative timestamp, shifting by', -videoTimestampOffset);
        }
        const adjusted = videoTimestampOffset !== 0
          ? packet.clone({ timestamp: packet.timestamp - videoTimestampOffset })
          : packet;
        await videoSource.add(
          adjusted,
          videoIsFirst && videoDecoderConfig ? { decoderConfig: videoDecoderConfig } : undefined
        );
        videoIsFirst = false;
        videoPacketCount++;
        if (videoPacketCount % 50 === 0) {
          opts.onProgress?.(Math.round(adjusted.timestamp * 1000), totalMs);
        }
      }
      videoSource.close();
      log.debug('video packets written:', videoPacketCount);

      let audioPacketCount = 0;
      let audioIsFirst = true;
      let audioTimestampOffset = 0;
      for await (const packet of audioSink.packets()) {
        if (opts.signal?.aborted) {
          await output.cancel();
          throw new Error('mediabunny mux aborted');
        }
        if (audioIsFirst && packet.timestamp < 0) {
          audioTimestampOffset = packet.timestamp;
          log.warn('audio first packet has negative timestamp, shifting by', -audioTimestampOffset);
        }
        const adjusted = audioTimestampOffset !== 0
          ? packet.clone({ timestamp: packet.timestamp - audioTimestampOffset })
          : packet;
        await audioSource.add(
          adjusted,
          audioIsFirst && audioDecoderConfig ? { decoderConfig: audioDecoderConfig } : undefined
        );
        audioIsFirst = false;
        audioPacketCount++;
      }
      audioSource.close();
      log.debug('audio packets written:', audioPacketCount);

      await output.finalize();
      const stat = fs.statSync(opts.outputPath);
      log.info('mux finalized:', opts.outputPath, `${stat.size} bytes`);
      opts.onProgress?.(totalMs ?? 0, totalMs);
    } catch (e) {
      log.error('mediabunny mux failed:', e);
      if (output && output.state !== 'finalized' && output.state !== 'canceled') {
        await output.cancel().catch((cancelErr) => {
          log.warn('output.cancel() failed during error handling:', cancelErr);
        });
      }
      throw e;
    } finally {
      videoInput.dispose();
      audioInput.dispose();
      try {
        fs.unlinkSync(videoCombined);
        fs.unlinkSync(audioCombined);
      } catch {
        // ignore
      }
    }
  }
}
