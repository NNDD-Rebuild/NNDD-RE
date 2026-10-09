import type { LiveProgramSummary, LiveRecordReservation, LiveRecordReserveRequest } from '@shared/types';
import { getConfigStore } from '../../config/ConfigStore';
import type { DownloadManager } from '../../downloader/DownloadManager';
import type { TrayManager } from '../../tray/TrayManager';
import { createLogger } from '../../util/Logger';

const log = createLogger('LiveRecordScheduler');

/** 確認の間隔 */
const CHECK_INTERVAL_MS = 30_000;
/**
 * 開始予定のこの時間前になったら録画ジョブを積む (放送開始の待機に入る)。
 * 開始が少し早まる・視聴セッションの接続に時間がかかる場合でも、冒頭を取り逃がさないための余裕
 */
const LEAD_MS = 3 * 60_000;

/**
 * 生放送の録画予約。放送予定の番組を、開始時刻になったら自動で録画する。
 *
 * 予約は設定 (liveRecordReservations) に保存するので、アプリを再起動しても残る。
 * 動くのはアプリが起動している間だけ (トレイ常駐でもよい)。
 */
export class LiveRecordScheduler {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly dlManager: DownloadManager,
    private readonly trayManager: TrayManager | null | undefined
  ) {}

  start(): void {
    this.stop();
    log.info(`live record scheduler started (reservations=${this.list().length})`);
    this.timer = setInterval(() => this.tick(), CHECK_INTERVAL_MS);
    this.tick();
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  list(): LiveRecordReservation[] {
    return getConfigStore().get('liveRecordReservations') ?? [];
  }

  /** 予約を追加する。同じ番組が既にあれば置き換える */
  reserve(req: LiveRecordReserveRequest): void {
    if (!/^lv\d+$/i.test(req.programId)) throw new Error('録画予約できるのは番組ID (lv) の番組だけです');
    const next = this.list().filter((r) => r.programId !== req.programId);
    next.push({ ...req, programId: req.programId.toLowerCase(), reservedAtMs: Date.now() });
    next.sort((a, b) => a.beginAtMs - b.beginAtMs);
    getConfigStore().set('liveRecordReservations', next);
    log.info(`reserved ${req.programId} (begin=${new Date(req.beginAtMs).toISOString()})`);
    // 開始間近の番組を予約した場合に、次の確認を待たず始める
    this.tick();
  }

  unreserve(programId: string): void {
    const id = programId.toLowerCase();
    const next = this.list().filter((r) => r.programId !== id);
    getConfigStore().set('liveRecordReservations', next);
    log.info(`unreserved ${id}`);
  }

  /** 一覧画面のカード用 */
  listAsPrograms(): LiveProgramSummary[] {
    return this.list().map((r) => ({
      programId: r.programId,
      title: r.title,
      thumbnailUrl: r.thumbnailUrl,
      status: 'RELEASED',
      beginAtMs: r.beginAtMs,
      endAtMs: r.endAtMs,
      ownerName: r.ownerName,
      ownerIconUrl: '',
      providerType: '',
      isMemberOnly: false
    }));
  }

  private tick(): void {
    const now = Date.now();
    const all = this.list();
    const due = all.filter((r) => now >= r.beginAtMs - LEAD_MS);
    if (due.length === 0) return;
    // 先に予約から外してから積む (積んだあとの失敗で、次の確認で二重に積まれないように)
    getConfigStore().set(
      'liveRecordReservations',
      all.filter((r) => !due.includes(r))
    );
    for (const r of due) {
      if (r.endAtMs > 0 && now > r.endAtMs) {
        // アプリが止まっている間に放送が終わった
        log.warn(`reservation expired: ${r.programId} (ended ${new Date(r.endAtMs).toISOString()})`);
        this.trayManager?.notify('録画予約を実行できませんでした', `${r.title} は放送が終了していました`);
        continue;
      }
      log.info(`start reserved record: ${r.programId}`);
      this.dlManager.enqueue({ videoId: r.programId, record: true, thumbnailUrl: r.thumbnailUrl || undefined });
      this.trayManager?.notify('録画予約を開始', r.title);
    }
  }
}
