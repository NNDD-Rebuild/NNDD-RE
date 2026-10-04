const LIVE_HOST_RE = /(?:^|\.)(?:nicovideo\.jp|nico\.ms)$/i;
const LIVE_ID_RE = /(?<![A-Za-z0-9])(lv\d+)(?![A-Za-z0-9])/i;
const LIVE_WATCH_ID_RE = /\/watch\/((?:lv|co|ch)\d+)(?![A-Za-z0-9])/i;

/**
 * 入力から生放送の番組IDを取り出す。lv 単体、または空白を含まない URL (ドメイン問わず) に lv ID を含むもの、
 * もしくは nicovideo.jp / nico.ms の `/watch/{lv|co|ch}ID` が対象。該当しなければ null。
 */
export function extractLiveIdFromInput(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^lv\d+$/i.test(trimmed)) return trimmed.toLowerCase();
  if (/\s/.test(trimmed)) return null;

  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }

  const raw = url.pathname + url.search + url.hash;
  let target: string;
  try {
    target = decodeURIComponent(raw);
  } catch {
    target = raw;
  }
  const m = target.match(LIVE_ID_RE);
  if (m) return m[1].toLowerCase();
  if (!LIVE_HOST_RE.test(url.hostname)) return null;
  return url.pathname.match(LIVE_WATCH_ID_RE)?.[1].toLowerCase() ?? null;
}
