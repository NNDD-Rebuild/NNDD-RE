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
import { VideoFileSuffix } from '@shared/constants/paths';
import { isCommentOnlyUri } from '@shared/utils/commentOnly';
import { isLiveProgramId } from '@shared/utils/liveId';
import { WatchInfoHandler } from '../nicovideo/watch/WatchInfoHandler';
import { CommentClient } from '../nicovideo/comment/CommentClient';
import { CommentDiffUpdater } from '../nicovideo/comment/CommentDiffUpdater';
import { YtDlpDownloader } from '../nicovideo/video/YtDlpDownloader';
import { VideoDownloader } from '../nicovideo/video/VideoDownloader';
import type { VideoDownloadPhase } from '../nicovideo/video/VideoDownloader';
import { LiveDownloader, type LiveDownloadPhase } from '../nicovideo/live/LiveDownloader';
import { LivePlayerManager } from '../player/LivePlayerManager';
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
  /**
   * saveDir (省略時はデフォルト保存先) 配下に作成するサブフォルダ名。
   * マイリスト/シリーズ/投稿者名などをそのまま渡してよい (ファイル名に使えない文字は自動除去)。
   */
  subDir?: string;
  /** コメントのみ */
  commentOnly?: boolean;
  /**
   * 動画だけ取得する (コメント・サムネ・ThumbInfo は取り直さない)。
   * 「コメントのみ」で取得済みの動画に動画本体を足す用途
   */
  videoOnly?: boolean;
  /**
   * コメントを差分だけ取得して既存XMLにマージし、今コメ ([NowComment].json) も更新する。
   * DL済み動画向け。commentOnly を暗黙に有効化する
   */
  commentDiff?: boolean;
  /** 音声のみ (.m4a、映像トラックなし) */
  audioOnly?: boolean;
  /**
   * 生放送 (videoId が lv12345) で、未予約・未視聴のタイムシフトの予約と視聴開始を自動で行う。
   * 視聴開始で視聴期限のカウントが始まり取り消せないため、ユーザーの確認後に指定する
   */
  activateTimeshift?: boolean;
  /**
   * 放送中の生放送 (videoId が lv12345) を録画する。番組の終了か停止まで続き、同時実行数の枠に数えない。
   * 録画のキャンセルは破棄ではなく停止で、ここまでの録画を保存する
   */
  record?: boolean;
  /** 録画を放送開始から (追っかけ再生で) 行う。プレミアム会員のみ。使えないときはエラーで終わる */
  fromStart?: boolean;
  /** 生放送のサムネイルの URL (一覧で見えていたもの)。番組情報から取れないときの代わりに使う */
  thumbnailUrl?: string;
}

/** 生放送 (タイムシフト) の保存先サブフォルダ名 (設定 downloadLiveToSubfolder が有効なとき) */
const LIVE_SUBDIR = 'live';

/** 秒 → H:MM:SS */
function formatElapsed(sec: number): string {
  const s = Math.floor(sec);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

const LIVE_PHASE_LABEL: Record<LiveDownloadPhase, string> = {
  ...NATIVE_PHASE_LABEL,
  connect: '視聴セッション接続中',
  waiting: '放送開始待ち',
  recording: '録画中',
  comment: 'コメント取得中',
  thumb: 'サムネイル保存中'
};

const LIVE_PHASE_STATUS: Partial<Record<LiveDownloadPhase, DownloadStatusTypeValue>> = {
  ...NATIVE_PHASE_STATUS,
  connect: DownloadStatusType.WATCH,
  waiting: DownloadStatusType.WATCH,
  recording: DownloadStatusType.SEGMENT,
  comment: DownloadStatusType.COMMENT,
  thumb: DownloadStatusType.THUMB
};

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
  /** 実行中に一時停止要求されたアイテムID (abort後 CANCELED ではなく PAUSED にするため) */
  private pausingIds = new Set<string>();
  /** 録画中のジョブID → 停止要求 (abort すると、ここまでの録画を保存して終わる) */
  private recordStops = new Map<string, AbortController>();
  /** 全体一時停止中: true の間は新規アイテムの実行を開始しない */
  private globalPaused = false;

  constructor(private readonly library: LibraryManager) {
    super();
    this.maxConcurrent = getConfigStore().get('maxConcurrentDownloads') ?? 2;
  }

  list(): DownloadQueueItem[] {
    return [...this.queue];
  }

  enqueue(opts: EnqueueOptions): DownloadQueueItem {
    // コメントのみ・差分取得、および「コメントのみ」登録済みの動画の動画DLは、既存のコメントXMLの隣に
    // 書くため、保存先未指定ならライブラリ上の記録と同じフォルダにする
    let existingVideoPath: string | undefined;
    if (!opts.saveDir && !opts.subDir) {
      const existing = this.library.videoDao.getByKey(opts.videoId, true);
      if (existing && (opts.commentOnly || opts.commentDiff || isCommentOnlyUri(existing.uri))) {
        existingVideoPath = existing.uri;
      }
    }
    const baseDir = opts.saveDir ?? (existingVideoPath ? path.dirname(existingVideoPath) : this.library.videoDir);
    const isLive = isLiveProgramId(opts.videoId);
    let saveDir = opts.subDir
      ? path.join(baseDir, LocalFileNaming.sanitize(opts.subDir) || opts.subDir)
      : baseDir;
    if (isLive && (getConfigStore().get('downloadLiveToSubfolder') ?? false)) {
      saveDir = path.join(saveDir, LIVE_SUBDIR);
    }
    const item: DownloadQueueItem = {
      id: uuidv4(),
      videoId: opts.videoId,
      videoName: opts.videoId,
      status: DownloadStatusType.WAIT,
      progress: 0,
      message: '',
      retryCount: 0,
      saveDir,
      isCommentOnly: Boolean(opts.commentOnly || opts.commentDiff),
      isCommentDiff: opts.commentDiff ?? false,
      isVideoOnly: opts.videoOnly ?? false,
      isAudioOnly: opts.audioOnly ?? false,
      isLive,
      activateTimeshift: isLive ? (opts.activateTimeshift ?? false) : undefined,
      isRecording: isLive && (opts.record ?? false),
      recordFromStart: isLive && (opts.record ?? false) && (opts.fromStart ?? false),
      liveThumbnailUrl: isLive ? opts.thumbnailUrl : undefined,
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
      this.interrupt(id, ac);
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

  /** キュー全体をキャンセルする (実行中は中断、待機中はCANCELED化) */
  cancelAll(): void {
    for (const [id, ac] of this.running) {
      this.interrupt(id, ac);
    }
    for (const item of this.queue) {
      if (item.status === DownloadStatusType.WAIT) {
        this.updateStatus(item, DownloadStatusType.CANCELED);
      }
    }
  }

  /**
   * 個別アイテムを一時停止する。
   * 実行中なら現在の処理を中断して PAUSED に、待機中ならそのまま PAUSED にする。
   */
  pause(id: string): boolean {
    const ac = this.running.get(id);
    if (ac) {
      const item = this.queue.find((q) => q.id === id);
      if (!item) return false;
      // 録画は一時停止できない (止めている間の放送は録れない)。止めるときはキャンセル (停止) を使う
      if (item.isRecording) return false;
      this.pausingIds.add(id);
      ac.abort();
      return true;
    }
    const item = this.queue.find((q) => q.id === id);
    if (item && item.status === DownloadStatusType.WAIT) {
      this.updateStatus(item, DownloadStatusType.PAUSED);
      return true;
    }
    return false;
  }

  /** 個別アイテムを再開する (PAUSED → WAIT) */
  resume(id: string): boolean {
    const item = this.queue.find((q) => q.id === id);
    if (!item || item.status !== DownloadStatusType.PAUSED) return false;
    item.status = DownloadStatusType.WAIT;
    this.emit('change', item);
    this.tick();
    return true;
  }

  /** キュー全体を一時停止する (実行中/待機中いずれも PAUSED にし、新規実行開始を止める) */
  pauseAll(): void {
    this.globalPaused = true;
    for (const [id, ac] of this.running) {
      if (this.recordStops.has(id)) continue; // 録画は一時停止しない
      this.pausingIds.add(id);
      ac.abort();
    }
    for (const item of this.queue) {
      if (item.status === DownloadStatusType.WAIT) {
        this.updateStatus(item, DownloadStatusType.PAUSED);
      }
    }
  }

  /** キュー全体の一時停止を解除する (PAUSED → WAIT にして再開) */
  resumeAll(): void {
    this.globalPaused = false;
    for (const item of this.queue) {
      if (item.status === DownloadStatusType.PAUSED) {
        item.status = DownloadStatusType.WAIT;
        this.emit('change', item);
      }
    }
    this.tick();
  }

  /** 実行中のジョブを止める。録画は破棄せず、ここまでの録画を保存して終わらせる */
  private interrupt(id: string, ac: AbortController): void {
    const stop = this.recordStops.get(id);
    if (stop) {
      stop.abort();
      // 停止してから結合に入るまで数秒かかるので、受け付けたことをすぐ見せる
      const item = this.queue.find((q) => q.id === id);
      if (item) {
        item.message = '録画を停止しています…';
        this.emit('change', item);
      }
    } else {
      ac.abort();
    }
  }

  /**
   * キューを進める。
   */
  private async tick(): Promise<void> {
    if (this.isProcessing || this.globalPaused) return;
    this.isProcessing = true;
    try {
      while (true) {
        // 録画は放送を待たせると内容が欠けるため、同時実行数の枠に数えず、空きを待たずに始める
        const active = [...this.running.keys()].filter((id) => !this.queue.find((q) => q.id === id)?.isRecording).length;
        const next = this.queue.find(
          (q) => q.status === DownloadStatusType.WAIT && (q.isRecording || active < this.maxConcurrent)
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

  /** ライブラリ上の動画ファイル名から拡張子を除いたもの。同じフォルダにない・未登録なら null */
  private existingBaseName(videoId: string, baseDir: string): string | null {
    const uri = this.library.videoDao.getByKey(videoId, true)?.uri;
    if (!uri || path.dirname(uri) !== baseDir) return null;
    return path.basename(uri, path.extname(uri));
  }

  /**
   * 「コメントのみ」で取得した動画をライブラリに登録する。uri はコメントXML。
   * すでに動画ファイルを持つ記録があれば何もしない。コメントのみの記録があれば
   * 再生回数などを引き継いで情報だけ更新する。
   */
  private registerCommentOnly(
    watch: WatchPageInfo,
    baseDir: string,
    baseName: string,
    commentXmlPath: string
  ): void {
    const existing = this.library.videoDao.getByKey(watch.videoId, true);
    if (existing && !isCommentOnlyUri(existing.uri)) return;
    if (!fs.existsSync(commentXmlPath)) return;
    const now = new Date();
    const video: NNDDREVideo = {
      id: existing?.id ?? 0,
      uri: commentXmlPath,
      videoName: `${baseName}${VideoFileSuffix.COMMENT_XML}`,
      tagStrings: watch.tags,
      modificationDate: now,
      creationDate: existing?.creationDate ?? now,
      thumbUrl: path.join(baseDir, LocalFileNaming.thumbImageFileName(watch.title, watch.videoId)),
      playCount: existing?.playCount ?? 0,
      time: watch.duration,
      lastPlayDate: existing?.lastPlayDate ?? null,
      yetReading: existing?.yetReading ?? true,
      pubDate: watch.registeredAt ? new Date(watch.registeredAt) : null,
      isFavorite: existing?.isFavorite ?? false,
      description: watch.description ?? ''
    };
    this.library.videoDao.insertOrUpdate(video, this.library.videoDao.ensureFileDir(baseDir));
  }

  private async runItem(item: DownloadQueueItem): Promise<void> {
    const ac = new AbortController();
    this.running.set(item.id, ac);
    item.startTime = new Date();
    try {
      if (item.isLive) {
        await this.runLiveItem(item, ac);
        item.progress = 1;
        item.endTime = new Date();
        this.updateStatus(item, DownloadStatusType.SUCCESS);
        return;
      }
      this.updateStatus(item, DownloadStatusType.WATCH);
      // DLはユーザー操作起点の明示的な取得のため、hideWatchHistory設定に関わらず
      // ログイン経由 (v3) で取得する。ゲスト経由 (v3_guest) の threadKey は
      // nvComment API 側で INVALID_TOKEN 扱いされ、過去コメント全量取得に失敗するため。
      const watch = await WatchInfoHandler.fetchWatchInfoRaw(item.videoId, true);
      item.videoName = watch.title;
      this.emit('change', item);

      const baseDir = item.saveDir;
      fs.mkdirSync(baseDir, { recursive: true });
      // 動画のみ指定 (「コメントのみ」取得済みへの動画追加) は、動画の改題でファイル名がずれていても
      // 既存のコメントXML等と同じベース名で保存し、再生時に付帯ファイルが見つかるようにする
      const baseName = (item.isVideoOnly ? this.existingBaseName(watch.videoId, baseDir) : null)
        ?? LocalFileNaming.baseName(watch.title, watch.videoId);
      // 差分取得は、動画の改題でファイル名がずれていても既存のコメントXMLへマージできるよう
      // ライブラリ上の動画ファイル名 (拡張子除く) を基準にする
      const diffBaseName = item.isCommentDiff
        ? this.existingBaseName(watch.videoId, baseDir)
        : null;
      const commentXmlPath = path.join(baseDir, diffBaseName ? `${diffBaseName}${VideoFileSuffix.COMMENT_XML}` : LocalFileNaming.commentXmlFileName(watch.title, watch.videoId));
      const ownerXmlPath = path.join(baseDir, diffBaseName ? `${diffBaseName}${VideoFileSuffix.OWNER_COMMENT_XML}` : LocalFileNaming.ownerCommentXmlFileName(watch.title, watch.videoId));
      const nowCommentJsonPath = path.join(baseDir, diffBaseName ? `${diffBaseName}${VideoFileSuffix.NOW_COMMENT_JSON}` : LocalFileNaming.nowCommentJsonFileName(watch.title, watch.videoId));
      const skipComments = item.isVideoOnly || (item.isAudioOnly && (getConfigStore().get('skipCommentsOnAudioOnly') ?? false));
      // DL途中で設定が変わっても取得処理と完了検証の判定がずれないよう、ここで1回だけ読む
      const downloadAllComments = getConfigStore().get('downloadAllComments') ?? false;

      // コメント取得
      this.updateStatus(item, DownloadStatusType.COMMENT);

      // 今コメは全量取得より先に取る。全量取得は数分〜数時間かかり、その間に threadKey の期限が
      // 切れて失敗し、DL後検証が今コメJSON不足で commentOnly を再投入してしまうため
      // [NowComment].json: fetchComments (ストリーミング今コメ相当) の no 一覧を保存
      // → ローカル再生時に fetchAllComments XML から今コメを再現するために使用
      if (!skipComments && item.isCommentDiff) {
        // 差分取得: 設定「全コメントDL」に関わらず、既存XMLの最新コメントに届くまで遡ってマージする
        try {
          await CommentDiffUpdater.update(
            watch,
            { commentXml: commentXmlPath, ownerXml: ownerXmlPath, nowJson: nowCommentJsonPath },
            {
              refreshWatch: () => WatchInfoHandler.fetchWatchInfoRaw(item.videoId, true),
              signal: ac.signal,
              onProgress: (msg) => {
                item.message = msg;
                this.emit('change', item);
              }
            }
          );
        } catch (e) {
          log.warn('comment diff failed (continuing):', e);
        }
      } else if (!skipComments) {
      try {
        const nowComments = await CommentClient.fetchComments(watch);
        LocalFileHandler.writeNowCommentJson(nowCommentJsonPath, nowComments.map((c) => c.no));
        // 全件取得オフ時は下のfetchAllCommentsブロックが実行されず通常コメントXMLが
        // 生成されないため、今コメの内容をそのまま通常コメントXMLとしても書き出す
        if (!downloadAllComments) {
          const threadId =
            watch.commentThreads.find((t) => t.fork === 'main')?.id ??
            watch.commentThreads[0]?.id ??
            '';
          LocalFileHandler.writeCommentXml(
            commentXmlPath,
            nowComments.filter((c) => c.fork !== 'owner'),
            threadId,
            watch.videoId,
            'main'
          );
          const ownerNowComments = nowComments.filter((c) => c.fork === 'owner');
          const ownerThread =
            watch.commentThreads.find((t) => t.fork === 'owner')?.id ?? '';
          LocalFileHandler.writeCommentXml(ownerXmlPath, ownerNowComments, ownerThread, watch.videoId, 'owner');
        }
      } catch (e) {
        log.warn('now comment fetch failed (continuing):', e);
      }
      } // skipComments

      // コメント全量取得 (過去ログ含む — fetchAllComments でループ遡り)
      if (!skipComments && !item.isCommentDiff && downloadAllComments) {
      try {
        const comments = await CommentClient.fetchAllComments(watch, {
          includeEasy: getConfigStore().get('downloadEasyComments') ?? false,
          comment429RetryWaitSec: getConfigStore().get('comment429RetryWaitSec') ?? 60,
          // threadKey は約8分で期限切れになるため、切れたら視聴情報を取り直して続きから再開する
          refreshWatch: () => WatchInfoHandler.fetchWatchInfoRaw(item.videoId, true),
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
          commentXmlPath,
          comments.filter((c) => c.fork !== 'owner'),
          threadId,
          watch.videoId,
          'main'
        );
        const ownerComments = comments.filter((c) => c.fork === 'owner');
        const ownerThread =
          watch.commentThreads.find((t) => t.fork === 'owner')?.id ?? '';
        LocalFileHandler.writeCommentXml(ownerXmlPath, ownerComments, ownerThread, watch.videoId, 'owner');
      } catch (e) {
        log.warn('comment download failed (continuing):', e);
      }
      } // downloadAllComments

      // サムネ取得 (動画のみ指定では取り直さない)
      if (!item.isVideoOnly) {
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
      }

      // 動画ダウンロード (コメントのみモードでなければ)
      if (!item.isCommentOnly) {
        const ext = item.isAudioOnly ? 'm4a' : 'mp4';
        const outputPath = path.join(
          baseDir,
          `${baseName}.${ext}`
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
          pubDate: watch.registeredAt ? new Date(watch.registeredAt) : null,
          isFavorite: false,
          description: watch.description ?? ''
        };
        const dirId = this.library.videoDao.ensureFileDir(baseDir);
        this.library.videoDao.insertOrUpdate(video, dirId);
      }

      // コメントのみ: 動画ファイルが無い動画をライブラリの「コメントのみ」タブに出すため、
      // コメントXMLを uri とした記録を登録・更新する (動画ファイルありの記録は触らない)
      if (item.isCommentOnly) {
        try {
          this.registerCommentOnly(
            watch,
            baseDir,
            diffBaseName ?? baseName,
            commentXmlPath
          );
        } catch (e) {
          log.warn('comment-only library register failed (continuing):', e);
        }
      }

      // ファイル検証: 不足ファイルがあれば補完キューに追加
      if (!item.isCommentOnly) {
        const videoPath = path.join(
          baseDir,
          `${baseName}.${item.isAudioOnly ? 'm4a' : 'mp4'}`
        );
        if (!fs.existsSync(videoPath)) {
          throw new Error(`動画ファイルが見つかりません (DL後検証): ${videoPath}`);
        }

        const missingSecondary: string[] = [];
        if (!skipComments) {
          if (downloadAllComments) {
            const p = path.join(baseDir, LocalFileNaming.commentXmlFileName(watch.title, watch.videoId));
            if (!fs.existsSync(p)) missingSecondary.push('コメントXML');
          }
          const nowCommentPath = path.join(baseDir, `${baseName}${VideoFileSuffix.NOW_COMMENT_JSON}`);
          if (!fs.existsSync(nowCommentPath)) missingSecondary.push('今コメJSON');
        }
        const thumbInfoPath = path.join(baseDir, `${baseName}${VideoFileSuffix.THUMB_INFO_XML}`);
        if (!fs.existsSync(thumbInfoPath)) missingSecondary.push('ThumbInfo');
        const thumbImagePath = path.join(baseDir, `${baseName}${VideoFileSuffix.THUMB_IMAGE}`);
        if (!fs.existsSync(thumbImagePath)) missingSecondary.push('サムネ');

        if (missingSecondary.length > 0) {
          log.warn(`DL後に不足ファイル検出 (${missingSecondary.join(', ')}) — commentOnly で再キュー`);
          this.enqueue({ videoId: watch.videoId, saveDir: baseDir, commentOnly: true });
        }
      }

      item.progress = 1;
      item.endTime = new Date();
      this.updateStatus(item, DownloadStatusType.SUCCESS);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      item.errorMessage = msg;
      if (ac.signal.aborted) {
        if (this.pausingIds.delete(item.id)) {
          item.errorMessage = null;
          this.updateStatus(item, DownloadStatusType.PAUSED);
        } else {
          this.updateStatus(item, DownloadStatusType.CANCELED);
        }
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
   * 生放送 (タイムシフト) のダウンロード。動画・コメントXML・サムネ・動画情報を保存してライブラリに登録する。
   * 通常動画と取得経路が異なる (視聴WebSocket経由) ため、runItem から分岐して処理する。
   */
  private async runLiveItem(item: DownloadQueueItem, ac: AbortController): Promise<void> {
    const signal = ac.signal;
    const tempDir = path.join(os.tmpdir(), 'nndd-live-dl', item.id);
    const record = item.isRecording ?? false;
    if (LivePlayerManager.get().isWatching(item.videoId.toLowerCase())) {
      // 同じ番組を視聴ウィンドウで開いていると、ダウンロード側の視聴開始で視聴ウィンドウが切断される
      // (録画側も切断されて途中で終わる) ので、始めない
      throw new Error('この番組を視聴ウィンドウで開いています。ウィンドウを閉じてからやり直してください。');
    }
    // コールバック内で更新するため、型の絞り込みで 'connect' に固定されないよう断言しておく
    let phase = 'connect' as LiveDownloadPhase;
    // 録画は先頭のタイムスタンプを揃える必要があるため常に mediabunny。タイムシフトは設定に従う
    const muxImpl = record ? 'mediabunny' : (getConfigStore().get('downloadMuxImplementation') ?? 'mediabunny');
    this.updateStatus(item, DownloadStatusType.WATCH);
    item.message = LIVE_PHASE_LABEL.connect;
    this.emit('change', item);
    const stop = new AbortController();
    if (record) this.recordStops.set(item.id, stop);
    let lastMergeEmit = 0;
    try {
      const result = await LiveDownloader.download(item.videoId.toLowerCase(), {
        mode: record ? 'record' : 'timeshift',
        saveDir: item.saveDir,
        tempDir,
        signal,
        stopSignal: stop.signal,
        fromStart: item.recordFromStart ?? false,
        thumbnailUrl: item.liveThumbnailUrl,
        activateTimeshift: item.activateTimeshift ?? false,
        onProgram: (program) => {
          item.videoName = program.title;
          this.emit('change', item);
        },
        onPhaseChange: (p, detail) => {
          phase = p;
          item.message =
            p === 'merge' && muxImpl === 'mediabunny'
              ? 'mediabunnyで結合中'
              : detail
                ? `${LIVE_PHASE_LABEL[p]} (${detail})`
                : LIVE_PHASE_LABEL[p];
          const status = LIVE_PHASE_STATUS[p];
          if (status) this.updateStatus(item, status);
          else this.emit('change', item);
          if (p === 'merge') item.progress = 0.95;
        },
        onProgress: (done, total) => {
          if (total <= 0) return;
          const pct = done / total;
          // 映像→音声の順に 0〜0.45、0.45〜0.9 (結合・コメント・サムネは残り)
          item.progress = phase === 'audio_segments' ? 0.45 + pct * 0.45 : pct * 0.45;
          item.message = `${LIVE_PHASE_LABEL[phase]} ${(item.progress * 100).toFixed(1)}% (${done}/${total})`;
          this.emit('change', item);
        },
        onMergeProgress: (currentMs, totalMs) => {
          // 結合の進捗。呼ばれる回数が多いので、表示は一定間隔に間引く
          const now = Date.now();
          if (now - lastMergeEmit < 500) return;
          lastMergeEmit = now;
          const base = muxImpl === 'mediabunny' ? 'mediabunnyで結合中' : LIVE_PHASE_LABEL.merge;
          item.message = totalMs && totalMs > 0 ? `${base} ${Math.min(100, Math.floor((currentMs / totalMs) * 100))}%` : base;
          this.emit('change', item);
        },
        onRecordProgress: (p) => {
          if (stop.signal.aborted) return; // 停止要求後は「停止しています」の表示を上書きしない
          // 長さの分からない処理なので進捗バーは動かさず、メッセージで経過を見せる
          item.message = `${LIVE_PHASE_LABEL.recording} ${formatElapsed(p.elapsedSec)} (${(p.bytes / 1024 / 1024).toFixed(0)} MB) コメント${p.comments}件`;
          this.emit('change', item);
        }
      });

      const durationSec = result.durationSec;
      const existing = this.library.videoDao.getByKey(result.program.programId, true);
      const now = new Date();
      const video: NNDDREVideo = {
        id: 0,
        uri: result.videoPath,
        videoName: path.basename(result.videoPath),
        tagStrings: result.program.tags,
        modificationDate: now,
        creationDate: existing?.creationDate ?? now,
        thumbUrl: result.thumbPath,
        playCount: existing?.playCount ?? 0,
        time: durationSec,
        lastPlayDate: existing?.lastPlayDate ?? null,
        yetReading: existing?.yetReading ?? true,
        pubDate: result.program.beginTimeMs > 0 ? new Date(result.program.beginTimeMs) : null,
        isFavorite: existing?.isFavorite ?? false,
        description: result.program.description
      };
      this.library.videoDao.insertOrUpdate(video, this.library.videoDao.ensureFileDir(item.saveDir));
    } catch (e) {
      // 放送の開始前に停止した場合は、録画していないのでキャンセル扱いにする (失敗としてリトライさせない)
      if (record && stop.signal.aborted && phase === 'waiting') ac.abort();
      throw e;
    } finally {
      this.recordStops.delete(item.id);
      fs.promises.rm(tempDir, { recursive: true, force: true }).catch((e) => {
        log.warn('live download tempDir cleanup failed:', e);
      });
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
