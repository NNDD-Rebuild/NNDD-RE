import fs from 'node:fs';
import zlib from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { app } from 'electron';
import { getConfigStore } from '../config/ConfigStore';
import { createLogger, getLogFilePath } from './Logger';
import { splitEntries, selectEntries, truncateHead } from './LogExtract';
import { maskOptional, maskSensitive } from './LogMask';
import {
  addLogUpload,
  getDeleteToken,
  listLogUploads,
  listUploadTokens,
  removeLogUpload
} from './LogExportHistory';
import type {
  LogExportDeleteResult,
  LogExportHistoryItem,
  LogExportOptions,
  LogExportPreview,
  LogExportRange,
  LogExportSendResult
} from '@shared/types';

const log = createLogger('LogExport');

/**
 * ログ送信先 (NNDD-RE_cfworker の Worker) の URL。
 * デプロイ後に Worker の URL へ差し替える。空のままだと送信時にエラーを返す。
 */
export const LOG_UPLOAD_URL = 'https://nnddlog.nks-s.jp/upload';

/** 送信するテキストの上限。超えたら古い側を切り捨てる */
const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024;
/** マスクを何件ごとに区切って処理を譲るか */
const MASK_CHUNK = 1500;
/** プレビューとして renderer に返すテキストの上限 */
const PREVIEW_BYTES = 200 * 1024;

type Cached = { payload: string; meta: Record<string, string> };
/** プレビューした内容。送信は id でここから引き、renderer からは中身を受け取らない */
let cached: { id: string; data: Cached } | null = null;
/** プレビューの要求番号。チェックを素早く切り替えたとき、古い要求の結果で cached を上書きしない */
let previewSeq = 0;

/** 古い世代から順に連結して読む。ローテーションをまたぐ起動を正しく扱うため */
function readAllGenerations(): string {
  const base = getLogFilePath();
  if (!base) return '';
  const maxFiles = Math.max(1, getConfigStore().get('logRotation')?.maxFiles ?? 3);
  const parts: string[] = [];
  for (let i = maxFiles; i >= 1; i--) {
    try {
      parts.push(fs.readFileSync(`${base}.${i}`, 'utf-8'));
    } catch {
      // 存在しない世代は飛ばす
    }
  }
  try {
    parts.push(fs.readFileSync(base, 'utf-8'));
  } catch {
    // ログなし
  }
  return parts.join('');
}

function fmt(ms: number | undefined): string | null {
  return ms !== undefined && Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** 範囲を切り出し、マスクしたうえでプレビュー用の情報を作る */
export async function buildLogExportPreview(
  range: LogExportRange,
  options: LogExportOptions
): Promise<LogExportPreview> {
  const seq = ++previewSeq;
  const entries = splitEntries(readAllGenerations());
  const { picked, oldestMissing } = selectEntries(entries, range);

  // 5MB 級だとマスクに 1 秒前後かかる。main には再生用の HLS プロキシも同居しているので、
  // 一定件数ごとに処理を譲って止めないようにする
  const masked: string[] = [];
  for (let i = 0; i < picked.length; i += MASK_CHUNK) {
    for (const e of picked.slice(i, i + MASK_CHUNK)) {
      // 「エントリ末尾まで伏せる」規則があるので、結合する前にエントリごとにマスクする
      masked.push(maskOptional(maskSensitive(e.text), options));
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  const { text: body, truncated } = truncateHead(masked.join('\n'), MAX_PAYLOAD_BYTES);

  const meta: Record<string, string> = {
    version: app.getVersion(),
    platform: `${process.platform}-${process.arch}`,
    electron: process.versions.electron ?? '',
    range: range.kind === 'sessions' ? `sessions:${range.count}` : 'time',
    masked: ['default', options.maskVideoIds && 'video-ids', options.maskChannels && 'channels', options.maskNames && 'names']
      .filter(Boolean)
      .join(',')
  };
  const header =
    Object.entries(meta)
      .map(([k, v]) => `# ${k}: ${v}`)
      .join('\n') + '\n';
  const payload = header + body + '\n';

  const first = picked.find((e) => Number.isFinite(e.ts));
  const last = [...picked].reverse().find((e) => Number.isFinite(e.ts));
  const id = randomUUID();
  if (seq === previewSeq) cached = { id, data: { payload, meta } };

  const bytes = Buffer.byteLength(payload, 'utf-8');
  const previewText =
    bytes > PREVIEW_BYTES
      ? '(先頭を省略しています。送信されるのは全文です)\n' +
        Buffer.from(payload, 'utf-8').subarray(bytes - PREVIEW_BYTES).toString('utf-8')
      : payload;

  return {
    previewId: id,
    text: previewText,
    lineCount: picked.length,
    bytes,
    firstAt: fmt(first?.ts),
    lastAt: fmt(last?.ts),
    oldestMissing,
    truncated
  };
}

/** プレビュー済みの内容を gzip して Worker に送り、発行された ID を返す */
export async function sendLogExport(previewId: string): Promise<LogExportSendResult> {
  if (!LOG_UPLOAD_URL) {
    return { ok: false, error: 'ログ送信先が未設定です (LOG_UPLOAD_URL)' };
  }
  if (!cached || cached.id !== previewId) {
    return { ok: false, error: 'プレビューの有効期限が切れました。もう一度プレビューしてください' };
  }
  const { payload, meta } = cached.data;
  try {
    const body = zlib.gzipSync(Buffer.from(payload, 'utf-8'));
    const res = await fetch(LOG_UPLOAD_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/gzip',
        'X-Nndd-Version': meta.version,
        'X-Nndd-Platform': meta.platform,
        'X-Nndd-Range': meta.range
      },
      body,
      signal: AbortSignal.timeout(30_000)
    });
    if (!res.ok) {
      log.warn('log upload failed:', res.status);
      return { ok: false, error: `送信に失敗しました (HTTP ${res.status})` };
    }
    const json = (await res.json()) as { id?: string; deleteToken?: string };
    if (!json.id) return { ok: false, error: '送信先の応答が不正です' };
    cached = null;
    addLogUpload({
      id: json.id,
      deleteToken: json.deleteToken ?? null,
      uploadedAt: new Date().toISOString(),
      bytes: body.length,
      range: meta.range
    });
    log.info('log uploaded:', json.id, `${body.length} bytes`);
    return { ok: true, id: json.id };
  } catch (e) {
    log.warn('log upload error:', e);
    return { ok: false, error: `送信に失敗しました: ${(e as Error).message}` };
  }
}

/** 自分が送ったログを削除する。削除トークンは main の履歴から引き、renderer には出さない */
export async function deleteLogExport(id: string): Promise<LogExportDeleteResult> {
  if (!LOG_UPLOAD_URL) return { ok: false, error: 'ログ送信先が未設定です (LOG_UPLOAD_URL)' };
  const token = getDeleteToken(id);
  if (token === undefined) return { ok: false, error: '履歴に見つかりません' };
  if (token === null) {
    return { ok: false, error: '削除に対応していない旧形式の送信です (開発者に依頼してください)' };
  }
  try {
    const res = await fetch(`${LOG_UPLOAD_URL}/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { 'X-Delete-Token': token },
      signal: AbortSignal.timeout(30_000)
    });
    // 404 は「もう無い」(保存期間切れ・削除済み) なので、履歴からも消してよい
    if (res.status === 204 || res.status === 404) {
      removeLogUpload(id);
      log.info('log deleted:', id, res.status);
      return { ok: true };
    }
    if (res.status === 429) return { ok: false, error: '短時間に操作しすぎです。少し待ってからやり直してください' };
    log.warn('log delete failed:', id, res.status);
    return { ok: false, error: `削除に失敗しました (HTTP ${res.status})` };
  } catch (e) {
    log.warn('log delete error:', id, e);
    return { ok: false, error: `削除に失敗しました: ${(e as Error).message}` };
  }
}

/**
 * 履歴を送信先の状態に合わせる。web 側 (管理画面) で消された分や、保存期間が過ぎた分は
 * 送信先にもう無いので、履歴から外す。通信できないときは何も変えない (ローカルの履歴をそのまま返す)。
 * 削除トークンを持たない旧形式の分は確認できないので残す。
 */
export async function syncLogExportHistory(): Promise<LogExportHistoryItem[]> {
  const items = listUploadTokens();
  if (LOG_UPLOAD_URL && items.length > 0) {
    try {
      const res = await fetch(`${LOG_UPLOAD_URL}/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(items.slice(0, 50)),
        signal: AbortSignal.timeout(10_000)
      });
      if (res.ok) {
        const { alive } = (await res.json()) as { alive?: string[] };
        if (Array.isArray(alive)) {
          const set = new Set(alive);
          for (const it of items.slice(0, 50)) {
            if (!set.has(it.id)) {
              removeLogUpload(it.id);
              log.info('log upload gone on server, removed from history:', it.id);
            }
          }
        }
      }
    } catch (e) {
      log.verbose('log history sync skipped:', e);
    }
  }
  return listLogUploads();
}
