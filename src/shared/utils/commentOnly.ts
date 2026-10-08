/**
 * 「コメントのみ」で取得した動画のライブラリ登録は、動画ファイルが無いため
 * コメントXML (`タイトル - [sm12345].xml`) のパスを uri に持つ。
 * 動画ファイル (.mp4 / .m4a 等) と区別するための判定。
 */
export function isCommentOnlyUri(uri: string): boolean {
  return /\.xml$/i.test(uri);
}
