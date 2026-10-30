import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { LogExportHistoryItem } from '@shared/types';

/**
 * 開発者へ送ったログの履歴 (削除トークン付き)。
 * 削除トークンは秘密なので renderer には渡さない。設定 (ConfigStore) にも入れない
 * (GitHub 同期で Gist に流れうるため)。`userData` 直下の専用ファイルに置く。
 */

interface Stored {
  id: string;
  /** 旧形式の Worker (トークンを返さない) に送った分は null = アプリから削除できない */
  deleteToken: string | null;
  uploadedAt: string;
  bytes: number;
  range: string;
}

/** Worker 側の保存期間 (30日) を過ぎた履歴は、もう存在しないので間引く */
const RETENTION_MS = 31 * 24 * 60 * 60 * 1000;

function filePath(): string {
  return path.join(app.getPath('userData'), 'log-uploads.json');
}

function load(): Stored[] {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath(), 'utf-8')) as Stored[];
    const now = Date.now();
    return raw.filter((e) => now - Date.parse(e.uploadedAt) < RETENTION_MS);
  } catch {
    return [];
  }
}

/** 一時ファイルに書いてから rename し、書き込み途中の破損を避ける */
function save(entries: Stored[]): void {
  const p = filePath();
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(entries), { encoding: 'utf-8', mode: 0o600 });
  fs.renameSync(tmp, p);
}

export function addLogUpload(entry: Stored): void {
  const entries = load();
  entries.push(entry);
  save(entries);
}

export function removeLogUpload(id: string): void {
  save(load().filter((e) => e.id !== id));
}

export function getDeleteToken(id: string): string | null | undefined {
  return load().find((e) => e.id === id)?.deleteToken;
}

/** 存在確認の問い合わせ用。削除トークンのある項目だけ (main の外には出さない) */
export function listUploadTokens(): { id: string; token: string }[] {
  return load()
    .filter((e): e is Stored & { deleteToken: string } => e.deleteToken !== null)
    .map((e) => ({ id: e.id, token: e.deleteToken }));
}

/** renderer 向け。削除トークンは含めず、削除できるかどうかだけ返す。新しい順 */
export function listLogUploads(): LogExportHistoryItem[] {
  return load()
    .map((e) => ({
      id: e.id,
      uploadedAt: e.uploadedAt,
      bytes: e.bytes,
      range: e.range,
      deletable: e.deleteToken !== null
    }))
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
}
