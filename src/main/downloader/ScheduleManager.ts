import type { Schedule } from '@shared/types';
import { ScheduleTargetType } from '@shared/types';
import { LibraryManager } from '../db/LibraryManager';
import { MyListAutoDownloader } from './MyListAutoDownloader';
import { SeriesAutoDownloader } from './SeriesAutoDownloader';
import { FollowUserAutoDownloader } from './FollowUserAutoDownloader';
import { createLogger } from '../util/Logger';

const log = createLogger('Scheduler');

/**
 * スケジュール実行マネージャ。
 *
 * 元: src/org/mineap/nndd/download/ScheduleManager.as
 *
 * - 起動時と1分ごとに現在時刻と曜日をチェック
 * - 前回実行以降に設定時刻を過ぎている有効なスケジュールがあれば、
 *   対象種別(マイリスト/シリーズ/フォロー投稿者)に応じた更新+自動DLを1件ずつ順番に発火
 * - 二重実行しないように lastRun を記録
 */
export class ScheduleManager {
  private intervalId: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly library: LibraryManager,
    private readonly mylistDownloader: MyListAutoDownloader,
    private readonly seriesDownloader: SeriesAutoDownloader,
    private readonly followUserDownloader: FollowUserAutoDownloader
  ) {}

  /** スケジュール監視を開始 */
  start(): void {
    this.stop();
    log.info('scheduler started');
    this.intervalId = setInterval(() => this.tick(), 60_000); // 1分毎
    // 初回は即座にチェック (起動時刻が分跨ぎだった場合の取り逃がし防止)
    this.tick();
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private async tick(): Promise<void> {
    // 前回の tick が実行中なら重ねない (スケジュールは1件ずつ順番に処理する)
    if (this.running) return;
    this.running = true;
    try {
      const now = new Date();
      const schedules = this.library.scheduleDao.list();
      for (const s of schedules) {
        if (!this.isDue(s, now)) continue;
        await this.execute(s, now);
      }
    } finally {
      this.running = false;
    }
  }

  /**
   * 実行すべきか判定する。
   * - 直近の設定時刻 (対象曜日、現在時刻以前、最大7日前まで遡る) を求め、最終実行がそれより前なら実行する。
   *   前回実行から今回までの間に設定時刻を過ぎていれば、何日空いていても1回だけ実行する
   *   (起動していなかった・スリープ中だった分の取り逃がしを拾う)
   * - 一度も実行していないスケジュールは、作成直後の誤発火を避けるため設定時刻ちょうどの分のみ
   */
  private isDue(s: Schedule, now: Date): boolean {
    if (!s.enabled) return false;
    const [h, m] = s.time.split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return false;
    let latest: Date | null = null;
    for (let back = 0; back <= 7 && !latest; back++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back, h, m, 0, 0);
      if (d <= now && s.daysOfWeek.includes(d.getDay())) latest = d;
    }
    if (!latest) return false;
    if (!s.lastRun) return now.getTime() - latest.getTime() < 60_000;
    return new Date(s.lastRun) < latest;
  }

  private async execute(s: Schedule, now: Date): Promise<void> {
    const targetType = s.targetType || ScheduleTargetType.MYLIST;
    log.info(`executing schedule: ${s.name} (${targetType})`);

    try {
      switch (targetType) {
        case ScheduleTargetType.SERIES: {
          if (!s.targetId) {
            log.warn(`schedule target series id missing: ${s.name}`);
            return;
          }
          const r = await this.seriesDownloader.renew(s.targetId);
          log.info(`schedule done: ${s.name} fetched=${r.fetched} queued=${r.queued}`);
          return;
        }
        case ScheduleTargetType.FOLLOW_USER: {
          if (!s.targetId) {
            log.warn(`schedule target user id missing: ${s.name}`);
            return;
          }
          const r = await this.followUserDownloader.renew(s.targetId);
          log.info(`schedule done: ${s.name} fetched=${r.fetched} queued=${r.queued}`);
          return;
        }
        case ScheduleTargetType.MYLIST:
        default: {
          const myList = this.library.myListDao
            .list()
            .find((ml) => ml.myListUrl === s.targetMyListUrl);
          if (!myList) {
            log.warn(`schedule target mylist not found: ${s.targetMyListUrl}`);
            return;
          }
          const r = await this.mylistDownloader.renew(myList);
          log.info(`schedule done: ${s.name} fetched=${r.fetched} queued=${r.queued}`);
          return;
        }
      }
    } catch (e) {
      log.warn(`schedule execution failed: ${s.name}`, e);
    } finally {
      // 最終実行時刻を更新
      this.library.scheduleDao.upsert({ ...s, lastRun: now });
    }
  }
}
