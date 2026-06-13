import { EventEmitter } from 'node:events';
import path from 'node:path';
import fs from 'node:fs';
import { v4 as uuidv4 } from 'uuid';
import type {
  DownloadQueueItem,
  DownloadStatusTypeValue,
  NNDDREVideo
} from '@shared/types';
import { DownloadStatusType } from '@shared/types';
import { WatchInfoHandler } from '../nicovideo/watch/WatchInfoHandler';
import { CommentClient } from '../nicovideo/comment/CommentClient';
import { YtDlpDownloader } from '../nicovideo/video/YtDlpDownloader';
import {
  LocalFileHandler,
  LocalFileNaming
} from '../nicovideo/video/LocalFileHandler';
import { LibraryManager } from '../db/LibraryManager';
import { getConfigStore } from '../config/ConfigStore';
import { createLogger } from '../util/Logger';

const log = createLogger('DownloadManager');

export interface EnqueueOptions {
  videoId: string;
  /** 保存先 (空なら設定のlibraryRoot/downloads) */
  saveDir?: string;
  /** コメントのみ */
  commentOnly?: boolean;
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
      item.status === DownloadStatusType.SEGMENT
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

      // コメント取得
      // コメント全量取得 (過去ログ含む — fetchAllComments でループ遡り)
      this.updateStatus(item, DownloadStatusType.COMMENT);
      if (getConfigStore().get('downloadAllComments') !== false) {
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
      try {
        const nowComments = await CommentClient.fetchComments(watch);
        LocalFileHandler.writeNowCommentJson(
          path.join(baseDir, LocalFileNaming.nowCommentJsonFileName(watch.title, watch.videoId)),
          nowComments.map((c) => c.no)
        );
      } catch (e) {
        log.warn('now comment fetch failed (continuing):', e);
      }

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
        const outputPath = path.join(
          baseDir,
          LocalFileNaming.videoFileName(watch.title, watch.videoId, 'mp4')
        );

        this.updateStatus(item, DownloadStatusType.VIDEO);
        await YtDlpDownloader.download(watch.videoId, {
          outputPath,
          signal: ac.signal,
          onProgress: (percent, speed, eta) => {
            item.progress = percent / 100;
            item.message = speed ? `${percent.toFixed(1)}% ${speed} ETA ${eta}` : `${percent.toFixed(1)}%`;
            this.emit('change', item);
          }
        });

        // ライブラリに登録
        const video: NNDDREVideo = {
          id: 0,
          uri: outputPath,
          videoName: `${baseName}.mp4`,
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
          LocalFileNaming.videoFileName(watch.title, watch.videoId, 'mp4')
        );
        if (!fs.existsSync(videoPath)) {
          throw new Error(`動画ファイルが見つかりません (DL後検証): ${videoPath}`);
        }

        const missingSecondary: string[] = [];
        if (getConfigStore().get('downloadAllComments') !== false) {
          const p = path.join(baseDir, LocalFileNaming.commentXmlFileName(watch.title, watch.videoId));
          if (!fs.existsSync(p)) missingSecondary.push('コメントXML');
        }
        const nowCommentPath = path.join(baseDir, LocalFileNaming.nowCommentJsonFileName(watch.title, watch.videoId));
        if (!fs.existsSync(nowCommentPath)) missingSecondary.push('今コメJSON');
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

  private updateStatus(
    item: DownloadQueueItem,
    status: DownloadStatusTypeValue
  ): void {
    item.status = status;
    this.emit('change', item);
  }
}
