import fs from 'node:fs';
import path from 'node:path';
import { LibraryManager } from '../db/LibraryManager';
import type { ScanSnapshotRow } from '../db/dao/VideoDao';
import { createLogger } from '../util/Logger';
import { VideoFileSuffix } from '@shared/constants';
import type { LibraryScanProgress, LibraryScanResult, NNDDREVideo } from '@shared/types';
import { extractBracketedVideoId } from '@shared/utils/videoId';
import { isCommentOnlyUri } from '@shared/utils/commentOnly';
import { ThumbInfoXmlReader } from '../nicovideo/video/ThumbInfoXmlReader';
import { InfoTxtReader } from '../nicovideo/video/InfoTxtReader';

const log = createLogger('LibraryScanner');

/** NAS 等の遅延を隠すための I/O 同時実行数 */
const IO_CONCURRENCY = 8;
/** DB へまとめて書き込む単位 (1トランザクション) */
const COMMIT_BATCH_SIZE = 100;

export interface LibraryScanRunOptions {
  /** true なら変更の有無に関わらず全件の付帯情報を読み直す */
  full?: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: LibraryScanProgress) => void;
}

interface ThumbMeta {
  tags: string[];
  length: number;
  pubDate: Date | null;
  description: string;
}

interface VideoFileEntry {
  filePath: string;
  fileName: string;
  baseName: string;
  /** 動画ID。ID無し・[Nicowari] 素材は null (登録対象外) */
  videoId: string | null;
}

interface CommentXmlEntry {
  dir: string;
  baseName: string;
  videoId: string;
  filePath: string;
}

/** I/O を終えて DB へ書き込むだけになった状態。unchanged/skip は書き込み不要 */
type PreparedVideo =
  | { kind: 'skip' }
  | { kind: 'unchanged' }
  | {
      kind: 'register';
      entry: VideoFileEntry & { videoId: string };
      stat: fs.Stats;
      thumbUrl: string;
      meta: ThumbMeta | null;
    };

type PreparedCommentOnly =
  | { kind: 'skip' }
  | { kind: 'unchanged' }
  | { kind: 'register'; entry: CommentXmlEntry; stat: fs.Stats; thumbUrl: string; meta: ThumbMeta };

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.promises.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readTextIfExists(p: string): Promise<string | null> {
  try {
    return await fs.promises.readFile(p, 'utf-8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn('readFile failed:', p, e);
    return null;
  }
}

/** 同時に走る非同期処理を limit 個に絞る */
function createLimiter(limit: number): <T>(fn: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiters: (() => void)[] = [];
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active < limit) active++;
    else await new Promise<void>((resolve) => waiters.push(resolve)); // 解放側から枠を引き継ぐ
    try {
      return await fn();
    } finally {
      const next = waiters.shift();
      if (next) next();
      else active--;
    }
  };
}

async function mapLimit<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  let next = 0;
  const run = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      await worker(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
}

const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function isUnder(dir: string, target: string): boolean {
  const rel = path.relative(dir, target);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** DB の modificationDate (秒) とファイルの mtime が一致するか */
function sameMtime(dbSeconds: number, stat: fs.Stats): boolean {
  return Math.round(dbSeconds * 1000) === stat.mtime.getTime();
}

/**
 * ライブラリディレクトリを再帰的にスキャンし、見つかった動画を DB に登録する。
 *
 * 元: src/org/mineap/nndd/library/LibraryDirSearchUtil.as
 *     + LocalVideoInfoLoader.as
 *
 * 命名規則 `タイトル[sm12345].mp4` から動画IDを抽出する。
 * 同ディレクトリの `[サムネイル情報].xml` を読んで補完情報を取得する。
 *
 * NAS や低速 HDD でも遅くならないよう、ファイル I/O は非同期で並列に行い (メインプロセスを止めない)、
 * 前回から mtime が変わっていない動画は付帯ファイルを読まずにスキップし、DB 書き込みは
 * まとめて1トランザクションで行う。
 */
export class LibraryScanner {
  /**
   * 動画ファイル拡張子
   */
  static VIDEO_EXTS = ['.mp4', '.flv', '.swf', '.webm', '.mkv', '.m4a'];

  /**
   * ライブラリディレクトリ全体をスキャン。
   */
  static async scan(
    library: LibraryManager,
    options: LibraryScanRunOptions = {}
  ): Promise<LibraryScanResult> {
    const { full = false, signal, onProgress } = options;
    const root = library.videoDir;
    const result: LibraryScanResult = {
      added: 0,
      updated: 0,
      removed: 0,
      unchanged: 0,
      total: 0,
      cancelled: false,
      removalSkipped: null
    };

    if (!(await fileExists(root))) {
      log.warn('library directory not found:', root);
      return result;
    }

    // --- 1. フォルダを走査して動画ファイルとコメントXMLを集める ---
    // 走査で見えたファイルは後段の「消えた動画の判定」にも使い、DB 全件への存在確認を省く。
    const seenFiles = new Set<string>();
    const failedDirs: string[] = [];
    const videoFiles: VideoFileEntry[] = [];
    const commentXmls: CommentXmlEntry[] = [];
    // 「コメントのみ」登録の候補 (動画ファイルが無くコメントXMLだけある動画) を拾うための集計
    const videoIdsWithFile = new Set<string>();
    const limitIo = createLimiter(IO_CONCURRENCY);

    const walk = async (dir: string): Promise<void> => {
      if (signal?.aborted) return;
      let entries: fs.Dirent[];
      try {
        entries = await limitIo(() => fs.promises.readdir(dir, { withFileTypes: true }));
      } catch (e) {
        log.warn('readdir failed:', dir, e);
        failedDirs.push(dir);
        return;
      }
      const subDirs: string[] = [];
      for (const ent of entries) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          subDirs.push(p);
          continue;
        }
        if (!ent.isFile()) continue;
        seenFiles.add(p);
        const ext = path.extname(ent.name).toLowerCase();
        const baseName = ent.name.slice(0, -ext.length || undefined);
        if (ext === '.xml') {
          const videoId = this.extractVideoId(baseName);
          // `タイトル - [sm12345].xml` だけがコメントXML ([ThumbInfo] 等は末尾が動画IDではない)
          if (videoId && baseName.endsWith(`[${videoId}]`)) {
            commentXmls.push({ dir, baseName, videoId, filePath: p });
          }
          continue;
        }
        if (!this.VIDEO_EXTS.includes(ext)) continue;
        // [Nicowari] 素材はニコ割広告用のFlashで、動画本体と同じvideoIdを名乗るため
        // 除外しないと本体ファイルのDBレコードを上書きしてしまう。
        const videoId = ent.name.includes('[Nicowari]') ? null : this.extractVideoId(baseName);
        if (videoId) videoIdsWithFile.add(videoId);
        videoFiles.push({ filePath: p, fileName: ent.name, baseName, videoId });
      }
      onProgress?.({ phase: 'walk', current: videoFiles.length, total: 0 });
      await Promise.all(subDirs.map(walk));
    };

    await walk(root);
    result.total = videoFiles.length;
    onProgress?.({ phase: 'walk', current: videoFiles.length, total: 0 });
    if (signal?.aborted) {
      result.cancelled = true;
      return result;
    }
    // 並列走査で順序が揺れるので固定する (同じ動画IDのファイルが複数ある場合の優先判定を安定させる)
    videoFiles.sort((a, b) => (a.filePath < b.filePath ? -1 : a.filePath > b.filePath ? 1 : 0));

    // --- 2. 動画ファイルを DB へ登録 ---
    const snapshot = new Map<string, ScanSnapshotRow>();
    for (const row of library.videoDao.listScanSnapshot()) {
      if (row.key) snapshot.set(row.key, row);
    }
    const dirIds = new Map<string, number>();
    const ensureDirId = (dir: string): number => {
      let id = dirIds.get(dir);
      if (id === undefined) {
        id = library.videoDao.ensureFileDir(dir);
        dirIds.set(dir, id);
      }
      return id;
    };

    let done = 0;
    const completedVideos = await this.processInBatches(
      videoFiles,
      signal,
      (entry) => this.prepareVideo(entry, snapshot, full),
      (prepared) => {
        if (prepared.kind === 'unchanged') result.unchanged++;
        else if (prepared.kind === 'register') {
          const r = this.commitVideo(library, prepared, ensureDirId);
          if (r === 'added') result.added++;
          else if (r === 'updated') result.updated++;
        }
      },
      library,
      () => onProgress?.({ phase: 'register', current: ++done, total: videoFiles.length })
    );
    if (!completedVideos) {
      result.cancelled = true;
      return result;
    }

    // --- 3. 動画ファイルが無くコメントXMLと [ThumbInfo].xml だけある動画を「コメントのみ」として登録 ---
    const commentCandidates = commentXmls.filter((c) => {
      if (videoIdsWithFile.has(c.videoId)) return false;
      const sn = snapshot.get(c.videoId);
      return !(sn && !isCommentOnlyUri(sn.uri));
    });
    const completedComments = await this.processInBatches(
      commentCandidates,
      signal,
      (entry) => this.prepareCommentOnly(entry, snapshot, full),
      (prepared) => {
        if (prepared.kind === 'unchanged') result.unchanged++;
        else if (prepared.kind === 'register') {
          const r = this.commitCommentOnly(library, prepared, ensureDirId);
          if (r === 'added') result.added++;
          else if (r === 'updated') result.updated++;
        }
      },
      library,
      () => {}
    );
    if (!completedComments) {
      result.cancelled = true;
      return result;
    }

    // --- 4. ディスク上から消えた動画 (「コメントのみ」含む) をDBからも削除する ---
    onProgress?.({ phase: 'cleanup', current: 0, total: 0 });
    const rows = library.videoDao.listScanSnapshot();
    if (rows.length > 0 && videoFiles.length === 0 && commentXmls.length === 0) {
      // 空に見えるのは NAS 切断・マウント解除の可能性が高い。全件削除してしまうのを避ける。
      log.warn('library looks empty; skip removal:', root);
      result.removalSkipped = 'empty';
    } else {
      const candidates: ScanSnapshotRow[] = [];
      for (const row of rows) {
        if (seenFiles.has(row.uri)) continue;
        // 読めなかったフォルダ配下は「無い」ではなく「分からない」ので消さない
        if (failedDirs.some((d) => isUnder(d, row.uri))) {
          result.removalSkipped = 'unreadable';
          continue;
        }
        candidates.push(row);
      }
      // 走査で見えなかった行 (ライブラリ外のパス・シンボリックリンク等) だけ実在確認する
      const missing: ScanSnapshotRow[] = [];
      await mapLimit(candidates, IO_CONCURRENCY, async (row) => {
        if (!(await fileExists(row.uri))) missing.push(row);
      });
      library.videoDao.runInTransaction(() => {
        for (const row of missing) {
          library.videoDao.delete(row.id);
          result.removed++;
        }
      });
    }

    library.videoDao.cleanupOrphanFiles();
    log.info(
      `scan complete: added=${result.added} updated=${result.updated} unchanged=${result.unchanged} ` +
        `removed=${result.removed} total=${result.total} removalSkipped=${result.removalSkipped}`
    );
    return result;
  }

  /**
   * items を COMMIT_BATCH_SIZE 件ずつ、I/O (prepare, 並列・非同期) → DB 書き込み (commit, 同期・1トランザクション)
   * の順に処理する。キャンセルされたら false を返す (処理済みのバッチは書き込み済み)。
   */
  private static async processInBatches<I, P>(
    items: readonly I[],
    signal: AbortSignal | undefined,
    prepare: (item: I) => Promise<P>,
    commit: (prepared: P) => void,
    library: LibraryManager,
    onItemPrepared: () => void
  ): Promise<boolean> {
    for (let i = 0; i < items.length; i += COMMIT_BATCH_SIZE) {
      if (signal?.aborted) return false;
      const batch = items.slice(i, i + COMMIT_BATCH_SIZE);
      const prepared: P[] = new Array<P>(batch.length);
      await mapLimit(batch, IO_CONCURRENCY, async (item, idx) => {
        prepared[idx] = await prepare(item);
        onItemPrepared();
      });
      library.videoDao.runInTransaction(() => {
        for (const p of prepared) commit(p);
      });
      await yieldToEventLoop();
    }
    return !signal?.aborted;
  }

  /**
   * 動画ファイル1個の I/O 部分。DB には触れない。
   * 前回から mtime が変わらず、サムネ・メタ情報も登録済みなら付帯ファイルを読まずに unchanged とする。
   */
  private static async prepareVideo(
    entry: VideoFileEntry,
    snapshot: ReadonlyMap<string, ScanSnapshotRow>,
    full: boolean
  ): Promise<PreparedVideo> {
    const { filePath, baseName, videoId } = entry;
    if (!videoId) {
      log.debug('skip (Nicowari素材 or no videoId):', filePath);
      return { kind: 'skip' };
    }

    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(filePath);
    } catch (e) {
      log.warn('stat failed:', filePath, e);
      return { kind: 'skip' };
    }

    const sn = snapshot.get(videoId);
    if (
      !full &&
      sn &&
      sn.uri === filePath &&
      sn.thumbUrl !== '' &&
      sn.time > 0 &&
      sameMtime(sn.modificationDate, stat)
    ) {
      return { kind: 'unchanged' };
    }

    // 付帯ファイル (新形式優先、旧形式フォールバック)
    const dir = path.dirname(filePath);
    const thumbImagePathNew = path.join(dir, `${baseName}${VideoFileSuffix.THUMB_IMAGE}`);
    const thumbImagePathLegacy = path.join(dir, `${baseName}${VideoFileSuffix.THUMB_IMAGE_LEGACY}`);
    const thumbUrl = (await fileExists(thumbImagePathNew))
      ? thumbImagePathNew
      : (await fileExists(thumbImagePathLegacy))
        ? thumbImagePathLegacy
        : '';
    const meta = await this.readThumbMeta(path.join(dir, `${baseName}${VideoFileSuffix.THUMB_INFO_XML}`));
    return { kind: 'register', entry: { ...entry, videoId }, stat, thumbUrl, meta };
  }

  /**
   * 動画ファイル1個をDBに登録/更新 (同期。トランザクション内から呼ぶ)。
   */
  private static commitVideo(
    library: LibraryManager,
    prepared: Extract<PreparedVideo, { kind: 'register' }>,
    ensureDirId: (dir: string) => number
  ): 'added' | 'updated' | 'skipped' {
    const { entry, stat, thumbUrl, meta } = prepared;
    const { filePath, fileName, videoId } = entry;

    // 既存レコード?
    const existing = library.videoDao.getByKey(videoId);

    // 同じ動画IDのファイルが複数ある場合 (本家NNDD時代の .flv と .swf の併存等)、
    // DBには1件しか持てないため、優先度の低いファイルで既存レコードを上書きしない。
    if (
      existing &&
      existing.uri !== filePath &&
      fs.existsSync(existing.uri) &&
      this.filePriority(filePath) < this.filePriority(existing.uri)
    ) {
      log.debug('skip (同じ動画IDの優先ファイルあり):', filePath, '<', existing.uri);
      return 'skipped';
    }

    const video: NNDDREVideo = existing ?? {
      id: 0,
      uri: filePath,
      videoName: fileName,
      tagStrings: meta?.tags ?? [],
      modificationDate: stat.mtime,
      creationDate: stat.birthtime || stat.ctime,
      thumbUrl,
      playCount: 0,
      time: meta?.length ?? 0,
      lastPlayDate: null,
      yetReading: true,
      pubDate: meta?.pubDate ?? null,
      isFavorite: false,
      description: meta?.description ?? ''
    };

    if (existing) {
      // パスが変わっていたら更新
      video.uri = filePath;
      video.videoName = fileName;
      video.modificationDate = stat.mtime;
      // サムネイルが後から追加された場合も反映
      if (thumbUrl) {
        video.thumbUrl = thumbUrl;
      }
      if (meta) {
        video.tagStrings = meta.tags;
        video.time = meta.length;
        video.pubDate = meta.pubDate;
        video.description = meta.description;
      }
    }

    library.videoDao.insertOrUpdate(video, ensureDirId(path.dirname(filePath)));
    return existing ? 'updated' : 'added';
  }

  /**
   * 動画ファイルを持たない動画の I/O 部分。DB には触れない。
   * `[ThumbInfo].xml` が無ければ動画の情報が分からないので登録しない。
   */
  private static async prepareCommentOnly(
    entry: CommentXmlEntry,
    snapshot: ReadonlyMap<string, ScanSnapshotRow>,
    full: boolean
  ): Promise<PreparedCommentOnly> {
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(entry.filePath);
    } catch (e) {
      log.warn('stat failed:', entry.filePath, e);
      return { kind: 'skip' };
    }
    const sn = snapshot.get(entry.videoId);
    // 「コメントのみ」はサムネが無いことも普通にあるので、動画と違い thumbUrl の有無は問わない
    if (!full && sn && sn.uri === entry.filePath && sn.time > 0 && sameMtime(sn.modificationDate, stat)) {
      return { kind: 'unchanged' };
    }
    const { dir, baseName } = entry;
    const meta = await this.readThumbMeta(path.join(dir, `${baseName}${VideoFileSuffix.THUMB_INFO_XML}`));
    if (!meta) return { kind: 'skip' };
    const thumbNew = path.join(dir, `${baseName}${VideoFileSuffix.THUMB_IMAGE}`);
    const thumbLegacy = path.join(dir, `${baseName}${VideoFileSuffix.THUMB_IMAGE_LEGACY}`);
    const thumbUrl = (await fileExists(thumbNew)) ? thumbNew : (await fileExists(thumbLegacy)) ? thumbLegacy : '';
    return { kind: 'register', entry, stat, thumbUrl, meta };
  }

  /**
   * 動画ファイルを持たない動画を、コメントXMLを uri として登録 (同期。トランザクション内から呼ぶ)。
   */
  private static commitCommentOnly(
    library: LibraryManager,
    prepared: Extract<PreparedCommentOnly, { kind: 'register' }>,
    ensureDirId: (dir: string) => number
  ): 'added' | 'updated' {
    const { entry, stat, thumbUrl, meta } = prepared;
    const existing = library.videoDao.getByKey(entry.videoId, true);
    const video: NNDDREVideo = {
      id: existing?.id ?? 0,
      uri: entry.filePath,
      videoName: path.basename(entry.filePath),
      tagStrings: meta.tags,
      modificationDate: stat.mtime,
      creationDate: existing?.creationDate ?? (stat.birthtime || stat.ctime),
      thumbUrl,
      playCount: existing?.playCount ?? 0,
      time: meta.length,
      lastPlayDate: existing?.lastPlayDate ?? null,
      yetReading: existing?.yetReading ?? true,
      pubDate: meta.pubDate,
      isFavorite: existing?.isFavorite ?? false,
      description: meta.description
    };
    library.videoDao.insertOrUpdate(video, ensureDirId(entry.dir));
    return existing ? 'updated' : 'added';
  }

  /**
   * 同じ動画IDのファイルが複数あるときの優先度 (大きいほど優先)。
   * .swf は .flv より後回しにする。
   */
  private static filePriority(filePath: string): number {
    return path.extname(filePath).toLowerCase() === '.swf' ? 0 : 1;
  }

  static extractVideoId(baseName: string): string | null {
    return extractBracketedVideoId(baseName);
  }

  /**
   * 指定ディレクトリ内で、ファイル名に videoId を含む全ファイルを検索する。
   * 動画本体・コメントXML・サムネ等のサフィックスを個別に列挙する代わりに、
   * 動画IDから逆引きすることでサフィックス漏れやファイル名のズレを吸収する。
   * ニコ割素材 ([Nicowari]) は本体と同じ videoId を名乗るため除外する。
   */
  static findRelatedFiles(dir: string, videoId: string): string[] {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    return entries
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .filter((name) => {
        if (name.includes('[Nicowari]')) return false;
        const base = name.replace(/\.[^.]+$/, '');
        return this.extractVideoId(base) === videoId;
      })
      .map((name) => path.join(dir, name));
  }

  static extractTitle(baseName: string, videoId: string | null): string {
    if (!videoId) return baseName;
    // 新形式: "タイトル - [sm123]" → "タイトル"
    // 旧形式: "[sm123]タイトル" → "タイトル"
    return baseName
      .replace(` - [${videoId}]`, '')
      .replace(`[${videoId}]`, '')
      .trim();
  }

  /**
   * `[ThumbInfo].xml` を読んで補完情報を返す。
   * なければ旧 `[info].txt` を試みる (後方互換)。
   */
  private static async readThumbMeta(thumbInfoXmlPath: string): Promise<ThumbMeta | null> {
    // 新形式: [ThumbInfo].xml
    const text = await readTextIfExists(thumbInfoXmlPath);
    const parsed = text === null ? null : ThumbInfoXmlReader.parse(text);
    if (parsed) {
      return {
        tags: parsed.tags,
        length: parsed.length,
        pubDate: parsed.registeredAt ? new Date(parsed.registeredAt) : null,
        description: parsed.description
      };
    }
    // 旧形式: [info].txt (後方互換)
    const legacyText = await readTextIfExists(thumbInfoXmlPath.replace('[ThumbInfo].xml', '[info].txt'));
    let legacy: ReturnType<typeof InfoTxtReader.parse> | null = null;
    if (legacyText !== null) {
      try {
        legacy = InfoTxtReader.parse(legacyText);
      } catch (e) {
        log.warn('InfoTxtReader.parse failed:', thumbInfoXmlPath, e);
      }
    }
    if (legacy) {
      return {
        tags: legacy.tags,
        length: legacy.length,
        pubDate: legacy.registeredAt ? new Date(legacy.registeredAt) : null,
        description: legacy.description
      };
    }
    return null;
  }
}
