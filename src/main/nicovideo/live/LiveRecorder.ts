import fs from 'node:fs';
import path from 'node:path';
import type { HlsKeyInfo, HlsSegment } from '@shared/types';
import { createLogger } from '../../util/Logger';
import { M3U8Parser } from '../video/M3U8Parser';
import { SegmentDownloader } from '../video/SegmentDownloader';
import type { HlsFetcher } from '../video/HlsFetcher';

const log = createLogger('LiveRecorder');

/** プレイリストを取り直す間隔の範囲 (ms)。target duration の半分を基準にする */
const POLL_MIN_MS = 500;
const POLL_MAX_MS = 3000;
/** セグメントを同時に取得する数 */
const SEGMENT_CONCURRENCY = 4;
/** 取得に連続して失敗したら録画を打ち切る回数 */
const MAX_CONSECUTIVE_FAILURES = 20;
/** 番組終了を知ってから、ENDLIST が見えなくても取得をやめるまでの猶予 */
const ENDED_GRACE_MS = 20_000;

export interface RecordProgress {
  /** 録画できた映像の長さ (秒) */
  elapsedSec: number;
  /** 取得したバイト数 (映像+音声) */
  bytes: number;
}

export interface RecordContext {
  fetcher: HlsFetcher;
  /** 現在の master playlist の URL (再接続で変わることがある) */
  streamUri: () => string;
  /** master playlist の URL が変わったとき (再接続) に呼ばれる登録 */
  onStreamUriChange: (cb: () => void) => void;
  /** 番組の終了、または視聴セッションが切れたときに解決する (reject しない) */
  ended: Promise<string>;
  /** 中断 (録画を破棄する) */
  signal: AbortSignal;
  /** 停止 (ここまでの録画を保存する) */
  stopSignal: AbortSignal;
  /** セグメント保存用の中間ディレクトリ */
  tempDir: string;
  onProgress?: (p: RecordProgress) => void;
}

export interface RecordResult {
  videoInitPath: string;
  videoSegmentPaths: string[];
  audioInitPath: string;
  audioSegmentPaths: string[];
  /** 録画の先頭の時刻 (unix ms)。コメントの vpos をこの位置基準に引き直すために使う */
  startTimeMs: number;
  /** 録画できた映像の長さ (秒) */
  durationSec: number;
  stopReason: 'endlist' | 'program-ended' | 'stopped' | 'error';
}

/** 映像 1 本 or 音声 1 本の録画状態 */
class TrackRecorder {
  readonly files: string[] = [];
  initPath: string | null = null;
  /** 取得済みの最大のメディアシーケンス番号 */
  private lastSeq = -1;
  firstProgramDateTimeMs: number | undefined;
  /** 最初に取得したときの壁時計の時刻と、そのとき手に入れた分の長さ (PROGRAM-DATE-TIME が無いときの推定用) */
  firstFetchWallMs = 0;
  firstWindowSec = 0;
  durationSec = 0;
  bytes = 0;
  private readonly keys = new Map<string, Buffer>();

  constructor(
    readonly name: 'video' | 'audio',
    private readonly dir: string,
    private readonly fetcher: HlsFetcher,
    private readonly getUrl: () => string,
    private readonly signal: AbortSignal
  ) {
    fs.mkdirSync(dir, { recursive: true });
  }

  /**
   * プレイリストを 1 回取得し、まだ持っていないセグメントを保存する。
   * 追っかけ再生で最初から録るときは窓が番組の長さ分あるので、並列で取得する
   * @param shouldStop true を返したら、取得済みの分まで保存して戻る
   */
  async poll(
    shouldStop: () => boolean,
    onProgress: () => void
  ): Promise<{ endList: boolean; targetDuration: number }> {
    const url = this.getUrl();
    const text = await this.fetcher.getText(url, this.signal);
    const v = M3U8Parser.parseVariant(text, url);
    if (this.firstFetchWallMs === 0) {
      this.firstFetchWallMs = Date.now();
      this.firstWindowSec = v.segments.reduce((sum, s) => sum + s.duration, 0);
      log.info(
        `${this.name}: first playlist segments=${v.segments.length} window=${this.firstWindowSec.toFixed(0)}s ` +
          `seq=${v.mediaSequence} firstPdt=${v.segments[0]?.programDateTimeMs ? new Date(v.segments[0].programDateTimeMs).toISOString() : '-'}`
      );
    }

    if (!this.initPath && v.mapUrl) {
      const initPath = path.join(this.dir, 'init.mp4');
      const buf = await this.fetcher.getBinary(v.mapUrl, this.signal);
      fs.writeFileSync(initPath, buf);
      this.initPath = initPath;
      this.bytes += buf.length;
    }

    const todo: Array<{ seq: number; seg: HlsSegment }> = [];
    v.segments.forEach((seg, i) => {
      const seq = v.mediaSequence + i;
      if (seq > this.lastSeq) todo.push({ seq, seg });
    });
    for (let i = 0; i < todo.length; i += SEGMENT_CONCURRENCY) {
      if (shouldStop()) break;
      const chunk = todo.slice(i, i + SEGMENT_CONCURRENCY);
      if (this.lastSeq >= 0 && chunk[0].seq > this.lastSeq + 1) {
        log.warn(`${this.name}: segments missing (${this.lastSeq + 1}..${chunk[0].seq - 1})`);
      }
      await Promise.all(chunk.map(({ seq, seg }) => this.downloadSegment(seq, seg)));
      for (const { seq, seg } of chunk) {
        const file = path.join(this.dir, segmentFileName(seq));
        this.lastSeq = seq;
        this.files.push(file);
        this.durationSec += seg.duration;
        this.bytes += fs.statSync(file).size;
        if (this.firstProgramDateTimeMs === undefined && seg.programDateTimeMs !== undefined) {
          this.firstProgramDateTimeMs = seg.programDateTimeMs;
        }
      }
      onProgress();
    }
    return { endList: v.endList, targetDuration: v.targetDuration };
  }

  private async downloadSegment(seq: number, seg: HlsSegment): Promise<void> {
    // 鍵は途中で切り替わるので、セグメントごとの鍵で復号する
    const key = seg.key ? await this.loadKey(seg.key) : undefined;
    // IV が無い暗号化 HLS は、仕様上メディアシーケンス番号を IV にする
    const iv = key ? (seg.key?.iv ? parseIv(seg.key.iv) : sequenceIv(seq)) : undefined;
    await SegmentDownloader.downloadOne(
      { ...seg, filename: segmentFileName(seq) },
      { outputDir: this.dir, key, iv, fetcher: this.fetcher, signal: this.signal, maxRetries: 2, retryWaitMs: 500 }
    );
  }

  private async loadKey(info: HlsKeyInfo): Promise<Buffer> {
    let key = this.keys.get(info.url);
    if (!key) {
      key = await this.fetcher.getBinary(info.url, this.signal);
      this.keys.set(info.url, key);
    }
    return key;
  }
}

function segmentFileName(seq: number): string {
  return `${String(seq).padStart(8, '0')}.m4s`;
}

function parseIv(ivHex: string): Buffer {
  let s = ivHex.trim();
  if (s.startsWith('0x') || s.startsWith('0X')) s = s.slice(2);
  if (s.length < 32) s = s.padStart(32, '0');
  return Buffer.from(s, 'hex');
}

/** HLS 仕様の既定 IV: メディアシーケンス番号を 128bit ビッグエンディアンにしたもの */
function sequenceIv(seq: number): Buffer {
  const iv = Buffer.alloc(16);
  iv.writeBigUInt64BE(BigInt(seq), 8);
  return iv;
}

/**
 * 放送中の番組を HLS から録画する。
 *
 * master playlist から最高画質の映像・音声を選び、それぞれの playlist を繰り返し取得して
 * 新しいセグメントを保存していく。ENDLIST、番組の終了、または停止要求で終わる。
 * 結合 (mp4 化) は呼び出し側で行う。
 */
export class LiveRecorder {
  static async record(ctx: RecordContext): Promise<RecordResult> {
    const urls = { video: '', audio: '' };
    const refreshUrls = async (): Promise<void> => {
      const masterUri = ctx.streamUri();
      const text = await ctx.fetcher.getText(masterUri, ctx.signal);
      const master = M3U8Parser.parseMaster(text, masterUri);
      if (master.streams.length === 0) {
        log.warn(`master playlist (head): ${text.slice(0, 500)}`);
        throw new Error('ストリームの形式が想定と異なります (master playlist ではありません)');
      }
      const video = [...master.streams].sort((a, b) => b.bandwidth - a.bandwidth)[0];
      const audio = master.audios.find((a) => a.groupId === video.audioGroupId) ?? master.audios[0];
      if (!audio) throw new Error('音声ストリームが見つかりません');
      urls.video = video.url;
      urls.audio = audio.url;
      log.info(`record variants: bandwidth=${video.bandwidth} resolution=${video.resolution}`);
    };
    await refreshUrls();
    // 再接続で stream が送り直されたら、新しい URL に差し替える (失敗しても今の URL で続ける)
    ctx.onStreamUriChange(() => {
      refreshUrls().catch((e) => log.warn('refresh variant urls failed:', e));
    });

    const video = new TrackRecorder('video', path.join(ctx.tempDir, 'video'), ctx.fetcher, () => urls.video, ctx.signal);
    const audio = new TrackRecorder('audio', path.join(ctx.tempDir, 'audio'), ctx.fetcher, () => urls.audio, ctx.signal);

    let programEndedAt = 0;
    void ctx.ended.then((reason) => {
      programEndedAt = Date.now();
      log.info(`program ended: ${reason}`);
    });

    const reportProgress = (): void =>
      ctx.onProgress?.({ elapsedSec: video.durationSec, bytes: video.bytes + audio.bytes });

    const runTrack = async (t: TrackRecorder): Promise<RecordResult['stopReason']> => {
      let failures = 0;
      while (true) {
        if (ctx.signal.aborted) throw new Error('aborted');
        if (ctx.stopSignal.aborted) return 'stopped';
        let intervalMs = POLL_MIN_MS * 2;
        try {
          const r = await t.poll(() => ctx.stopSignal.aborted, reportProgress);
          failures = 0;
          reportProgress();
          if (r.endList) return 'endlist';
          intervalMs = Math.min(POLL_MAX_MS, Math.max(POLL_MIN_MS, r.targetDuration * 500));
        } catch (e) {
          if (ctx.signal.aborted) throw e;
          failures++;
          log.warn(`${t.name} poll failed (${failures}/${MAX_CONSECUTIVE_FAILURES}):`, e);
          if (failures >= MAX_CONSECUTIVE_FAILURES) return 'error';
        }
        if (programEndedAt > 0 && Date.now() - programEndedAt > ENDED_GRACE_MS) return 'program-ended';
        await sleep(intervalMs, ctx.signal, ctx.stopSignal);
      }
    };

    const [videoReason, audioReason] = await Promise.all([runTrack(video), runTrack(audio)]);
    const stopReason = videoReason === 'error' || audioReason === 'error' ? 'error' : videoReason;

    if (!video.initPath || !audio.initPath || video.files.length === 0 || audio.files.length === 0) {
      throw new Error('録画できた映像・音声がありません');
    }

    // 映像・音声のうち早い方の先頭が、結合後の先頭 (mediabunny で 0 に揃える) になる
    const pdts = [video.firstProgramDateTimeMs, audio.firstProgramDateTimeMs].filter((t): t is number => t !== undefined);
    let startTimeMs: number;
    if (pdts.length > 0) {
      startTimeMs = Math.min(...pdts);
    } else {
      startTimeMs = Math.round(video.firstFetchWallMs - video.firstWindowSec * 1000);
      log.warn('PROGRAM-DATE-TIME が無いため、録画の開始時刻を取得時刻から推定します');
    }
    log.info(
      `record finished (${stopReason}): video=${video.files.length} audio=${audio.files.length} ` +
        `duration=${video.durationSec.toFixed(1)}s start=${new Date(startTimeMs).toISOString()}`
    );
    return {
      videoInitPath: video.initPath,
      videoSegmentPaths: video.files,
      audioInitPath: audio.initPath,
      audioSegmentPaths: audio.files,
      startTimeMs,
      durationSec: video.durationSec,
      stopReason
    };
  }
}

/** ms 待つ。中断・停止で早く戻る (中断は呼び出し側が次のループで検出する) */
function sleep(ms: number, ...signals: AbortSignal[]): Promise<void> {
  return new Promise((resolve) => {
    if (signals.some((s) => s.aborted)) {
      resolve();
      return;
    }
    const done = (): void => {
      clearTimeout(timer);
      for (const s of signals) s.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    for (const s of signals) s.addEventListener('abort', done);
  });
}
