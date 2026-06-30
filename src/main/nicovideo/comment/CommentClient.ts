import type { NNDDREComment, WatchPageInfo } from '@shared/types';
import { NicoContext } from '../NicoContext';
import { CommentCommandParser } from './CommentCommandParser';
import { createLogger } from '../../util/Logger';
import * as path from 'path';

const log = createLogger('CommentClient');

/** コメントAPI グローバルレートリミッター (3 req/sec) */
class CommentRateLimiter {
  private lastTime = 0;
  private lock = Promise.resolve();
  private readonly intervalMs: number;

  constructor(requestsPerSec: number) {
    this.intervalMs = Math.ceil(1000 / requestsPerSec);
  }

  acquire(signal?: AbortSignal): Promise<void> {
    this.lock = this.lock.then(async () => {
      const wait = this.intervalMs - (Date.now() - this.lastTime);
      if (wait > 0 && !signal?.aborted) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, wait);
          signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
        });
      }
      this.lastTime = Date.now();
    });
    return this.lock;
  }
}

const rateLimiter = new CommentRateLimiter(3);

interface V3CommentResponse {
  data?: {
    threads?: Array<{
      id: string;
      fork: string;
      commentCount?: number;
      comments?: V3CommentItem[];
    }>;
  };
  meta?: {
    status: number;
    errorCode?: string;
  };
}

interface V3CommentItem {
  id: string;
  no: number;
  vposMs: number;
  body: string;
  commands?: string[];
  userId: string;
  isPremium?: boolean;
  isMyPost?: boolean;
  nicoruCount?: number;
  score?: number;
  postedAt?: string;
  source?: string;
}

/**
 * 新コメントAPI (V3) クライアント。
 * 元: Niconicome-develop の CommentClient.cs (V3版)
 *
 * エンドポイント: POST {commentServer}/v1/threads
 */
export class CommentClient {
  /**
   * 最新コメントを1リクエストで取得 (再生時に使用)。
   */
  static async fetchComments(watch: WatchPageInfo): Promise<NNDDREComment[]> {
    if (!watch.threadKey) {
      throw new Error('threadKey が watch ページから取得できませんでした');
    }
    if (watch.commentThreads.length === 0) {
      throw new Error('コメントスレッドが見つかりません');
    }

    const normalizeFork = (fork: string | number): string => {
      const s = String(fork);
      if (s === '0') return 'main';
      if (s === '1') return 'owner';
      if (s === '2') return 'easy';
      return s;
    };
    const targets = watch.nvCommentParams?.targets
      ?? watch.commentThreads
          .filter((t) => t.isActive)
          .map((t) => ({ id: t.id, fork: normalizeFork(t.fork) }));
    const language = watch.nvCommentParams?.language ?? 'ja-jp';

    const body = {
      params: { targets, language },
      threadKey: watch.threadKey,
      additionals: {}
    };

    const url = `${watch.commentServerUrl.replace(/\/$/, '')}/v1/threads`;
    log.debug('POST comments:', url, body);

    // debugDumpPath の設定 (設定画面から有効化)
    let debugDumpPath: string | undefined;
    const configStore = (await import('../../config/ConfigStore')).getConfigStore();
    const developerEnabled = configStore.get('developer.enabled') ?? false;
    const developerTargets = configStore.get('developer.apiDumpTargets') ?? [];

    if (developerEnabled && developerTargets.includes('comment')) {
      debugDumpPath = configStore.get('developer.apiDumpPath') || path.join(process.cwd(), 'apitest');
      log.verbose(`Comment API dump enabled: ${debugDumpPath}`);
    }

    await rateLimiter.acquire();
    const res = await NicoContext.get().http.postJson<V3CommentResponse>(url, body, {
      debugDumpPath,
      debugLabel: 'comment'
    });

    const out: NNDDREComment[] = [];
    for (const t of res?.data?.threads ?? []) {
      const fork = t.fork ?? 'main';
      for (const c of t.comments ?? []) {
        out.push(this.toNNDDREComment(c, t.id, fork));
      }
    }
    return out;
  }

  /**
   * 全コメント取得 (ダウンロード時用)。
   * comment-zouryou 方式: additionals.when を遡りながらループ取得し、
   * すべてのコメントを1つの配列にマージして返す。
   *
   * @param maxRoundsPerThread スレッドごとの最大ループ回数 (デフォルト 100 = ~10万件/スレッド)
   * @param onProgress 進捗コールバック (round, totalFetched)
   */
  static async fetchAllComments(
    watch: WatchPageInfo,
    options?: {
      maxRoundsPerThread?: number;
      onProgress?: (msg: string) => void;
      /** easy スレッド (増量コメント) を取得するか。デフォルト false */
      includeEasy?: boolean;
      /** HTTP 429 時の待機秒数。0=リトライなし。デフォルト 60 */
      comment429RetryWaitSec?: number;
      /** キャンセル用シグナル */
      signal?: AbortSignal;
    }
  ): Promise<NNDDREComment[]> {
    if (!watch.threadKey) {
      throw new Error('threadKey が取得できません');
    }
    if (watch.commentThreads.length === 0) {
      throw new Error('コメントスレッドが見つかりません');
    }

    // 上限を実質撤廃 (batch.length===0 または minNo<5 で自然終了)
    const maxRounds = options?.maxRoundsPerThread ?? 10_000;
    const onProgress = options?.onProgress;
    const includeEasy = options?.includeEasy ?? false;
    const retryWaitSec = options?.comment429RetryWaitSec ?? 60;
    const signal = options?.signal;
    const MAX_429_RETRIES = 5;
    const delay = (ms: number): Promise<void> => new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
    });

    const normalizeFork = (fork: string | number): string => {
      const s = String(fork);
      if (s === '0') return 'main';
      if (s === '1') return 'owner';
      if (s === '2') return 'easy';
      return s;
    };
    const targets = watch.nvCommentParams?.targets
      ?? watch.commentThreads
          .filter((t) => t.isActive)
          .map((t) => ({ id: t.id, fork: normalizeFork(t.fork) }));
    const language = watch.nvCommentParams?.language ?? 'ja-jp';
    const url = `${watch.commentServerUrl.replace(/\/$/, '')}/v1/threads`;

    // debugDumpPath の設定 (設定画面から有効化)
    let debugDumpPath: string | undefined;
    const configStore = (await import('../../config/ConfigStore')).getConfigStore();
    const developerEnabled = configStore.get('developer.enabled') ?? false;
    const developerTargets = configStore.get('developer.apiDumpTargets') ?? [];

    if (developerEnabled && developerTargets.includes('comment')) {
      debugDumpPath = configStore.get('developer.apiDumpPath') || path.join(process.cwd(), 'apitest');
      log.verbose(`Comment API dump enabled: ${debugDumpPath}`);
    }

    // スレッドごとの重複排除 Map (key: `${threadId}:${no}`)
    const seen = new Map<string, NNDDREComment>();

    for (const target of targets) {
      // easy スレッドはオプションで制御 (増量コメントで量が多く、デフォルトはスキップ)
      if (target.fork === 'easy' && !includeEasy) continue;

      let lastTime = Math.floor(Date.now() / 1000);
      let retries429 = 0;

      for (let round = 0; round < maxRounds; round++) {
        if (signal?.aborted) break;

        const body = {
          params: { targets: [target], language },
          threadKey: watch.threadKey,
          additionals: {
            when: lastTime,
            res_from: -1000
          }
        };

        let res: V3CommentResponse;
        try {
          await rateLimiter.acquire(signal);
          if (signal?.aborted) break;
          res = await NicoContext.get().http.postJson<V3CommentResponse>(url, body, {
            debugDumpPath,
            debugLabel: `comment-${target.fork}-r${round}`
          });
          retries429 = 0;
        } catch (e) {
          if (String(e).includes('429') && retryWaitSec > 0 && retries429 < MAX_429_RETRIES) {
            retries429++;
            onProgress?.(`429 レート制限: ${retryWaitSec}秒待機中... (${retries429}/${MAX_429_RETRIES})`);
            log.warn(`429 rate limit, waiting ${retryWaitSec}s (retry ${retries429}/${MAX_429_RETRIES})`);
            await delay(retryWaitSec * 1000);
            round--;
            continue;
          }
          log.warn(`fetchAllComments thread=${target.id} round=${round} failed:`, e);
          break;
        }

        if (res.meta?.errorCode === 'EXPIRED_TOKEN') {
          log.warn('threadKey expired during fetchAllComments — stopping loop');
          break;
        }

        const threads = res?.data?.threads ?? [];
        const batch: V3CommentItem[] = threads.flatMap((t) => t.comments ?? []);

        if (batch.length === 0) {
          log.debug(`thread=${target.id} round=${round}: no more comments`);
          break;
        }

        const threadId = threads[0]?.id ?? target.id;
        const fork = threads[0]?.fork ?? target.fork;

        for (const c of batch) {
          const key = `${threadId}:${c.no}`;
          if (!seen.has(key)) {
            seen.set(key, this.toNNDDREComment(c, threadId, fork));
          }
        }

        onProgress?.(`コメント取得中 (${target.fork} / ${seen.size} 件取得)`);

        // 先頭コメント no < 5 → スレッドの最初に到達
        const minNo = Math.min(...batch.map((c) => c.no));
        if (minNo < 5) {
          log.debug(`thread=${target.id}: reached beginning at round=${round}`);
          break;
        }

        // 最も古いコメントの postedAt を次の when に
        const earliest = batch.reduce((a, b) => {
          const ta = a.postedAt ? new Date(a.postedAt).getTime() : 0;
          const tb = b.postedAt ? new Date(b.postedAt).getTime() : 0;
          return ta < tb ? a : b;
        });
        const earliestSec = earliest.postedAt
          ? Math.floor(new Date(earliest.postedAt).getTime() / 1000)
          : lastTime - 1;

        if (earliestSec >= lastTime) {
          // 同一秒に1000件以上集中 → 1秒前にスキップして継続
          lastTime = lastTime - 1;
          if (lastTime <= 0) break;
          continue;
        }
        lastTime = earliestSec;
      }
    }

    return Array.from(seen.values());
  }

  /**
   * 過去コメント取得 (プレイヤー表示用 — 指定日時以前の最大1000件/スレッド)。
   * comment-zouryou と同じ方式: additionals.when に Unix 秒, res_from=-1000
   */
  static async fetchPastComments(
    watch: WatchPageInfo,
    whenUnixSec: number
  ): Promise<NNDDREComment[]> {
    if (!watch.threadKey) {
      throw new Error('threadKey が取得できません');
    }
    if (watch.commentThreads.length === 0) {
      throw new Error('コメントスレッドが見つかりません');
    }

    const normalizeFork = (fork: string | number): string => {
      const s = String(fork);
      if (s === '0') return 'main';
      if (s === '1') return 'owner';
      if (s === '2') return 'easy';
      return s;
    };
    const targets = watch.nvCommentParams?.targets
      ?? watch.commentThreads
          .filter((t) => t.isActive)
          .map((t) => ({ id: t.id, fork: normalizeFork(t.fork) }));
    const language = watch.nvCommentParams?.language ?? 'ja-jp';
    const url = `${watch.commentServerUrl.replace(/\/$/, '')}/v1/threads`;
    const out: NNDDREComment[] = [];

    for (const target of targets) {
      if (target.fork === 'easy') continue;
      const body = {
        params: { targets: [target], language },
        threadKey: watch.threadKey,
        additionals: { when: whenUnixSec, res_from: -1000 }
      };
      try {
        await rateLimiter.acquire();
        const res = await NicoContext.get().http.postJson<V3CommentResponse>(url, body);
        for (const t of res?.data?.threads ?? []) {
          const fork = t.fork ?? target.fork ?? 'main';
          for (const c of t.comments ?? []) {
            out.push(this.toNNDDREComment(c, t.id, fork));
          }
        }
      } catch (e) {
        log.warn(`fetchPastComments thread ${target.id} failed:`, e);
      }
    }
    return out;
  }

  private static toNNDDREComment(
    c: V3CommentItem,
    threadId: string,
    fork: string
  ): NNDDREComment {
    const isPremium = Boolean(c.isPremium);
    const cmd = CommentCommandParser.parse(c.commands, isPremium);
    const date = c.postedAt ? Math.floor(new Date(c.postedAt).getTime() / 1000) : 0;
    return {
      thread: threadId,
      no: c.no,
      vposMs: c.vposMs,
      date,
      mail: (c.commands ?? []).join(' '),
      userId: c.userId,
      text: c.body,
      isPremium,
      isAnonymity: /^[0-9a-f-]{30,}$/i.test(c.userId),
      isShow: true,
      sizeCommand: cmd.size,
      positionCommand: cmd.position,
      color: cmd.color,
      nicoruCount: c.nicoruCount,
      score: c.score,
      fork
    };
  }
}
