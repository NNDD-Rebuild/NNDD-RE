/** 本家NNDDからのインポート */

export const HonkeImportCategory = {
  CONFIG: 'config',
  NG: 'ng',
  MYLIST: 'mylist',
  SEARCH: 'search',
  INPUT_HISTORY: 'inputHistory',
  HISTORY: 'history',
  PLAYLIST: 'playlist',
  LIBRARY: 'library',
  DOWNLOAD_QUEUE: 'downloadQueue'
} as const;

export type HonkeImportCategoryValue =
  typeof HonkeImportCategory[keyof typeof HonkeImportCategory];

export type HonkeImportPolicy = 'merge' | 'replace' | 'skip';

/** 検出または手動指定された本家データの場所 */
export interface HonkeImportSource {
  /** 本家の system フォルダ (library.db / ngList.xml 等がある場所)。無ければ null */
  systemDir: string | null;
  /** config.xml のパス。無ければ null */
  configPath: string | null;
  /** 表示用ラベル */
  label: string;
}

export interface HonkeImportCategoryPreview {
  category: HonkeImportCategoryValue;
  /** 取り込み元で見つかった件数 */
  total: number;
  /** 取り込める件数 (RE に対応するもの) */
  importable: number;
  /** 既に RE に存在する件数 */
  duplicate: number;
  /** 取り込めない項目の説明 (未対応キー・許可ID・存在しないファイル等) */
  skipped: string[];
  /** データ元が無い・読めない場合の理由 */
  error?: string;
}

export interface HonkeImportPreview {
  source: HonkeImportSource;
  categories: HonkeImportCategoryPreview[];
}

export interface HonkeImportSelection {
  source: HonkeImportSource;
  /** カテゴリごとの方針。キーが無い or skip のカテゴリは処理しない */
  policies: Partial<Record<HonkeImportCategoryValue, HonkeImportPolicy>>;
  /** ライブラリDB: 旧ライブラリルート → 新ルートの置換 (空なら変換しない) */
  libraryPathFrom?: string;
  libraryPathTo?: string;
}

export interface HonkeImportCategoryResult {
  category: HonkeImportCategoryValue;
  added: number;
  updated: number;
  skipped: number;
  notes: string[];
  /** プレイリスト: ライブラリに無く、サムネ等の動画情報を引用できなかった動画ID */
  missingVideoIds?: string[];
  error?: string;
}

export interface HonkeImportReport {
  results: HonkeImportCategoryResult[];
  /** 適用前バックアップの保存先 */
  backupDir: string | null;
}

export interface HonkeImportProgress {
  category: HonkeImportCategoryValue;
  message: string;
}
