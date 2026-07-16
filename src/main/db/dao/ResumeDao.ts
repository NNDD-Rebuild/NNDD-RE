import type { ResumePosition } from '@shared/types';
import { NnddDatabase } from '../Database';
import { Q } from '../schema';

interface ResumeRow {
  videoKey: string;
  positionSec: number;
  durationSec: number;
  updatedAt: number;
}

/**
 * 動画ごとの再生位置レジューム DAO
 */
export class ResumeDao {
  constructor(private readonly db: NnddDatabase) {}

  get(videoKey: string): ResumePosition | null {
    const row = this.db.prepare(Q.SELECT_RESUME).get(videoKey) as ResumeRow | undefined;
    if (!row) return null;
    return this.rowToResume(row);
  }

  save(videoKey: string, positionSec: number, durationSec: number): void {
    this.db.prepare(Q.UPSERT_RESUME).run(videoKey, positionSec, durationSec, Date.now() / 1000);
  }

  clear(videoKey: string): void {
    this.db.prepare(Q.DELETE_RESUME).run(videoKey);
  }

  /** VideoCard等でのバッジ表示用バッチ取得 */
  listBatch(videoKeys: string[]): Record<string, ResumePosition> {
    const result: Record<string, ResumePosition> = {};
    const stmt = this.db.prepare(Q.SELECT_RESUME);
    for (const key of videoKeys) {
      const row = stmt.get(key) as ResumeRow | undefined;
      if (row) result[key] = this.rowToResume(row);
    }
    return result;
  }

  private rowToResume(r: ResumeRow): ResumePosition {
    return {
      videoKey: r.videoKey,
      positionSec: r.positionSec,
      durationSec: r.durationSec,
      updatedAt: new Date(r.updatedAt * 1000)
    };
  }
}
