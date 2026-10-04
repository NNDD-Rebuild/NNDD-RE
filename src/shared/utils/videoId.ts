/**
 * ライブラリのファイル名 (`タイトル - [sm12345].mp4`) に埋め込まれる動画ID。
 * 接頭辞を限定しているのは、`[Owner]` `[ThumbInfo]` 等のサフィックスと区別するため。
 */
const VIDEO_ID_BODY = '(?:sm|nm|so|ax|sd|ca|cd|cw|zb|ze|yo)\\d+';
const BRACKETED_VIDEO_ID_RE = new RegExp(`\\[(${VIDEO_ID_BODY})\\]`);
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
