/**
 * パス・ファイル名の定数。
 * 元の NNDD/AIR 版が `Documents/NNDD/` を使っていたのを踏襲する。
 */
export const NnddPaths = {
  /** ルートディレクトリ名 (~/Documents/NNDD-RE) */
  ROOT_DIR_NAME: 'NNDD-RE',
  /** ライブラリディレクトリ (ルート直下) */
  LIBRARY_DIR_NAME: 'library',
  /** システムファイル (DB等) ディレクトリ */
  SYSTEM_DIR_NAME: 'system',
  /** 一時ディレクトリ */
  TEMP_DIR_NAME: 'temp',
  /** プレイリストディレクトリ */
  PLAYLIST_DIR_NAME: 'playlist',
  /** SQLite DBファイル */
  DB_FILE_NAME: 'library.db',
  /** 設定ファイル */
  CONFIG_FILE_NAME: 'config.json',
  /** Cookie保存ファイル */
  COOKIE_FILE_NAME: 'cookies.json',
  /** ログディレクトリ */
  LOG_DIR_NAME: 'log',
  /** デフォルトのダウンロード保存先ディレクトリ名 */
  DOWNLOADS_DIR_NAME: 'Downloads'
} as const;

/**
 * ローカル保存される動画関連ファイルの拡張子・サフィックス。
 * NNDD 互換: 動画 `.mp4` / サムネ `.jpg` / コメント `.xml` /
 * サムネ情報 `[ThumbInfo].xml` / 投コメ `[Owner].xml`
 */
export const VideoFileSuffix = {
  COMMENT_XML: '.xml',
  OWNER_COMMENT_XML: '[Owner].xml',
  THUMB_INFO_XML: '[ThumbInfo].xml',
  THUMB_IMAGE: '[ThumbImg].jpeg',
  /** 旧形式互換 (既存の .jpg) */
  THUMB_IMAGE_LEGACY: '.jpg',
  /** 旧形式互換 (既存の [info].txt 読み込み用) */
  INFO_TXT_LEGACY: '[info].txt',
  /** 旧形式互換 (小文字 [owner].xml) */
  OWNER_COMMENT_XML_LEGACY: '[owner].xml',
  NICOWARI: '[ニコ割].swf',
  /** ニコニコ市場情報 (廃止済み、既存ファイル読み込み用) */
  ICHIBA_INFO_HTML: '[IchibaInfo].html',
  /** 今コメント no 配列 (ストリーミング時と同じ今コメを再現するため) */
  NOW_COMMENT_JSON: '[NowComment].json'
} as const;

/** ローカル動画ファイル用カスタムプロトコルスキーム */
export const NNDD_RE_LOCAL_SCHEME = 'nndd-re-local';

/** @deprecated NNDD_RE_LOCAL_SCHEME を使うこと */
export const NNDD_LOCAL_SCHEME = NNDD_RE_LOCAL_SCHEME;

/** ローカル動画 URL を構築する (renderer からも呼べるよう shared に置く) */
export function buildLocalUrl(absolutePath: string): string {
  return `${NNDD_RE_LOCAL_SCHEME}://video?path=${encodeURIComponent(absolutePath)}`;
}
