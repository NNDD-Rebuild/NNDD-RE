import { randomUUID } from 'node:crypto';
import { ipcMain, protocol } from 'electron';
import { initialize, trackEvent } from '@aptabase/electron/main';
import type { TelemetryRendererEvent, TelemetryState } from '@shared/types';
import { getConfigStore } from '../config/ConfigStore';
import { createLogger } from '../util/Logger';
import { isHeadless } from '../util/headless';
import { buildSettingsSnapshot } from './telemetrySettings';

const log = createLogger('Telemetry');

/** 自己ホストの Aptabase。App Key は公開前提の値 (クライアントに埋め込む) */
const APP_KEY = 'A-SH-4799748235';
const HOST = 'https://aptabase.nks-s.jp';

/** 送信項目を増やしたら上げる。同意済みでも、この版より古ければ再確認するまで送らない */
export const TELEMETRY_CONSENT_VERSION = 1;

const HEARTBEAT_INTERVAL_MS = 60 * 60 * 1000;
/** 操作イベントをためておき、この間隔でまとめて送る (終了時に残っていれば次回起動時に送る) */
const FLUSH_INTERVAL_MS = 10 * 60 * 1000;
/** まとめて送るときの 1 件ごとの間隔 (サーバー側の 20 req/s の制限に当たらないようにする) */
const FLUSH_GAP_MS = 100;
/** ためておく上限。超えたら古いものから捨てる */
const MAX_QUEUED_EVENTS = 500;
/** 同じイベント (名前+内容) の連打をこの間隔で間引く */
const DUPLICATE_WINDOW_MS = 300;

export type TelemetryProps = Record<string, string | number | boolean>;
type QueuedEvent = { name: string; props?: TelemetryProps };

let initialized = false;
let heartbeatTimer: NodeJS.Timeout | null = null;
let flushTimer: NodeJS.Timeout | null = null;
/** 同意の取消・再同意のたびに増やす。古い flush はこれが変わったら止まる */
let epoch = 0;
let flushingEpoch: number | null = null;
let queue: QueuedEvent[] = [];
const lastSentAt = new Map<string, number>();

/**
 * Aptabase SDK の初期化。**app ready より前に呼ぶこと** (SDK の制約。ready 後だと無効になる)。
 * initialize 自体は何も送らない。送信は track() が同意を確認したうえで行う。
 */
export function initTelemetry(): void {
  if (isHeadless) return;
  try {
    void initialize(APP_KEY, { host: HOST })
      .then(closeSdkRendererPath)
      .catch((err) => {
        log.warn('initialize failed:', (err as Error).message);
      });
    initialized = true;
  } catch (err) {
    log.warn('initialize failed:', (err as Error).message);
  }
}

/**
 * SDK は initialize で、renderer から直接送れる経路 (ipcMain 'aptabase:trackEvent' と
 * aptabase-ipc:// スキーム) を作る。これは同意の確認を通らないので、使わない前提で外す。
 * 送信はすべて main の track() / sendNow() を通す。
 */
function closeSdkRendererPath(): void {
  try {
    ipcMain.removeAllListeners('aptabase:trackEvent');
    protocol.unregisterProtocol('aptabase-ipc');
  } catch (err) {
    log.warn('failed to close SDK renderer path:', (err as Error).message);
  }
}

function isEnabled(): boolean {
  if (!initialized) return false;
  const t = getConfigStore().get('telemetry');
  return t.consent === 'granted' && t.consentVersion >= TELEMETRY_CONSENT_VERSION;
}

export function getTelemetryState(): TelemetryState {
  const t = getConfigStore().get('telemetry');
  const needsConsent =
    t.consent === 'unknown' ||
    (t.consent === 'granted' && t.consentVersion < TELEMETRY_CONSENT_VERSION);
  return { consent: t.consent, needsConsent };
}

/** その場で 1 件送る。同意の確認は呼び出し側で済ませること。失敗は握りつぶす */
function sendNow(name: string, props?: TelemetryProps): void {
  trackEvent(name, props).catch(() => {});
}

/**
 * 操作イベントを記録する。同意済みのときだけ、ためておいて 10 分ごと (または次の起動時) に
 * まとめて送る。操作の瞬間には通信しない。
 */
export function track(name: string, props?: TelemetryProps): void {
  if (!isEnabled()) return;
  queue.push({ name, props });
  if (queue.length > MAX_QUEUED_EVENTS) queue = queue.slice(-MAX_QUEUED_EVENTS);
}

/** 画面操作 (クリック) 用。同じ内容の連打は短い間隔で間引く。自動 DL の一括登録などには使わない */
function trackDeduped(name: string, props: TelemetryProps): void {
  const dedupeKey = `${name}:${JSON.stringify(props)}`;
  const now = Date.now();
  const prev = lastSentAt.get(dedupeKey);
  if (prev !== undefined && now - prev < DUPLICATE_WINDOW_MS) return;
  lastSentAt.set(dedupeKey, now);
  track(name, props);
}

/** ためたイベントを順に送る。1 件ずつ間隔を空ける */
async function flushQueue(): Promise<void> {
  if (flushingEpoch === epoch || !isEnabled()) return;
  const mine = epoch;
  flushingEpoch = mine;
  try {
    // queue から 1 件ずつ取り出す (終了時に残りを saveTelemetryQueue で保存できるように)
    while (epoch === mine && isEnabled()) {
      const ev = queue.shift();
      if (!ev) break;
      sendNow(ev.name, ev.props);
      await new Promise<void>((r) => setTimeout(r, FLUSH_GAP_MS));
    }
  } finally {
    if (flushingEpoch === mine) flushingEpoch = null;
  }
}

/** アプリ終了時に呼ぶ。送れていないイベントを手元の設定に残し、次の起動時に送る */
export function saveTelemetryQueue(): void {
  if (!isEnabled() || queue.length === 0) return;
  const store = getConfigStore();
  // 終了処理の途中で複数回呼ばれても失わないよう、すでに保存した分に足す
  store.set('telemetry.pending', [...store.get('telemetry.pending'), ...queue].slice(-MAX_QUEUED_EVENTS));
  queue = [];
}

const RENDERER_TABS = new Set([
  'ranking', 'search', 'follow', 'live', 'mylist', 'download', 'library', 'history', 'stats', 'settings'
]);
const RENDERER_SUBTABS = new Set([
  'general', 'nico', 'library', 'schedule', 'player', 'live', 'ng', 'tools', 'connection',
  'log', 'update', 'backup', 'debug'
]);

/** renderer から届いたイベントを許可リストで検証して送る。形が合わないものは捨てる */
export function trackFromRenderer(ev: TelemetryRendererEvent): void {
  if (typeof ev !== 'object' || ev === null) return;
  const props = (ev as { props?: Record<string, unknown> }).props;
  if (typeof props !== 'object' || props === null) return;
  switch (ev.name) {
    case 'tab_view':
      if (RENDERER_TABS.has(String(props.tab)) && typeof props.changed === 'boolean') {
        trackDeduped('tab_view', { tab: String(props.tab), changed: props.changed });
      }
      break;
    case 'settings_subtab':
      if (RENDERER_SUBTABS.has(String(props.sub)) && typeof props.changed === 'boolean') {
        trackDeduped('settings_subtab', { sub: String(props.sub), changed: props.changed });
      }
      break;
    case 'quality_change':
      if (props.kind === 'video' || props.kind === 'live') trackDeduped('quality_change', { kind: props.kind });
      break;
    case 'jump_command':
      if (props.result === 'accept' || props.result === 'reject') {
        trackDeduped('jump_command', { result: props.result });
      }
      break;
  }
}

function ensureInstallId(): string {
  const store = getConfigStore();
  const current = store.get('telemetry.installId');
  if (current) return current;
  const id = randomUUID();
  store.set('telemetry.installId', id);
  return id;
}

/** 起動直後 / 同意直後: 起動イベントと設定の一覧を送り、生存通知 (heartbeat) を始める */
function startSending(): void {
  const iid = ensureInstallId();
  sendNow('app_start', { iid });
  const store = getConfigStore();
  for (const { event, props } of buildSettingsSnapshot(store.store)) sendNow(event, props);

  // 前回終了時に送れなかった操作イベントを、今回分より先に送る
  const pending = store.get('telemetry.pending');
  if (pending.length > 0) {
    queue = [...pending, ...queue].slice(-MAX_QUEUED_EVENTS);
    store.set('telemetry.pending', []);
  }
  void flushQueue();

  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    sendNow('heartbeat', { iid: getConfigStore().get('telemetry.installId') });
  }, HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref();
  flushTimer = setInterval(() => void flushQueue(), FLUSH_INTERVAL_MS);
  flushTimer.unref();
}

function stopSending(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  // 同意を外したら、未送信のイベントも捨て、送信中の flush も止める
  epoch++;
  queue = [];
  getConfigStore().set('telemetry.pending', []);
}

/** アプリ起動時 (config 読み込み後) に呼ぶ。同意済みなら送信を始める */
export function startTelemetry(): void {
  if (isEnabled()) startSending();
}

/** 同意ダイアログ / 設定のスイッチから呼ぶ。送信の開始・停止は即時に反映される */
export function setTelemetryConsent(granted: boolean): TelemetryState {
  const store = getConfigStore();
  if (granted) {
    store.set('telemetry.consent', 'granted');
    store.set('telemetry.consentVersion', TELEMETRY_CONSENT_VERSION);
    if (isEnabled()) startSending();
  } else {
    stopSending();
    store.set('telemetry.consent', 'denied');
    store.set('telemetry.consentVersion', TELEMETRY_CONSENT_VERSION);
    // 送信をやめたら匿名IDも消す (再度同意したら新しいIDを作る)
    store.set('telemetry.installId', '');
  }
  return getTelemetryState();
}

/** 匿名IDを作り直す。同意中のみ (以後の heartbeat から新しいIDになる) */
export function resetTelemetryInstallId(): void {
  if (!isEnabled()) return;
  const iid = randomUUID();
  getConfigStore().set('telemetry.installId', iid);
  sendNow('heartbeat', { iid });
}
