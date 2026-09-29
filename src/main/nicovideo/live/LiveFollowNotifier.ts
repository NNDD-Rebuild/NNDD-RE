import { Notification } from 'electron';
import { getConfigStore } from '../../config/ConfigStore';
import { LivePlayerManager } from '../../player/LivePlayerManager';
import { createLogger } from '../../util/Logger';
import { NicoContext } from '../NicoContext';
import type { LiveProgramSummary } from '@shared/types';
import { fetchFollowingPrograms } from './LiveListClient';

const log = createLogger('LiveFollowNotifier');

/** 1 回の確認で個別に通知する最大件数 (超えた分は 1 件にまとめる) */
const MAX_INDIVIDUAL = 5;
/** 放送中の一覧を取得するページ数の上限 (1 ページ目に収まらない分を 2 ページ目まで見る) */
const MAX_PAGES = 2;
/** 確認間隔の下限 (分) */
const MIN_INTERVAL_MIN = 1;

/**
 * フォロー中の放送者の番組が始まったら OS 通知を出す。
 * フォロー中 (放送中) の一覧を定期的に取得し、前回なかった番組を新しく始まったものとみなす。
 * 通知をクリックするとその番組を生放送プレイヤーで開く。
 */
export class LiveFollowNotifier {
  private timer: NodeJS.Timeout | null = null;
  /** 前回確認したときの放送中の番組ID。null は未取得 (最初の取得は通知しない) */
  private seen: Set<string> | null = null;
  private running = false;

  /** 設定に合わせて開始・停止する (設定変更時にも呼ぶ) */
  apply(): void {
    this.stop();
    const cfg = getConfigStore().get('live');
    if (!cfg?.followNotify) return;
    const intervalMin = Math.max(MIN_INTERVAL_MIN, Number(cfg.followNotifyIntervalMin) || 5);
    log.info(`live follow notifier started (interval=${intervalMin}min)`);
    this.timer = setInterval(() => void this.tick(), intervalMin * 60_000);
    void this.tick();
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.seen = null;
  }

  /** 放送中のフォロー番組を先頭から MAX_PAGES ページ分取得する。どれかが失敗したら例外 (基準を更新しない) */
  private async fetchOnAir(): Promise<LiveProgramSummary[]> {
    const first = await fetchFollowingPrograms('onair', 0);
    const programs = [...first.programs];
    for (let page = 1; page < MAX_PAGES && programs.length < first.total; page++) {
      const next = await fetchFollowingPrograms('onair', programs.length);
      if (next.programs.length === 0) break;
      programs.push(...next.programs);
    }
    return programs;
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      // 未ログインのときは取得できない。別アカウントに切り替わったときに誤通知しないよう基準も捨てる
      if (!(await NicoContext.get().isLoggedIn())) {
        this.seen = null;
        return;
      }
      const programs = await this.fetchOnAir();
      const current = new Set(programs.map((p) => p.programId));
      const prev = this.seen;
      this.seen = current;
      if (prev === null) return;

      const started = programs.filter((p) => !prev.has(p.programId));
      if (started.length === 0) return;
      log.info(`follow programs started: ${started.map((p) => p.programId).join(',')}`);
      if (!Notification.isSupported()) return;
      for (const p of started.slice(0, MAX_INDIVIDUAL)) {
        const n = new Notification({
          title: `${p.ownerName || 'フォロー中'} が生放送を開始`,
          body: p.title,
          silent: false
        });
        n.on('click', () => LivePlayerManager.get().open(p.programId));
        n.show();
      }
      if (started.length > MAX_INDIVIDUAL) {
        new Notification({
          title: 'フォロー中の生放送が始まりました',
          body: `ほか ${started.length - MAX_INDIVIDUAL} 件`,
          silent: false
        }).show();
      }
    } catch (e) {
      log.warn('live follow check failed', e);
    } finally {
      this.running = false;
    }
  }
}
