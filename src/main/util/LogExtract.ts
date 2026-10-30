import type { LogExportRange } from '@shared/types';

/**
 * ログの切り出し (純粋関数のみ。electron に依存しない)。
 * Logger の起動目印と、LogExport のプレビュー作成から使う。
 */

/** 起動ごとの区切り行の本文。ログ送信時の「n回前の起動から」の判定に使う */
export const SESSION_START_MARK = '===== session start =====';
const SESSION_START_PREFIX = `[INFO][Session] ${SESSION_START_MARK}`;

const TS_RE = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}[+-]\d\d:\d\d) /;

export type Entry = { ts: number; text: string; isStart: boolean };

/** スタックトレースなど時刻で始まらない行は直前のエントリに連結する */
export function splitEntries(text: string): Entry[] {
  const entries: Entry[] = [];
  for (const line of text.split('\n')) {
    if (line === '') continue;
    const m = TS_RE.exec(line);
    if (m) {
      entries.push({
        ts: Date.parse(m[1]),
        text: line,
        isStart: line.slice(m[0].length).startsWith(SESSION_START_PREFIX)
      });
    } else if (entries.length > 0) {
      entries[entries.length - 1].text += `\n${line}`;
    } else {
      entries.push({ ts: NaN, text: line, isStart: false });
    }
  }
  return entries;
}

export function selectEntries(
  entries: Entry[],
  range: LogExportRange
): { picked: Entry[]; oldestMissing: boolean } {
  if (range.kind === 'sessions') {
    const n = Math.max(1, Math.floor(range.count));
    const starts: number[] = [];
    entries.forEach((e, i) => {
      if (e.isStart) starts.push(i);
    });
    if (starts.length >= n) {
      return { picked: entries.slice(starts[starts.length - n]), oldestMissing: false };
    }
    // 起動の目印が足りない (ローテーションで消えた / ログをクリアした / 目印導入前のログ)
    return { picked: entries, oldestMissing: true };
  }
  const picked = entries.filter(
    (e) => Number.isFinite(e.ts) && e.ts >= range.fromMs && e.ts <= range.toMs
  );
  return { picked, oldestMissing: false };
}

/** maxBytes を超えたら古い側を切り捨てる。途中で切れた先頭行も捨てる */
export function truncateHead(body: string, maxBytes: number): { text: string; truncated: boolean } {
  const buf = Buffer.from(body, 'utf-8');
  if (buf.length <= maxBytes) return { text: body, truncated: false };
  const cut = buf.subarray(buf.length - maxBytes).toString('utf-8');
  const nl = cut.indexOf('\n');
  return { text: nl >= 0 ? cut.slice(nl + 1) : cut, truncated: true };
}
