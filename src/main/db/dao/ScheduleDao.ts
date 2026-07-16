import type { Schedule } from '@shared/types';
import { NnddDatabase } from '../Database';
import { Q } from '../schema';

interface ScheduleRow {
  id: string;
  name: string;
  targetMyListUrl: string;
  daysOfWeek: string;
  time: string;
  enabled: number;
  lastRun: number | null;
}

/**
 * スケジュール DAO
 * 元: src/org/mineap/nndd/download/ScheduleManager.as
 */
export class ScheduleDao {
  constructor(private readonly db: NnddDatabase) {}

  list(): Schedule[] {
    const rows = this.db.prepare(Q.SELECT_SCHEDULES).all() as ScheduleRow[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      targetMyListUrl: r.targetMyListUrl,
      daysOfWeek: r.daysOfWeek.split(',').filter((x) => x).map(Number),
      time: r.time,
      enabled: r.enabled === 1,
      lastRun: r.lastRun ? new Date(r.lastRun * 1000) : null
    }));
  }

  upsert(s: Schedule): void {
    this.db
      .prepare(Q.INSERT_SCHEDULE)
      .run(
        s.id,
        s.name,
        s.targetMyListUrl,
        s.daysOfWeek.join(','),
        s.time,
        s.enabled ? 1 : 0,
        s.lastRun ? s.lastRun.getTime() / 1000 : null
      );
  }

  remove(id: string): void {
    this.db.prepare(Q.DELETE_SCHEDULE).run(id);
  }

  /** 全スケジュールを削除 */
  clearAll(): void {
    this.db.prepare(Q.DELETE_ALL_SCHEDULE).run();
  }
}
