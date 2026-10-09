/** ライブラリスキャンの進捗 (main → renderer) */
export interface LibraryScanProgress {
  /**
   * walk: フォルダを走査して動画ファイルを集めている (current = 見つけた動画ファイル数, total = 0)
   * register: 動画ファイルをDBへ登録している (current = 処理済み数, total = 対象数)
   * cleanup: ディスクから消えた動画をDBから外している
   */
  phase: 'walk' | 'register' | 'cleanup';
  current: number;
  total: number;
}

/** ライブラリスキャンの結果 */
export interface LibraryScanResult {
  added: number;
  updated: number;
  removed: number;
  /** 前回から変更が無く、読み込みを省いた動画数 */
  unchanged: number;
  /** 見つけた動画ファイルの総数 */
  total: number;
  /** ユーザー操作で途中中断した */
  cancelled: boolean;
  /**
   * DBからの削除判定を行わなかった理由。
   * フォルダが読めなかった/ライブラリが空に見える場合に、NAS切断等で誤って消さないための抑止
   */
  removalSkipped: 'empty' | 'unreadable' | null;
}

export interface LibraryScanOptions {
  /** true なら変更の有無に関わらず全件の付帯情報を読み直す */
  full?: boolean;
}
