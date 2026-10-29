import type { Schedule } from '@shared/types';
import { NnddDatabase } from '../Database';
import { Q } from '../schema';

interface ScheduleRow {
  id: string;
  name: string;
  targetType: string | null;
  targetMyListUrl: string;
  targetId: string | null;
  daysOfWeek: string;
  time: string;
  enabled: number;
  lastRun: number | null;
  makeSubfolder: number | null;
}

/**
 * スケジュール DAO
 * 元: src/org/mineap/nndd/download/ScheduleManager.as
 *
 * スケジュールはニコニコのアカウントごとに持つ (実行時に使う Cookie がアカウントのものなので)。
 */
export class ScheduleDao {
  constructor(private readonly db: NnddDatabase) {}

  list(account: string): Schedule[] {
    const rows = this.db.prepare(Q.SELECT_SCHEDULES).all(account) as ScheduleRow[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      targetType: (r.targetType as Schedule['targetType']) || 'mylist',
      targetMyListUrl: r.targetMyListUrl,
      targetId: r.targetId ?? '',
      daysOfWeek: r.daysOfWeek.split(',').filter((x) => x).map(Number),
      time: r.time,
      enabled: r.enabled === 1,
      makeSubfolder: r.makeSubfolder === 1,
      lastRun: r.lastRun ? new Date(r.lastRun * 1000) : null
    }));
  }

  upsert(account: string, s: Schedule): void {
    this.db
      .prepare(Q.INSERT_SCHEDULE)
      .run(
        s.id,
        account,
        s.name,
        s.targetType || 'mylist',
        s.targetMyListUrl,
        s.targetId || null,
        s.daysOfWeek.join(','),
        s.time,
        s.enabled ? 1 : 0,
        s.lastRun ? s.lastRun.getTime() / 1000 : null,
        s.makeSubfolder ? 1 : 0
      );
  }

  /** 最終実行時刻だけ更新する (実行中に編集された他の項目を上書きしない。削除済みなら何もしない) */
  setLastRun(account: string, id: string, lastRun: Date): void {
    this.db.prepare(Q.UPDATE_SCHEDULE_LAST_RUN).run(lastRun.getTime() / 1000, account, id);
  }

  remove(account: string, id: string): void {
    this.db.prepare(Q.DELETE_SCHEDULE).run(account, id);
  }

  /** そのアカウントの全スケジュールを削除 */
  clearAll(account: string): void {
    this.db.prepare(Q.DELETE_ALL_SCHEDULE).run(account);
  }
}
