import type { NNDDREComment, WatchPageInfo } from '@shared/types';
import { NicoEndpoint } from '@shared/constants';
import { NicoContext } from '../NicoContext';
import { NicoApiError } from '../NicoHttp';
import { CommentCommandParser } from './CommentCommandParser';
import { createLogger } from '../../util/Logger';
import * as path from 'path';
import type { NicoV3CommentResponse, NicoV3CommentItem } from '../apiTypes';

const log = createLogger('CommentClient');

/**
 * コメントAPI グローバルレートリミッター (トークンバケット)。
 * 実機計測 (2026-10-08) で、約100リクエストのバーストで 429 になり、約3分で回復することを確認した。
 * 補充速度は実測 (約0.5 req/s) より低い 0.4 req/s にして、容量も 60 に抑える。
 * 全DL・再生取得で共有するので、並列DLでも合算で制御される。
 */
const BUCKET_CAPACITY = 60;
const REFILL_PER_SEC = 0.4;

class CommentRateLimiter {
  private tokens = BUCKET_CAPACITY;
  private lastRefill = Date.now();
  private lock = Promise.resolve();

  private refill(): void {
    const now = Date.now();
    this.tokens = Math.min(BUCKET_CAPACITY, this.tokens + ((now - this.lastRefill) / 1000) * REFILL_PER_SEC);
    this.lastRefill = now;
  }

  acquire(signal?: AbortSignal): Promise<void> {
    this.lock = this.lock.then(async () => {
      if (signal?.aborted) return;
      this.refill();
      if (this.tokens < 1) {
        const wait = Math.ceil(((1 - this.tokens) / REFILL_PER_SEC) * 1000);
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, wait);
          signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
        });
        if (signal?.aborted) return;
        this.refill();
      }
      this.tokens = Math.max(0, this.tokens - 1);
    });
    return this.lock;
  }

  /** 429 を受けたとき枠を空にする (待機明けから補充速度で再開させる) */
  drain(): void {
    this.tokens = 0;
    this.lastRefill = Date.now();
  }
}

const rateLimiter = new CommentRateLimiter();

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

    const url = NicoEndpoint.commentThreads(watch.commentServerUrl);
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
    let res: NicoV3CommentResponse;
    try {
      res = await NicoContext.get().http.postJson<NicoV3CommentResponse>(url, body, {
        debugDumpPath,
        debugLabel: 'comment'
      });
    } catch (e) {
      if (e instanceof NicoApiError && e.httpStatus === 429) rateLimiter.drain();
      throw e;
    }

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
      /**
       * threadKey が期限切れ (EXPIRED_TOKEN) になったときに視聴情報を取り直す関数。
       * threadKey の寿命は約8分で、大量コメントの取得は途中で切れるため、指定すると
       * 新しい threadKey で中断位置から再開する。未指定なら期限切れで取得を打ち切る
       */
      refreshWatch?: () => Promise<WatchPageInfo>;
      /** 遡り開始時刻 (Unix秒)。未指定なら現在時刻 */
      startWhenUnixSec?: number;
      /**
       * 遡りの打ち切り時刻 (Unix秒)。取得済みコメントの最新投稿時刻を渡すと、
       * その時刻を含む区間まで遡った時点でスレッドの取得を終える (差分取得用)
       */
      stopAtUnixSec?: number;
      /** 累積取得件数の上限。到達したら全スレッドの取得を打ち切る */
      maxTotalCount?: number;
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
    // 取り直した直後にまた期限切れになる場合に備えた、成功を挟まない連続リフレッシュの上限
    const MAX_CONSECUTIVE_REFRESHES = 3;
    let threadKey = watch.threadKey;
    let consecutiveRefreshes = 0;
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
    const targets = (watch.nvCommentParams?.targets
      ?? watch.commentThreads
          .filter((t) => t.isActive)
          .map((t) => ({ id: t.id, fork: normalizeFork(t.fork) })))
      // owner (投稿者コメント) は数が少ないため、件数上限到達で main に押し出されて
      // 欠落しないよう先に処理する
      .slice()
      .sort((a, b) => (a.fork === 'owner' ? -1 : 0) - (b.fork === 'owner' ? -1 : 0));
    const language = watch.nvCommentParams?.language ?? 'ja-jp';
    const url = NicoEndpoint.commentThreads(watch.commentServerUrl);

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
    // maxTotalCount 到達で全スレッドの取得を打ち切るためのフラグ
    let reachedLimit = false;
    // 全滅判定用 (最初のラウンドが失敗したターゲット数 === 処理対象ターゲット数 なら例外化)
    let processedTargetCount = 0;
    let firstRoundFailures = 0;

    for (const target of targets) {
      if (reachedLimit) break;
      // easy スレッドはオプションで制御 (増量コメントで量が多く、デフォルトはスキップ)
      if (target.fork === 'easy' && !includeEasy) continue;
      processedTargetCount++;

      let lastTime = options?.startWhenUnixSec ?? Math.floor(Date.now() / 1000);
      let retries429 = 0;

      for (let round = 0; round < maxRounds; round++) {
        if (signal?.aborted) break;

        const body = {
          params: { targets: [target], language },
          threadKey,
          additionals: {
            when: lastTime,
            res_from: -1000
          }
        };

        let res: NicoV3CommentResponse;
        try {
          await rateLimiter.acquire(signal);
          if (signal?.aborted) break;
          res = await NicoContext.get().http.postJson<NicoV3CommentResponse>(url, body, {
            debugDumpPath,
            debugLabel: `comment-${target.fork}-r${round}`
          });
          retries429 = 0;
          consecutiveRefreshes = 0;
        } catch (e) {
          if (e instanceof NicoApiError && e.errorCode === 'EXPIRED_TOKEN' && options?.refreshWatch
              && consecutiveRefreshes < MAX_CONSECUTIVE_REFRESHES && !signal?.aborted) {
            consecutiveRefreshes++;
            try {
              const fresh = await options.refreshWatch();
              if (fresh.threadKey) {
                threadKey = fresh.threadKey;
                log.info(`threadKey expired, refreshed (${consecutiveRefreshes}/${MAX_CONSECUTIVE_REFRESHES}) thread=${target.id} round=${round}`);
                onProgress?.(`threadKey を更新して再開 (${target.fork} / ${seen.size} 件取得)`);
                round--;
                continue;
              }
            } catch (refreshErr) {
              log.warn('threadKey refresh failed:', refreshErr);
            }
          }
          if (e instanceof NicoApiError && e.httpStatus === 429) rateLimiter.drain();
          if (e instanceof NicoApiError && e.httpStatus === 429 && retryWaitSec > 0 && retries429 < MAX_429_RETRIES) {
            retries429++;
            onProgress?.(`429 レート制限: ${retryWaitSec}秒待機中... (${retries429}/${MAX_429_RETRIES})`);
            log.warn(`429 rate limit, waiting ${retryWaitSec}s (retry ${retries429}/${MAX_429_RETRIES})`);
            await delay(retryWaitSec * 1000);
            // 待機中に溜まったトークンで再びバーストして 429 を繰り返さないよう、補充速度から再開する
            rateLimiter.drain();
            round--;
            continue;
          }
          log.warn(`fetchAllComments thread=${target.id} round=${round} failed:`, e);
          if (round === 0) firstRoundFailures++;
          break;
        }

        if (res.meta?.errorCode === 'EXPIRED_TOKEN') {
          log.warn('threadKey expired during fetchAllComments — stopping loop');
          break;
        }

        const threads = res?.data?.threads ?? [];
        const batch: NicoV3CommentItem[] = threads.flatMap((t) => t.comments ?? []);

        if (batch.length === 0) {
          log.verbose(`thread=${target.id} round=${round}: no more comments`);
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

        if (options?.maxTotalCount && seen.size >= options.maxTotalCount) {
          log.verbose(`reached maxTotalCount=${options.maxTotalCount}`);
          reachedLimit = true;
          break;
        }

        // 先頭コメント no < 5 → スレッドの最初に到達
        const minNo = Math.min(...batch.map((c) => c.no));
        if (minNo < 5) {
          log.verbose(`thread=${target.id}: reached beginning at round=${round}`);
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

        // 取得済みの区間まで遡った。重複分は呼び出し側で (thread, no) 照合して除く
        if (options?.stopAtUnixSec && earliestSec <= options.stopAtUnixSec) {
          log.verbose(`thread=${target.id}: reached stopAt at round=${round}`);
          break;
        }

        if (earliestSec >= lastTime) {
          // 同一秒に1000件以上集中 → 1秒前にスキップして継続
          lastTime = lastTime - 1;
          if (lastTime <= 0) break;
          continue;
        }
        lastTime = earliestSec;
      }
    }

    let result = Array.from(seen.values());
    if (options?.maxTotalCount && result.length > options.maxTotalCount) {
      // 上限超過分は末尾 (=より古いコメント) 側を切り捨てる
      result = result.slice(0, options.maxTotalCount);
    }
    if (result.length === 0 && processedTargetCount > 0 && firstRoundFailures === processedTargetCount) {
      throw new Error('コメント取得に失敗しました (ネットワークエラーの可能性があります)');
    }
    return result;
  }

  private static toNNDDREComment(
    c: NicoV3CommentItem,
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
