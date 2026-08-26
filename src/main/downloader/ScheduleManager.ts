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
 * - 1分ごとに現在時刻と曜日をチェック
 * - 該当する有効なスケジュールがあれば対象種別(マイリスト/シリーズ/フォロー投稿者)に応じた
 *   更新+自動DLを発火
 * - 同じ分内で2回発火しないように lastRun を記録
 */
export class ScheduleManager {
  private intervalId: NodeJS.Timeout | null = null;

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
    const now = new Date();
    const day = now.getDay(); // 0=日 .. 6=土
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(
      now.getMinutes()
    ).padStart(2, '0')}`;
    const schedules = this.library.scheduleDao.list();
    for (const s of schedules) {
      if (!s.enabled) continue;
      if (!s.daysOfWeek.includes(day)) continue;
      if (s.time !== hhmm) continue;
      // 同じ分内では再実行しない
      if (this.alreadyRanThisMinute(s, now)) continue;

      await this.execute(s, now);
    }
  }

  private alreadyRanThisMinute(s: Schedule, now: Date): boolean {
    if (!s.lastRun) return false;
    const a = new Date(s.lastRun);
    return (
      a.getFullYear() === now.getFullYear() &&
      a.getMonth() === now.getMonth() &&
      a.getDate() === now.getDate() &&
      a.getHours() === now.getHours() &&
      a.getMinutes() === now.getMinutes()
    );
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
