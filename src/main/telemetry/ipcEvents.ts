import { IpcChannel, type IpcChannelValue } from '@shared/types';
import { getConfigStore } from '../config/ConfigStore';
import { track, type TelemetryProps } from './Telemetry';

/**
 * 匿名統計に載せる IPC 呼び出しの一覧。ハンドラが成功したときだけ、ここで定義した
 * イベントを送る。props は固定の種別 (enum / bool) だけにし、引数の値
 * (動画ID・検索語・タイトル・パス・NGの中身など) は絶対に載せないこと。
 */
type EventDef = (args: unknown[]) => [name: string, props?: TelemetryProps];

const NG_TYPES = new Set(['word', 'wordExact', 'userId', 'command']);

const EVENTS: Partial<Record<IpcChannelValue, EventDef>> = {
  [IpcChannel.SEARCH_EXECUTE]: () => {
    const api = getConfigStore().get('searchApi');
    return ['search_execute', { api: api === 'nvapi' ? 'nvapi' : 'snapshot' }];
  },
  [IpcChannel.MYLIST_ADD]: () => ['mylist_op', { op: 'add' }],
  [IpcChannel.MYLIST_REMOVE]: () => ['mylist_op', { op: 'remove' }],
  [IpcChannel.MYLIST_MOVE]: () => ['mylist_op', { op: 'move' }],
  [IpcChannel.MYLIST_ADD_VIDEO_DEFLIST]: () => ['mylist_op', { op: 'add_deflist' }],
  [IpcChannel.LIBRARY_SCAN]: () => ['library_scan'],
  [IpcChannel.HONKE_APPLY]: () => ['honke_import_apply'],
  [IpcChannel.BACKUP_UPLOAD]: () => ['github_sync', { op: 'upload' }],
  [IpcChannel.BACKUP_DOWNLOAD]: () => ['github_sync', { op: 'download' }],
  [IpcChannel.BACKUP_RESTORE_REVISION]: () => ['github_sync', { op: 'restore' }],
  [IpcChannel.HTTPD_START]: () => ['httpd_start'],
  [IpcChannel.TAILSCALE_INSTALL]: () => ['tailscale_install'],
  [IpcChannel.SCHEDULE_ADD]: () => ['schedule_add'],
  [IpcChannel.NG_ADD_COMMENT]: (args) => {
    const type = (args[0] as { type?: unknown } | undefined)?.type;
    return ['ng_add', { type: typeof type === 'string' && NG_TYPES.has(type) ? type : 'other' }];
  },
  [IpcChannel.COMMENT_WINDOW_OPEN]: () => ['comment_window_open', { kind: 'video' }],
  [IpcChannel.LIVE_COMMENT_WINDOW_OPEN]: () => ['comment_window_open', { kind: 'live' }],
  [IpcChannel.LIVE_OPEN_PLAYER]: () => ['live_open'],
  [IpcChannel.LIVE_TIMESHIFT_ACTIVATE]: () => ['live_timeshift_activate'],
  [IpcChannel.LIVE_SET_CHASE_PLAY]: (args) => ['live_chase_play', { enabled: args[0] === true }],
  [IpcChannel.LIVE_RECORD_RESERVE]: () => ['live_record_reserve'],
  [IpcChannel.LIVE_CHANGE_QUALITY]: () => ['quality_change', { kind: 'live' }],
  [IpcChannel.UPDATE_CHECK]: () => ['update_check']
};

/** ipcMain.handle のハンドラ実行後に呼ぶ。成功 (resolve) したときだけ送り、失敗は数えない */
export function trackIpcCall(channel: string, args: unknown[], result: unknown): void {
  const def = EVENTS[channel as IpcChannelValue];
  if (!def) return;
  Promise.resolve(result).then(
    () => {
      try {
        const [name, props] = def(args);
        track(name, props);
      } catch {
        // 統計の失敗で本来の処理に影響させない
      }
    },
    () => {}
  );
}
