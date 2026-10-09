import fs from 'node:fs';
import path from 'node:path';
import type { LiveEvent, LiveProgramInfo, NNDDREComment } from '@shared/types';
import { VideoFileSuffix } from '@shared/constants/paths';
import { NicoContext } from '../NicoContext';
import { NicoHeaders } from '@shared/constants';
import { createLogger } from '../../util/Logger';
import { M3U8Parser } from '../video/M3U8Parser';
import { VideoDownloader, type VideoDownloadPhase } from '../video/VideoDownloader';
import { MediabunnyMuxer } from '../video/MediabunnyMuxer';
import type { HlsFetcher } from '../video/HlsFetcher';
import { LocalFileHandler, LocalFileNaming } from '../video/LocalFileHandler';
import { LiveSession, cookieMatches, type LiveStreamCookie } from './LiveSession';
import { LiveRecorder, type RecordProgress } from './LiveRecorder';
import {
  LIVE_ORIGIN,
  TIMESHIFT_ACTIVATION_REQUIRED,
  activateTimeshift,
  describeUnavailable,
  fetchLiveWatchPage
} from './LiveWatchPage';

const log = createLogger('LiveDownloader');

/** 視聴WebSocketの stream メッセージが届くまで待つ上限 */
const STREAM_WAIT_MS = 30_000;
/** 映像の取得後、過去コメントの取得完了を待つ上限 (コメントが多い番組は時間がかかる) */
const COMMENT_WAIT_MS = 10 * 60_000;
/** 録画の終了後、最後のコメントが届くのを待つ時間 */
const COMMENT_TAIL_MS = 2000;
/** 放送開始待ちで番組ページを確認する間隔 */
const START_WAIT_POLL_MS = 10_000;
/** 放送開始の予定時刻をこれだけ過ぎても始まらなければ、待つのをやめる */
const START_WAIT_GRACE_MS = 60 * 60_000;
/** 録画中に取り込む過去コメントの上限 (録画の開始前後を埋める程度でよい) */
const RECORD_ARCHIVE_MAX_MESSAGES = 3000;

export type LiveDownloadPhase = VideoDownloadPhase | 'connect' | 'waiting' | 'recording' | 'comment' | 'thumb';

/**
 * timeshift: 終了済み番組のタイムシフトを保存する
 * record: 放送中の番組を録画する (番組の終了か停止まで)
 */
export type LiveDownloadMode = 'timeshift' | 'record';

export interface LiveDownloadOptions {
  mode: LiveDownloadMode;
  /** 保存先ディレクトリ */
  saveDir: string;
  /** セグメント保存用の中間ディレクトリ */
  tempDir: string;
  /** 中断 (保存せずに終わる) */
  signal: AbortSignal;
  /** 録画の停止要求 (ここまでの録画を保存して終わる)。record のみ */
  stopSignal?: AbortSignal;
  /**
   * 放送開始からの録画 (追っかけ再生。プレミアム会員のみ)。record のみ。
   * 使えなかった場合は今からの録画にせず、エラーで終わる
   */
  fromStart?: boolean;
  /** サムネイルの URL。番組情報から取れない (放送中でサムネ未設定など) ときの代わりに、一覧で見えていたものを渡す */
  thumbnailUrl?: string;
  /**
   * タイムシフトが未予約・未視聴のとき、予約と視聴開始を自動で行うか。
   * 視聴開始で視聴期限のカウントが始まり取り消せないため、ユーザーが了承した場合のみ true にする
   */
  activateTimeshift: boolean;
  onPhaseChange?: (phase: LiveDownloadPhase, detail?: string) => void;
  /** セグメントの進捗 (映像→音声の順に、それぞれ done/total が 0 から進む)。timeshift のみ */
  onProgress?: (done: number, total: number) => void;
  /** 結合 (mux) の進捗 (処理した位置 ms / 全体の長さ ms。分からなければ null) */
  onMergeProgress?: (currentMs: number, totalMs: number | null) => void;
  /** 録画の進捗。record のみ */
  onRecordProgress?: (p: RecordProgress & { comments: number }) => void;
  /** 番組情報が分かった時点 (タイトルを DL リストに出すため) */
  onProgram?: (program: LiveProgramInfo) => void;
}

export interface LiveDownloadResult {
  program: LiveProgramInfo;
  baseName: string;
  videoPath: string;
  thumbPath: string;
  commentCount: number;
  /** 保存した動画の長さ (秒) */
  durationSec: number;
}

/** unix ms → M/D HH:MM */
function formatClock(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 生放送を動画ファイルとコメントXMLに保存する (終了済みのタイムシフト、または放送中の録画)。
 *
 * 視聴WebSocket (LiveSession) で HLS の URL と署名Cookieを受け取り、
 * タイムシフトは通常の動画DLと同じセグメント取得・結合 (VideoDownloader) を使う。
 * 放送中の録画は LiveRecorder でプレイリストを追いかけて保存し、終了後に結合する。
 * 視聴セッション (keepSeat) は取得が終わるまで維持する。
 */
export class LiveDownloader {
  static async download(programId: string, opts: LiveDownloadOptions): Promise<LiveDownloadResult> {
    const { signal } = opts;
    const record = opts.mode === 'record';
    // 予約録画などで放送開始前に呼ばれることがあるので、始まるまで待つ
    if (record) await this.waitForOnAir(programId, opts);
    opts.onPhaseChange?.('connect');

    const comments = new Map<number, NNDDREComment>();
    let cookies: LiveStreamCookie[] = [];
    // クロージャ内で差し替えるため、型の絞り込みが効くローカル変数ではなくオブジェクトに持つ
    const live: { session: LiveSession | null; streamUri: string } = { session: null, streamUri: '' };
    const streamChangeListeners: Array<() => void> = [];

    let onStream: (uri: string) => void = () => {};
    let onFatal: (e: Error) => void = () => {};
    let onArchiveDone: () => void = () => {};
    let onEnded: (reason: string) => void = () => {};
    const streamPromise = new Promise<string>((resolve, reject) => {
      onStream = resolve;
      onFatal = reject;
    });
    const archivePromise = new Promise<void>((resolve) => {
      onArchiveDone = resolve;
    });
    const endedPromise = new Promise<string>((resolve) => {
      onEnded = resolve;
    });
    // streamPromise を待つ前に reject されても未処理扱いにならないようにする
    streamPromise.catch(() => {});

    let gotStream = false;
    const addComments = (list: NNDDREComment[]): void => {
      for (const c of list) {
        if (!comments.has(c.no)) comments.set(c.no, c);
      }
    };
    const handleEvent = (ev: LiveEvent): void => {
      switch (ev.type) {
        case 'stream':
          live.streamUri = ev.uri;
          if (!gotStream && ev.uri) {
            if (record && opts.fromStart && !ev.chasePlay) {
              onFatal(new Error('追っかけ再生を利用できないため、最初からの録画はできませんでした (プレミアム会員のみ)'));
              break;
            }
            gotStream = true;
            onStream(ev.uri);
          } else if (gotStream) {
            for (const cb of streamChangeListeners) cb();
          }
          break;
        case 'archiveComments':
          addComments(ev.comments);
          if (ev.done) onArchiveDone();
          break;
        case 'comments':
          addComments(ev.comments);
          break;
        case 'accessRestricted':
          if (gotStream) onEnded(ev.message);
          else onFatal(new Error(ev.message));
          break;
        case 'state':
          if (ev.state === 'error' || ev.state === 'ended') {
            if (gotStream) onEnded(ev.message || ev.state);
            else onFatal(new Error(ev.message || '視聴セッションを開始できませんでした'));
          }
          break;
        default:
          break;
      }
    };

    const openSession = async (): Promise<Awaited<ReturnType<LiveSession['start']>>> => {
      const session = new LiveSession(
        programId,
        handleEvent,
        (c) => {
          cookies = c;
        },
        record
          ? {
              fetchAllComments: true,
              // 最初から録画するときは、開始以降のコメントが全部要る
              archiveMaxMessages: opts.fromStart ? undefined : RECORD_ARCHIVE_MAX_MESSAGES,
              startWithChasePlay: opts.fromStart
            }
          : { fetchAllComments: true }
      );
      live.session = session;
      try {
        return await session.start();
      } catch (e) {
        session.stop();
        live.session = null;
        throw e;
      }
    };

    try {
      let started;
      try {
        started = await openSession();
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        // 録画は放送中の番組が対象なので、タイムシフトの予約は関係しない
        if (record || !message.includes(`[${TIMESHIFT_ACTIVATION_REQUIRED}]`)) throw e;
        if (!opts.activateTimeshift) {
          throw new Error('タイムシフトの予約と視聴開始が必要です。生放送タブから視聴開始するか、確認の上でダウンロードしてください。');
        }
        log.info(`activate timeshift: ${programId}`);
        await activateTimeshift(programId);
        started = await openSession();
      }
      if (record && started.isTimeshift) {
        throw new Error('この番組は放送が終了しているため録画できません (タイムシフトとしてダウンロードしてください)');
      }
      if (!record && !started.isTimeshift) {
        throw new Error('放送中の番組はタイムシフトとしてダウンロードできません (録画してください)');
      }
      const program = started.program;
      opts.onProgram?.(program);
      log.info(`start ${opts.mode} ${programId}: ${program.title}`);

      const streamUri = await this.waitFor(streamPromise, STREAM_WAIT_MS, signal, 'ストリームの取得がタイムアウトしました');
      const fetcher = this.createFetcher(() => cookies);
      const baseName = LocalFileNaming.baseName(program.title, programId);
      const videoPath = path.join(opts.saveDir, `${baseName}.mp4`);
      fs.mkdirSync(opts.saveDir, { recursive: true });

      let durationSec: number;
      let commentList: NNDDREComment[];
      if (record) {
        const rec = await this.recordOnAir({
          opts,
          program,
          streamUri,
          fetcher,
          live,
          streamChangeListeners,
          endedPromise,
          archivePromise,
          videoPath,
          comments
        });
        durationSec = rec.durationSec;
        // 録画の先頭からの位置に引き直し、録画より前のコメントは落とす
        commentList = this.toRecordedComments(comments, program, rec.startTimeMs);
      } else {
        const masterText = await fetcher.getText(streamUri, signal);
        const master = M3U8Parser.parseMaster(masterText, streamUri);
        log.info(`master playlist: streams=${master.streams.length} audios=${master.audios.length}`);
        if (master.streams.length === 0) {
          log.warn(`master playlist (head): ${masterText.slice(0, 500)}`);
          throw new Error('ストリームの形式が想定と異なります (master playlist ではありません)');
        }
        await VideoDownloader.downloadFromMaster(master, {
          outputPath: videoPath,
          tempDir: opts.tempDir,
          signal,
          fetcher,
          onPhaseChange: (phase, detail) => opts.onPhaseChange?.(phase, detail),
          onProgress: opts.onProgress,
          onMergeProgress: opts.onMergeProgress
        });
        durationSec =
          program.endTimeMs > program.beginTimeMs ? Math.round((program.endTimeMs - program.beginTimeMs) / 1000) : 0;

        // 過去コメント (視聴セッションが取得を進めている)
        opts.onPhaseChange?.('comment');
        await this.waitFor(archivePromise, COMMENT_WAIT_MS, signal, '').catch((e) => {
          if (signal.aborted) throw e;
          log.warn(`comment archive wait ended without completion (${comments.size} comments):`, e);
        });
        commentList = [...comments.values()].filter((c) => !c.forwarded);
      }
      live.session?.stop();
      live.session = null;

      commentList.sort((a, b) => a.vposMs - b.vposMs || a.no - b.no);
      LocalFileHandler.writeCommentXml(
        path.join(opts.saveDir, `${baseName}${VideoFileSuffix.COMMENT_XML}`),
        commentList,
        programId,
        programId,
        'main'
      );
      log.info(`comments saved: ${commentList.length}`);

      opts.onPhaseChange?.('thumb');
      const thumbPath = path.join(opts.saveDir, `${baseName}${VideoFileSuffix.THUMB_IMAGE}`);
      // 番組情報のサムネは、放送中でサムネ未設定だとコミュニティアイコン (404 のことがある) になるので、一覧で見えていたものを優先する
      const thumbnailUrl = opts.thumbnailUrl || program.thumbnailUrl;
      log.info(`thumbnail: ${thumbnailUrl}`);
      try {
        await LocalFileHandler.downloadThumbnail(thumbnailUrl, thumbPath);
        LocalFileHandler.writeLiveThumbInfoXml(
          path.join(opts.saveDir, `${baseName}${VideoFileSuffix.THUMB_INFO_XML}`),
          { ...program, thumbnailUrl },
          commentList.length,
          durationSec
        );
      } catch (e) {
        log.warn('live thumb save failed (continuing):', e);
      }

      return { program, baseName, videoPath, thumbPath, commentCount: commentList.length, durationSec };
    } finally {
      live.session?.stop();
    }
  }

  /**
   * 放送が始まるまで待つ (番組ページに視聴 WebSocket の URL が出るまで)。
   * 録画の停止が押されたら、まだ何も録っていないのでエラーで終わる
   */
  private static async waitForOnAir(programId: string, opts: LiveDownloadOptions): Promise<void> {
    const stopSignal = opts.stopSignal;
    let announced = false;
    while (true) {
      if (opts.signal.aborted) throw new Error('aborted');
      const page = await fetchLiveWatchPage(programId);
      if (page.webSocketUrl) return;
      if (page.program.status !== 'RELEASED') throw new Error(describeUnavailable(page));
      const begin = page.program.beginTimeMs;
      if (begin > 0 && Date.now() > begin + START_WAIT_GRACE_MS) {
        throw new Error('放送の開始予定時刻を過ぎても番組が始まりませんでした');
      }
      if (!announced) {
        announced = true;
        opts.onProgram?.(page.program);
        log.info(`wait for on air: ${programId} (begin=${begin > 0 ? new Date(begin).toISOString() : '?'})`);
      }
      opts.onPhaseChange?.('waiting', begin > 0 ? `${formatClock(begin)} 開始予定` : undefined);
      await new Promise<void>((resolve) => {
        const signals = [opts.signal, ...(stopSignal ? [stopSignal] : [])];
        if (signals.some((sg) => sg.aborted)) return resolve();
        const done = (): void => {
          clearTimeout(timer);
          for (const sg of signals) sg.removeEventListener('abort', done);
          resolve();
        };
        const timer = setTimeout(done, START_WAIT_POLL_MS);
        for (const sg of signals) sg.addEventListener('abort', done);
      });
      if (stopSignal?.aborted) throw new Error('放送の開始前に録画を中止しました');
    }
  }

  /** 放送中の番組を録画して mp4 にする。コメントは視聴セッションが集めている */
  private static async recordOnAir(args: {
    opts: LiveDownloadOptions;
    program: LiveProgramInfo;
    streamUri: string;
    fetcher: HlsFetcher;
    live: { session: LiveSession | null; streamUri: string };
    streamChangeListeners: Array<() => void>;
    endedPromise: Promise<string>;
    archivePromise: Promise<void>;
    videoPath: string;
    comments: Map<number, NNDDREComment>;
  }): Promise<{ durationSec: number; startTimeMs: number }> {
    const { opts, fetcher, live } = args;
    const stopSignal = opts.stopSignal ?? new AbortController().signal;
    opts.onPhaseChange?.('recording');
    const rec = await LiveRecorder.record({
      fetcher,
      streamUri: () => live.streamUri || args.streamUri,
      onStreamUriChange: (cb) => args.streamChangeListeners.push(cb),
      ended: args.endedPromise,
      signal: opts.signal,
      stopSignal,
      tempDir: opts.tempDir,
      onProgress: (p) => opts.onRecordProgress?.({ ...p, comments: args.comments.size })
    });
    log.info(
      `recording stopped (${rec.stopReason}) fromStart=${opts.fromStart ?? false} ` +
        `startOffsetFromProgramBegin=${args.program.beginTimeMs > 0 ? Math.round((rec.startTimeMs - args.program.beginTimeMs) / 1000) : '?'}s`
    );

    // 結合は録画が終わった時点ですぐ始める (停止後に何も起きないように見えないよう、状態もすぐ切り替える)
    const stoppedAt = Date.now();
    opts.onPhaseChange?.('merge');
    // 録画は先頭のタイムスタンプが番組開始からの経過時間なので、0 に揃えて結合する (mediabunny のみ対応)
    await MediabunnyMuxer.merge({
      videoInitPath: rec.videoInitPath,
      videoSegmentPaths: rec.videoSegmentPaths,
      audioInitPath: rec.audioInitPath,
      audioSegmentPaths: rec.audioSegmentPaths,
      outputPath: args.videoPath,
      tempDir: opts.tempDir,
      normalizeStart: true,
      signal: opts.signal,
      onProgress: opts.onMergeProgress
    });

    // 最後のコメントが届くのを少し待つ (結合している間に過ぎた分は差し引く)
    const tailMs = COMMENT_TAIL_MS - (Date.now() - stoppedAt);
    if (tailMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, tailMs));
    if (opts.fromStart) {
      // 最初から録画したときは、録画の開始以降の過去コメントを取り切るまで待つ
      opts.onPhaseChange?.('comment');
      await this.waitFor(args.archivePromise, COMMENT_WAIT_MS, opts.signal, '').catch((e) => {
        if (opts.signal.aborted) throw e;
        log.warn(`comment archive wait ended without completion (${args.comments.size} comments):`, e);
      });
    }
    live.session?.stop();
    live.session = null;

    return { durationSec: Math.round(rec.durationSec), startTimeMs: rec.startTimeMs };
  }

  /** 録画したコメントを、録画の先頭を 0 とする位置に引き直す。転送コメントと録画開始より前のコメントは除く */
  private static toRecordedComments(
    comments: Map<number, NNDDREComment>,
    program: LiveProgramInfo,
    startTimeMs: number
  ): NNDDREComment[] {
    const base = program.vposBaseTimeMs;
    const out: NNDDREComment[] = [];
    for (const c of comments.values()) {
      if (c.forwarded) continue;
      // vpos は番組の基準時刻からの位置。基準時刻が不明なら投稿時刻で代用する
      const absMs = base > 0 ? base + c.vposMs : c.date * 1000;
      const rel = absMs - startTimeMs;
      if (rel < 0) continue;
      out.push({ ...c, vposMs: rel });
    }
    return out;
  }

  /** 署名Cookie (パス別) を付けて CDN から取得する */
  private static createFetcher(getCookies: () => LiveStreamCookie[]): HlsFetcher {
    const request = async (url: string, signal?: AbortSignal): Promise<Response> => {
      const target = new URL(url);
      const cookie = getCookies()
        .filter((c) => cookieMatches(c, target))
        .map((c) => `${c.name}=${c.value}`)
        .join('; ');
      const res = await NicoContext.get().http.fetch(url, {
        headers: {
          'User-Agent': NicoHeaders.USER_AGENT,
          Origin: LIVE_ORIGIN,
          Referer: `${LIVE_ORIGIN}/`,
          ...(cookie ? { Cookie: cookie } : {})
        },
        noCookie: true,
        noCookieReceive: true,
        signal
      });
      if (!res.ok) throw new Error(`GET ${url} failed: HTTP ${res.status}`);
      return res;
    };
    return {
      getText: async (url, signal) => (await request(url, signal)).text(),
      getBinary: async (url, signal) => Buffer.from(await (await request(url, signal)).arrayBuffer())
    };
  }

  private static waitFor<T>(p: Promise<T>, timeoutMs: number, signal: AbortSignal, timeoutMessage: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => finish(() => reject(new Error(timeoutMessage || 'timeout'))), timeoutMs);
      const onAbort = (): void => finish(() => reject(new Error('aborted')));
      const finish = (fn: () => void): void => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        fn();
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort);
      p.then(
        (v) => finish(() => resolve(v)),
        (e) => finish(() => reject(e))
      );
    });
  }
}
