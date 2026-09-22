import { IpcChannel } from '@shared/types';

/**
 * ブラウザ (Electron 外) で PlayerApp / LibraryView を動かすための window.nndd / window.electron の代替実装。
 * import した時点でインストールされる。
 *
 * - invoke: 許可チャンネルは POST /api/ipc (NnddHttpServer の webPlayerBridge) へ。
 *   ブラウザ内で完結するもの (設定の保存・動画URL組み立て・次動画への遷移) はここで処理。
 * - send / 未対応チャンネル: Electron 固有機能 (Discord, コメントウィンドウ等) は no-op。
 * - on: サーバーからのイベント配信は未対応。init だけローカルで発火する。
 */

type AnyFn = (...args: unknown[]) => void;
type ElectronListener = (event: unknown, ...args: unknown[]) => void;

const INIT_EVENT = 'nndd:player:init';
/** プレイヤー未表示のときの再生要求を web-app に伝えるイベント (detail: {videoId} | {path}) */
export const OPEN_PLAYER_EVENT = 'nndd-web:open-player';
const CFG_PREFIX = 'nndd-web:cfg:';

/** ブリッジ不要・結果も不要で握りつぶすチャンネル (Electron 固有 or ホスト側状態を汚すもの) */
const NOOP_CHANNELS = new Set<string>([
  IpcChannel.HISTORY_ADD,
  IpcChannel.RESUME_SAVE,
  IpcChannel.RESUME_CLEAR,
  IpcChannel.VIDEO_DELETE_CACHE,
  IpcChannel.COMMENT_WINDOW_OPEN,
  IpcChannel.COMMENT_WINDOW_PUSH,
  IpcChannel.COMMENT_WINDOW_TIME,
  IpcChannel.DISCORD_RPC_SET_ACTIVITY,
  IpcChannel.DISCORD_RPC_CLEAR_ACTIVITY,
  IpcChannel.PLAYER_NICONICO_INIT,
  IpcChannel.PLAYER_NICONICO_RESIZE,
  IpcChannel.PLAYER_NICONICO_DESTROY
]);

const listeners = new Map<string, Set<ElectronListener>>();
let pendingInit: unknown | null = null;
let initTimer: number | null = null;

function addListener(channel: string, cb: ElectronListener): () => void {
  let set = listeners.get(channel);
  if (!set) {
    set = new Set();
    listeners.set(channel, set);
  }
  set.add(cb);
  if (channel === INIT_EVENT && pendingInit !== null) scheduleInitDelivery();
  return () => {
    set!.delete(cb);
  };
}

function emit(channel: string, ...args: unknown[]): void {
  for (const cb of [...(listeners.get(channel) ?? [])]) cb({}, ...args);
}

/**
 * init は PlayerApp の useEffect が listener を登録した後に届ける。
 * StrictMode の二重 effect を跨ぐため setTimeout で遅延し、1回だけ配信する。
 */
function scheduleInitDelivery(): void {
  if (initTimer !== null) window.clearTimeout(initTimer);
  initTimer = window.setTimeout(() => {
    initTimer = null;
    if (pendingInit === null || !(listeners.get(INIT_EVENT)?.size)) return;
    const params = pendingInit;
    pendingInit = null;
    emit(INIT_EVENT, params);
  }, 0);
}

async function loadInitParams(query: Record<string, string>): Promise<unknown> {
  const qs = new URLSearchParams(query).toString();
  const res = await fetch(`/api/web-player/init?${qs}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

function deliverInit(params: unknown): void {
  pendingInit = params;
  scheduleInitDelivery();
}

async function bridgeInvoke(channel: string, args: unknown[]): Promise<unknown> {
  const res = await fetch('/api/ipc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel, args })
  });
  const body = (await res.json().catch(() => ({}))) as { result?: unknown; error?: string };
  if (res.status === 403) throw new Error('ブラウザ版では利用できない操作です');
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body.result;
}

function readLocalConfig(key: string): { found: boolean; value?: unknown } {
  try {
    const raw = localStorage.getItem(CFG_PREFIX + key);
    if (raw !== null) return { found: true, value: JSON.parse(raw) };
  } catch {
    // localStorage 不可 → サーバー値を使う
  }
  return { found: false };
}

async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  switch (channel) {
    // 設定はブラウザ単位で保持 (ホスト側の設定は書き換えない)
    case IpcChannel.CONFIG_SET: {
      try {
        localStorage.setItem(CFG_PREFIX + String(args[0]), JSON.stringify(args[1]));
      } catch {
        // 保存できなくても再生は続行
      }
      return true;
    }
    case IpcChannel.CONFIG_GET: {
      const local = readLocalConfig(String(args[0]));
      if (local.found) return local.value;
      return bridgeInvoke(channel, args);
    }
    // ループバックURLではなく同一オリジンの配信URLを返す
    case IpcChannel.VIDEO_BUILD_LOCAL_URL:
      return `/api/local-media?path=${encodeURIComponent(String(args[0]))}`;
    // プレイヤー内: 同じページ内で init を再発行 / ライブラリ等: プレイヤーページへ遷移
    case IpcChannel.VIDEO_OPEN_PLAYER: {
      const p = (args[0] ?? {}) as { videoId?: string; localPath?: string; streamUrl?: string };
      const query: Record<string, string> = {};
      if (p.localPath) query['path'] = p.localPath;
      else if (p.videoId) query['videoId'] = p.videoId;
      else if (p.streamUrl) throw new Error('ブラウザ版ではLANライブラリの再生に対応していません');
      else throw new Error('再生対象が指定されていません');
      const params = await loadInitParams(query);
      if (listeners.get(INIT_EVENT)?.size) {
        // プレイヤー表示中: 同じ PlayerApp に init を再発行
        const vid = (params as { videoId?: string }).videoId;
        if (vid) history.replaceState(history.state, '', `?videoId=${encodeURIComponent(vid)}`);
        emit(INIT_EVENT, params);
      } else {
        // プレイヤー未表示: init を保持しておき、画面切替 (web-app) に任せる
        deliverInit(params);
        window.dispatchEvent(new CustomEvent(OPEN_PLAYER_EVENT, { detail: query }));
      }
      return undefined;
    }
    default:
      if (NOOP_CHANNELS.has(channel)) return undefined;
      return bridgeInvoke(channel, args);
  }
}

const nndd = {
  invoke: <T = unknown>(channel: string, ...args: unknown[]): Promise<T> =>
    invoke(channel, ...args) as Promise<T>,
  on: (channel: string, listener: AnyFn): (() => void) =>
    addListener(channel, (_e, ...args) => listener(...args)),
  send: (): void => {
    // Electron 固有の一方向通知はブラウザ版では何もしない
  },
  channels: IpcChannel
};

const electron = {
  ipcRenderer: {
    on: (channel: string, listener: ElectronListener): (() => void) =>
      addListener(channel, listener),
    send: (): void => {},
    invoke: (channel: string, ...args: unknown[]): Promise<unknown> => invoke(channel, ...args)
  },
  process: { platform: 'web' }
};

const w = window as unknown as { nndd: unknown; electron: unknown; __NNDD_WEB__: boolean };
w.nndd = nndd;
w.electron = electron;
// buildLocalUrl (shared) がカスタムスキームの代わりに HTTP 配信URLを返すためのフラグ
w.__NNDD_WEB__ = true;

/** 現在のURL (?videoId=sm123 または ?path=...) の動画を PlayerApp の init として発行する */
export function openPlayerFromLocation(): void {
  const sp = new URLSearchParams(location.search);
  const query: Record<string, string> = {};
  const vid = sp.get('videoId');
  const path = sp.get('path');
  if (vid) query['videoId'] = vid;
  else if (path) query['path'] = path;
  loadInitParams(query)
    .then(deliverInit)
    .catch((e) => {
      console.warn('web player init failed:', e);
      deliverInit({});
    });
}

// プレイヤーURLを直接開いた場合
if (location.pathname.endsWith('/web-player.html')) openPlayerFromLocation();
