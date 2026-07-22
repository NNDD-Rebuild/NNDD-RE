import { EventEmitter } from 'node:events';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { v4 as uuidv4 } from 'uuid';
import type {
  DownloadQueueItem,
  DownloadStatusTypeValue,
  NNDDREVideo,
  WatchPageInfo
} from '@shared/types';
import { DownloadStatusType } from '@shared/types';
import { WatchInfoHandler } from '../nicovideo/watch/WatchInfoHandler';
import { CommentClient } from '../nicovideo/comment/CommentClient';
import { YtDlpDownloader } from '../nicovideo/video/YtDlpDownloader';
import { VideoDownloader } from '../nicovideo/video/VideoDownloader';
import type { VideoDownloadPhase } from '../nicovideo/video/VideoDownloader';
import {
  LocalFileHandler,
  LocalFileNaming
} from '../nicovideo/video/LocalFileHandler';
import { LibraryManager } from '../db/LibraryManager';
import { getConfigStore } from '../config/ConfigStore';
import { createLogger } from '../util/Logger';

const log = createLogger('DownloadManager');

const NATIVE_PHASE_LABEL: Record<VideoDownloadPhase, string> = {
  session: 'セッション確立中',
  master_playlist: 'マスタープレイリスト解析中',
  variant_playlist: 'ストリーム選択中',
  key: '暗号鍵取得中',
  video_segments: '映像セグメントDL中',
  audio_segments: '音声セグメントDL中',
  merge: 'FFmpegで結合中',
  done: '完了'
};

const NATIVE_PHASE_STATUS: Partial<Record<VideoDownloadPhase, DownloadStatusTypeValue>> = {
  master_playlist: DownloadStatusType.MASTER_PLAYLIST,
  variant_playlist: DownloadStatusType.MASTER_PLAYLIST,
  key: DownloadStatusType.KEY,
  video_segments: DownloadStatusType.SEGMENT,
  audio_segments: DownloadStatusType.SEGMENT,
  merge: DownloadStatusType.MERGE
};

export interface EnqueueOptions {
  videoId: string;
  /** 保存先 (空なら設定のlibraryRoot/downloads) */
  saveDir?: string;
  /** コメントのみ */
  commentOnly?: boolean;
  /** 音声のみ (.m4a、映像トラックなし) */
  audioOnly?: boolean;
}

/**
 * ダウンロードキューマネージャ。
 *
 * 元: src/org/mineap/nndd/download/DownloadManager.as
 *  - キュー (ArrayCollection) + 同時並行数制限
 *  - ステータスイベント発火
 *  - リトライ
 *  - 永続化 (Phase 1 完了後の拡張)
 *
 * メインプロセスで動作し、IPC で renderer に進捗を流す。
 */
export class DownloadManager extends EventEmitter {
  private queue: DownloadQueueItem[] = [];
  private running = new Map<string, AbortController>();
  private maxConcurrent: number;
  private isProcessing = false;

  constructor(private readonly library: LibraryManager) {
    super();
    this.maxConcurrent = getConfigStore().get('maxConcurrentDownloads') ?? 2;
  }

  list(): DownloadQueueItem[] {
    return [...this.queue];
  }

  enqueue(opts: EnqueueOptions): DownloadQueueItem {
    const item: DownloadQueueItem = {
      id: uuidv4(),
      videoId: opts.videoId,
      videoName: opts.videoId,
      status: DownloadStatusType.WAIT,
      progress: 0,
      message: '',
      retryCount: 0,
      saveDir:
        opts.saveDir ??
        this.library.videoDir,
      isCommentOnly: opts.commentOnly ?? false,
      isAudioOnly: opts.audioOnly ?? false,
      startTime: null,
      endTime: null,
      errorMessage: null
    };
    this.queue.push(item);
    this.emit('change', item);
    this.tick();
    return item;
  }

  cancel(id: string): boolean {
    const ac = this.running.get(id);
    if (ac) {
      ac.abort();
      return true;
    }
    const idx = this.queue.findIndex((q) => q.id === id);
    if (idx >= 0 && this.queue[idx].status === DownloadStatusType.WAIT) {
      this.updateStatus(this.queue[idx], DownloadStatusType.CANCELED);
      return true;
    }
    return false;
  }

  remove(id: string): boolean {
    const idx = this.queue.findIndex((q) => q.id === id);
    if (idx < 0) return false;
    const item = this.queue[idx];
    if (
      item.status === DownloadStatusType.LOGIN ||
      item.status === DownloadStatusType.WATCH ||
      item.status === DownloadStatusType.VIDEO ||
      item.status === DownloadStatusType.MASTER_PLAYLIST ||
      item.status === DownloadStatusType.KEY ||
      item.status === DownloadStatusType.SEGMENT ||
      item.status === DownloadStatusType.MERGE
    ) {
      return false; // 実行中は削除不可
    }
    this.queue.splice(idx, 1);
    this.emit('change', { ...item, status: DownloadStatusType.CANCELED });
    return true;
  }

  retry(id: string): boolean {
    const item = this.queue.find((q) => q.id === id);
    if (!item) return false;
    if (
      item.status === DownloadStatusType.FAIL ||
      item.status === DownloadStatusType.CANCELED
    ) {
      item.status = DownloadStatusType.WAIT;
      item.progress = 0;
      item.errorMessage = null;
      item.retryCount = 0;
      this.emit('change', item);
      this.tick();
      return true;
    }
    return false;
  }

  clearCompleted(): void {
    this.queue = this.queue.filter(
      (q) =>
        q.status !== DownloadStatusType.SUCCESS &&
        q.status !== DownloadStatusType.SKIPPED
    );
    this.emit('changeAll', this.list());
  }

  /**
   * キューを進める。
   */
  private async tick(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;
    try {
      while (true) {
        if (this.running.size >= this.maxConcurrent) break;
        const next = this.queue.find(
          (q) => q.status === DownloadStatusType.WAIT
        );
        if (!next) break;
        // WAIT → WATCH に先行して変更し、同一アイテムの重複起動を防ぐ
        next.status = DownloadStatusType.WATCH;
        this.runItem(next).catch((e) => {
          log.error('runItem unexpected error:', e);
        });
      }
    } finally {
      this.isProcessing = false;
    }
  }

  private async runItem(item: DownloadQueueItem): Promise<void> {
    const ac = new AbortController();
    this.running.set(item.id, ac);
    item.startTime = new Date();
    try {
      this.updateStatus(item, DownloadStatusType.WATCH);
      const watch = await WatchInfoHandler.fetchWatchInfoRaw(item.videoId);
      item.videoName = watch.title;
      this.emit('change', item);

      const baseDir = item.saveDir;
      fs.mkdirSync(baseDir, { recursive: true });
      const baseName = LocalFileNaming.baseName(watch.title, watch.videoId);
      const skipComments = item.isAudioOnly && (getConfigStore().get('skipCommentsOnAudioOnly') ?? false);

      // コメント取得
      // コメント全量取得 (過去ログ含む — fetchAllComments でループ遡り)
      this.updateStatus(item, DownloadStatusType.COMMENT);
      if (!skipComments && getConfigStore().get('downloadAllComments') !== false) {
      try {
        const comments = await CommentClient.fetchAllComments(watch, {
          includeEasy: getConfigStore().get('downloadEasyComments') ?? false,
          comment429RetryWaitSec: getConfigStore().get('comment429RetryWaitSec') ?? 60,
          signal: ac.signal,
          onProgress: (msg) => {
            item.message = msg;
            this.emit('change', item);
          }
        });
        const threadId =
          watch.commentThreads.find((t) => t.fork === 'main')?.id ??
          watch.commentThreads[0]?.id ??
          '';
        LocalFileHandler.writeCommentXml(
          path.join(
            baseDir,
            LocalFileNaming.commentXmlFileName(watch.title, watch.videoId)
          ),
          comments.filter((c) => c.fork !== 'owner'),
          threadId,
          watch.videoId,
          'main'
        );
        const ownerComments = comments.filter((c) => c.fork === 'owner');
        const ownerThread =
          watch.commentThreads.find((t) => t.fork === 'owner')?.id ?? '';
        LocalFileHandler.writeCommentXml(
          path.join(
            baseDir,
            LocalFileNaming.ownerCommentXmlFileName(watch.title, watch.videoId)
          ),
          ownerComments,
          ownerThread,
          watch.videoId,
          'owner'
        );
      } catch (e) {
        log.warn('comment download failed (continuing):', e);
      }
      } // downloadAllComments

      // [NowComment].json: fetchComments (ストリーミング今コメ相当) の no 一覧を保存
      // → ローカル再生時に fetchAllComments XML から今コメを再現するために使用
      if (!skipComments) {
      try {
        const nowComments = await CommentClient.fetchComments(watch);
        LocalFileHandler.writeNowCommentJson(
          path.join(baseDir, LocalFileNaming.nowCommentJsonFileName(watch.title, watch.videoId)),
          nowComments.map((c) => c.no)
        );
        // 全件取得オフ時は上のfetchAllCommentsブロックが実行されず通常コメントXMLが
        // 生成されないため、今コメの内容をそのまま通常コメントXMLとしても書き出す
        if (getConfigStore().get('downloadAllComments') === false) {
          const threadId =
            watch.commentThreads.find((t) => t.fork === 'main')?.id ??
            watch.commentThreads[0]?.id ??
            '';
          LocalFileHandler.writeCommentXml(
            path.join(
              baseDir,
              LocalFileNaming.commentXmlFileName(watch.title, watch.videoId)
            ),
            nowComments.filter((c) => c.fork !== 'owner'),
            threadId,
            watch.videoId,
            'main'
          );
          const ownerNowComments = nowComments.filter((c) => c.fork === 'owner');
          const ownerThread =
            watch.commentThreads.find((t) => t.fork === 'owner')?.id ?? '';
          LocalFileHandler.writeCommentXml(
            path.join(
              baseDir,
              LocalFileNaming.ownerCommentXmlFileName(watch.title, watch.videoId)
            ),
            ownerNowComments,
            ownerThread,
            watch.videoId,
            'owner'
          );
        }
      } catch (e) {
        log.warn('now comment fetch failed (continuing):', e);
      }
      } // skipComments

      // サムネ取得
      this.updateStatus(item, DownloadStatusType.THUMB);
      try {
        const thumbUrl = watch.thumbnail.largeUrl || watch.thumbnail.url;
        await LocalFileHandler.downloadThumbnail(
          thumbUrl,
          path.join(
            baseDir,
            LocalFileNaming.thumbImageFileName(watch.title, watch.videoId)
          )
        );
        LocalFileHandler.writeThumbInfoXml(
          path.join(
            baseDir,
            LocalFileNaming.thumbInfoXmlFileName(watch.title, watch.videoId)
          ),
          watch
        );
      } catch (e) {
        log.warn('thumb download failed (continuing):', e);
      }

      // 動画ダウンロード (コメントのみモードでなければ)
      if (!item.isCommentOnly) {
        const ext = item.isAudioOnly ? 'm4a' : 'mp4';
        const outputPath = path.join(
          baseDir,
          LocalFileNaming.videoFileName(watch.title, watch.videoId, ext)
        );

        this.updateStatus(item, DownloadStatusType.VIDEO);
        await this.downloadVideoWithFallback(item, watch, outputPath, ac.signal);

        // ライブラリに登録
        const video: NNDDREVideo = {
          id: 0,
          uri: outputPath,
          videoName: `${baseName}.${ext}`,
          tagStrings: watch.tags,
          modificationDate: new Date(),
          creationDate: new Date(),
          thumbUrl: path.join(
            baseDir,
            LocalFileNaming.thumbImageFileName(watch.title, watch.videoId)
          ),
          playCount: 0,
          time: watch.duration,
          lastPlayDate: null,
          yetReading: true,
          pubDate: watch.registeredAt ? new Date(watch.registeredAt) : null
        };
        const dirId = this.library.videoDao.ensureFileDir(baseDir);
        this.library.videoDao.insertOrUpdate(video, dirId);
      }

      // ファイル検証: 不足ファイルがあれば補完キューに追加
      if (!item.isCommentOnly) {
        const videoPath = path.join(
          baseDir,
          LocalFileNaming.videoFileName(watch.title, watch.videoId, item.isAudioOnly ? 'm4a' : 'mp4')
        );
        if (!fs.existsSync(videoPath)) {
          throw new Error(`動画ファイルが見つかりません (DL後検証): ${videoPath}`);
        }

        const missingSecondary: string[] = [];
        if (!skipComments) {
          if (getConfigStore().get('downloadAllComments') !== false) {
            const p = path.join(baseDir, LocalFileNaming.commentXmlFileName(watch.title, watch.videoId));
            if (!fs.existsSync(p)) missingSecondary.push('コメントXML');
          }
          const nowCommentPath = path.join(baseDir, LocalFileNaming.nowCommentJsonFileName(watch.title, watch.videoId));
          if (!fs.existsSync(nowCommentPath)) missingSecondary.push('今コメJSON');
        }
        const thumbInfoPath = path.join(baseDir, LocalFileNaming.thumbInfoXmlFileName(watch.title, watch.videoId));
        if (!fs.existsSync(thumbInfoPath)) missingSecondary.push('ThumbInfo');
        const thumbImagePath = path.join(baseDir, LocalFileNaming.thumbImageFileName(watch.title, watch.videoId));
        if (!fs.existsSync(thumbImagePath)) missingSecondary.push('サムネ');

        if (missingSecondary.length > 0) {
          log.warn(`DL後に不足ファイル検出 (${missingSecondary.join(', ')}) — commentOnly で再キュー`);
          this.enqueue({ videoId: watch.videoId, saveDir: baseDir, commentOnly: true });
        }
      }

      this.updateStatus(item, DownloadStatusType.SUCCESS);
      item.progress = 1;
      item.endTime = new Date();
      this.emit('change', item);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      item.errorMessage = msg;
      if (ac.signal.aborted) {
        this.updateStatus(item, DownloadStatusType.CANCELED);
      } else if (
        item.retryCount < (getConfigStore().get('downloadRetryCount') ?? 3)
      ) {
        item.retryCount++;
        log.warn(`download fail, retry ${item.retryCount}:`, msg);
        item.status = DownloadStatusType.WAIT;
        this.emit('change', item);
      } else {
        this.updateStatus(item, DownloadStatusType.FAIL);
      }
    } finally {
      this.running.delete(item.id);
      // 成功完了時はクールダウン待機してから次のアイテムを開始
      const cooldownMs = getConfigStore().get('downloadCooldownMs') ?? 0;
      if (cooldownMs > 0 && item.status === DownloadStatusType.SUCCESS) {
        await new Promise<void>((resolve) => setTimeout(resolve, cooldownMs));
      }
      this.tick();
    }
  }

  /**
   * 動画本体のダウンロード。
   * useNativeVideoDownloader が有効ならまずネイティブHLS実装 (yt-dlp非依存) を試し、
   * 失敗時 (キャンセルを除く) は yt-dlp にフォールバックする。
   */
  private async downloadVideoWithFallback(
    item: DownloadQueueItem,
    watch: WatchPageInfo,
    outputPath: string,
    signal: AbortSignal
  ): Promise<void> {
    const useNative = getConfigStore().get('useNativeVideoDownloader') ?? true;

    if (item.isAudioOnly) {
      if (!useNative) {
        throw new Error(
          '音声のみダウンロードは yt-dlp フォールバックに対応していません。設定の「ネイティブ動画ダウンローダーを使用」を有効にしてください。'
        );
      }
      const tempDir = path.join(os.tmpdir(), 'nndd-video-dl', item.id);
      try {
        await VideoDownloader.download(watch, {
          outputPath,
          tempDir,
          signal,
          audioOnly: true,
          onPhaseChange: (phase) => {
            item.message = phase === 'merge' ? '音声セグメント結合中' : NATIVE_PHASE_LABEL[phase];
            const status = NATIVE_PHASE_STATUS[phase];
            if (status) {
              this.updateStatus(item, status);
            } else {
              this.emit('change', item);
            }
            if (phase === 'merge') item.progress = 0.95;
          },
          onProgress: (done, total) => {
            if (total <= 0) return;
            const pct = done / total;
            item.progress = pct * 0.9;
            item.message = `${NATIVE_PHASE_LABEL['audio_segments']} ${(item.progress * 100).toFixed(1)}% (${done}/${total})`;
            this.emit('change', item);
          }
        });
      } finally {
        fs.promises.rm(tempDir, { recursive: true, force: true }).catch((e) => {
          log.warn('native audio download tempDir cleanup failed:', e);
        });
      }
      return;
    }

    if (useNative) {
      const tempDir = path.join(os.tmpdir(), 'nndd-video-dl', item.id);
      const muxImpl = getConfigStore().get('downloadMuxImplementation') ?? 'ffmpeg';
      let currentPhase: VideoDownloadPhase = 'session';
      try {
        await VideoDownloader.download(watch, {
          outputPath,
          tempDir,
          signal,
          onPhaseChange: (phase) => {
            currentPhase = phase;
            item.message = phase === 'merge'
              ? (muxImpl === 'mediabunny' ? 'mediabunnyで結合中' : NATIVE_PHASE_LABEL[phase])
              : NATIVE_PHASE_LABEL[phase];
            const status = NATIVE_PHASE_STATUS[phase];
            if (status) {
              this.updateStatus(item, status);
            } else {
              this.emit('change', item);
            }
            if (phase === 'merge') item.progress = 0.95;
          },
          onProgress: (done, total) => {
            if (total <= 0) return;
            const pct = done / total;
            item.progress = currentPhase === 'audio_segments' ? 0.5 + pct * 0.5 : pct * 0.5;
            item.message = `${NATIVE_PHASE_LABEL[currentPhase]} ${(item.progress * 100).toFixed(1)}% (${done}/${total})`;
            this.emit('change', item);
          }
        });
        return;
      } catch (e) {
        if (signal.aborted) throw e;
        if (muxImpl === 'mediabunny') {
          log.error(`native video download (mediabunny mux) failed for ${item.videoId}:`, e);
          throw e; // 動作検証中はyt-dlpフォールバックさせず原因を明示する
        }
        const msg = e instanceof Error ? e.message : String(e);
        log.warn(`native video download failed for ${item.videoId}, falling back to yt-dlp:`, msg);
        item.message = `ネイティブDL失敗 (${msg}) → yt-dlpにフォールバック`;
        item.progress = 0;
        this.updateStatus(item, DownloadStatusType.VIDEO);
        try { fs.unlinkSync(outputPath); } catch { /* なければ無視 */ }
      } finally {
        fs.promises.rm(tempDir, { recursive: true, force: true }).catch((e) => {
          log.warn('native download tempDir cleanup failed:', e);
        });
      }
    }

    await YtDlpDownloader.download(watch.videoId, {
      outputPath,
      signal,
      onProgress: (percent, speed, eta) => {
        item.progress = percent / 100;
        item.message = speed ? `${percent.toFixed(1)}% ${speed} ETA ${eta}` : `${percent.toFixed(1)}%`;
        this.emit('change', item);
      }
    });
  }

  private updateStatus(
    item: DownloadQueueItem,
    status: DownloadStatusTypeValue
  ): void {
    item.status = status;
    this.emit('change', item);
  }
}
