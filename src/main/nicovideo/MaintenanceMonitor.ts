import type { MaintenanceKind, MaintenanceState } from '@shared/types/maintenance';
import { createLogger } from '../util/Logger';

const log = createLogger('Maintenance');

/**
 * 判定対象ホスト。CDN や外部ホストが正常応答しても「メンテ解除」と誤判定しないよう、
 * メンテ時に 503 を返すことを確認したホストだけを見る。
 * - 動画系: www.nicovideo.jp (S3 配信の HTML) / nvapi.nicovideo.jp (JSON meta.errorCode=MAINTENANCE)
 * - 生放送系: メンテ時の応答は未実測。動画系と同じ判定 (503 + メンテ文言) を適用する
 */
const HOST_KIND: Record<string, MaintenanceKind> = {
  'www.nicovideo.jp': 'video',
  'nvapi.nicovideo.jp': 'video',
  'live.nicovideo.jp': 'live',
  'live2.nicovideo.jp': 'live',
  'api.cas.nicovideo.jp': 'live'
};

/** メンテ中の自動復帰確認の間隔 */
const PROBE_INTERVAL_MS = 60 * 1000;

const PROBE_URL: Record<MaintenanceKind, string> = {
  video: 'https://www.nicovideo.jp/',
  live: 'https://live.nicovideo.jp/'
};

type Listener = (state: MaintenanceState) => void;
type ProbeFn = (url: string) => Promise<unknown>;

function classify(url: string): MaintenanceKind | null {
  try {
    return HOST_KIND[new URL(url).hostname] ?? null;
  } catch {
    return null;
  }
}

/** 503 応答の本文がメンテナンスを示すか */
function isMaintenanceBody(text: string): boolean {
  return text.includes('MAINTENANCE') || text.includes('メンテナンス');
}

/**
 * ニコニコのメンテナンス状態を NicoHttp の応答から検知して保持する。
 * メンテ中は一定間隔で probe を投げ、正常応答が返れば自動で解除する。
 */
export class MaintenanceMonitor {
  private static state: MaintenanceState = { video: false, live: false };
  private static listeners = new Set<Listener>();
  private static probe: ProbeFn | null = null;
  private static timer: NodeJS.Timeout | null = null;

  static get(): MaintenanceState {
    return { ...this.state };
  }

  static isActive(kind: MaintenanceKind): boolean {
    return this.state[kind];
  }

  static onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** メンテ中の復帰確認に使う fetch (NicoHttp.fetch 経由で observe される) を登録 */
  static setProbe(probe: ProbeFn): void {
    this.probe = probe;
  }

  /** NicoHttp.fetch の応答を渡す。本文は clone して読むので呼び出し元の読み取りに影響しない */
  static async observe(url: string, res: Response): Promise<void> {
    const kind = classify(url);
    if (!kind) return;
    if (res.status === 503) {
      const text = await res.clone().text().catch(() => '');
      // 503 でもメンテ文言が無ければ一時的な過負荷等なので状態は変えない
      if (isMaintenanceBody(text)) this.set(kind, true);
    } else if (res.status < 500) {
      this.set(kind, false);
    }
  }

  private static set(kind: MaintenanceKind, active: boolean): void {
    if (this.state[kind] === active) return;
    this.state = { ...this.state, [kind]: active };
    log.info(`${kind}: ${active ? 'メンテナンス検知' : 'メンテナンス解除'}`);
    const snapshot = this.get();
    for (const l of this.listeners) l(snapshot);
    this.updateProbeTimer();
  }

  private static updateProbeTimer(): void {
    const anyActive = this.state.video || this.state.live;
    if (anyActive && !this.timer) {
      this.timer = setInterval(() => void this.runProbe(), PROBE_INTERVAL_MS);
    } else if (!anyActive && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private static async runProbe(): Promise<void> {
    if (!this.probe) return;
    for (const kind of ['video', 'live'] as const) {
      if (!this.state[kind]) continue;
      try {
        await this.probe(PROBE_URL[kind]);
      } catch (e) {
        log.debug(`${kind} probe failed:`, e);
      }
    }
  }
}
