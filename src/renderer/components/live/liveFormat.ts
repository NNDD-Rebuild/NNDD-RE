import type { LiveConnectionState } from '@shared/types';

/**
 * 生放送プレイヤーの表示用の整形関数・ラベル (LivePlayerApp から分離)。
 */

/**
 * 解像度を含まない画質 ID の表示名。操作バーの選択欄は一番長い表示名の幅になるため短くする
 * (長いとシークバーの幅が削られる)
 */
const QUALITY_LABELS: Record<string, string> = {
  abr: '自動',
  super_high: '最高',
  high: '高',
  normal: '標準',
  low: '低',
  super_low: '最低',
  audio_high: '音声',
  audio_only: '音声(低)'
};

/**
 * 画質 ID の表示名。`4Mbps720p30fps` のような ID は動画と同じく解像度 (`720p`) で表示し、
 * 60fps は `720p60` とする。それ以外 (abr / super_high 等) は QUALITY_LABELS の名前
 */
export function formatLiveQuality(id: string): string {
  if (QUALITY_LABELS[id]) return QUALITY_LABELS[id];
  const m = id.match(/(\d+)p(?:(\d+)fps)?/i);
  if (!m) return id;
  const fps = m[2] && Number(m[2]) > 30 ? m[2] : '';
  return `${m[1]}p${fps}`;
}

export const STATE_LABELS: Record<LiveConnectionState, string> = {
  connecting: '接続中',
  watching: '視聴中',
  reconnecting: '再接続中',
  ended: '終了',
  error: 'エラー'
};

/** IPC 経由のエラーは "Error invoking remote method '...': Error: 本文" になるので本文だけ取り出す */
export function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '');
}

export function formatElapsed(ms: number): string {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
