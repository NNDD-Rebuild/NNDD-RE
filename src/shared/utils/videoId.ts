/**
 * ライブラリのファイル名 (`タイトル - [sm12345].mp4`) に埋め込まれる動画ID。
 * 接頭辞を限定しているのは、`[Owner]` `[ThumbInfo]` 等のサフィックスと区別するため。
 */
const VIDEO_ID_BODY = '(?:sm|nm|so|ax|sd|ca|cd|cw|zb|ze|yo)\\d+';
/** ファイル名に埋め込まれるID。動画IDに加えて、保存した生放送のタイムシフト (lv12345) も含む */
const FILE_ID_BODY = `(?:${VIDEO_ID_BODY}|lv\\d+)`;
const BRACKETED_VIDEO_ID_RE = new RegExp(`\\[(${FILE_ID_BODY})\\]`);
const VIDEO_ID_RE = new RegExp(`^${VIDEO_ID_BODY}$`);

/** ファイル名・パス中の `[sm12345]` から動画IDを取り出す。無ければ null */
export function extractBracketedVideoId(name: string): string | null {
  const m = name.match(BRACKETED_VIDEO_ID_RE);
  return m ? m[1] : null;
}

/** 文字列全体がライブラリで扱える動画ID (sm12345 等) か */
export function isVideoId(s: string): boolean {
  return VIDEO_ID_RE.test(s);
}

const NICO_HOST_RE = /(?:^|\.)(?:nicovideo\.jp|nico\.ms)$/i;
const VIDEO_ID_IN_URL_RE = new RegExp(`(?<![A-Za-z0-9])(${VIDEO_ID_BODY})(?![A-Za-z0-9])`, 'i');
const NUMERIC_WATCH_RE = /\/watch\/(\d+)(?!\d)/;

/**
 * 入力から動画IDを取り出す。ID単体、または空白を含まない URL (ドメイン問わず) のパス・クエリ・ハッシュに
 * 動画IDを含むもの (watch / 大百科 / まとめサイト 等) が対象。該当しなければ null。
 * 数字のみの ID (`/watch/1234567890`) は誤検出を避けるため nicovideo.jp / nico.ms のみ。
 */
export function extractVideoIdFromInput(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (isVideoId(lower)) return lower;
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
  const m = target.match(VIDEO_ID_IN_URL_RE);
  if (m) return m[1].toLowerCase();
  if (!NICO_HOST_RE.test(url.hostname)) return null;
  return url.pathname.match(NUMERIC_WATCH_RE)?.[1] ?? null;
}
