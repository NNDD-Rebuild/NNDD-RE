import type { Schedule } from '@shared/types';
import { LibraryManager } from '../db/LibraryManager';
import { MyListAutoDownloader } from './MyListAutoDownloader';
import { createLogger } from '../util/Logger';

const log = createLogger('Scheduler');

/**
 * スケジュール実行マネージャ。
 *
 * 元: src/org/mineap/nndd/download/ScheduleManager.as
 *
 * - 1分ごとに現在時刻と曜日をチェック
 * - 該当する有効なスケジュールがあればマイリスト更新+自動DLを発火
 * - 同じ分内で2回発火しないように lastRun を記録
 */
export class ScheduleManager {
  private intervalId: NodeJS.Timeout | null = null;

  constructor(
    private readonly library: LibraryManager,
    private readonly mylistDownloader: MyListAutoDownloader
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
    log.info(`executing schedule: ${s.name} (${s.targetMyListUrl})`);

    // 対象のマイリストを取得
    const myList = this.library.myListDao
      .list()
      .find((ml) => ml.myListUrl === s.targetMyListUrl);
    if (!myList) {
      log.warn(`schedule target mylist not found: ${s.targetMyListUrl}`);
      return;
    }

    try {
      const r = await this.mylistDownloader.renew(myList);
      log.info(
        `schedule done: ${s.name} fetched=${r.fetched} queued=${r.queued}`
      );
    } catch (e) {
      log.warn(`schedule execution failed: ${s.name}`, e);
    } finally {
      // 最終実行時刻を更新
      this.library.scheduleDao.upsert({ ...s, lastRun: now });
    }
  }
}
