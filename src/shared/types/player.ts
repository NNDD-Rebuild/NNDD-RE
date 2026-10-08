/** ローカル再生時の付帯ファイル群 (コメントXML, サムネ画像など) */
export interface PlayerLocalFiles {
  commentXml?: string;
  ownerCommentXml?: string;
  thumbInfoXml?: string;
  thumbImage?: string;
  /** ニコニコ市場情報HTML (廃止済み、旧NNDDからの互換ファイル) */
  ichibaHtml?: string;
  /** 今コメント no 配列JSON (ストリーミング時と同等の今コメ再現用) */
  nowCommentJson?: string;
  /** ユーザーニコ割SWF (`[id][Nicowari][nm12345].swf`)。投稿者コメントの ＠CM で再生する */
  nicowari?: string[];
}

/**
 * 動画プレイヤー起動情報 (main → プレイヤーウィンドウの `nndd:player:init` で渡す)。
 *  - videoId 指定: ニコニコの動画をストリーミングする (master.m3u8経由)
 *  - localPath 指定: ローカルファイルを再生
 */
export interface OpenPlayerParams {
  /** ニコニコ動画ID (sm12345 等) — オンライン再生時のみ */
  videoId?: string;
  /** ローカル動画ファイルパス — ローカル再生時 */
  localPath?: string;
  /** フォルダ連続再生用: ソート済みローカルパス一覧 */
  folderPlaylist?: string[];
  /** 検索結果連続再生用: videoId の配列 */
  searchPlaylist?: string[];
  /** LANライブラリのHTTPストリーミングURL (例: http://192.168.x.x:12345/NNDDServer/sm123) */
  streamUrl?: string;
  localFiles?: PlayerLocalFiles;
  /** フォルダ内連続再生を有効にして開く (ライブラリの連続再生ボタン用。設定の保存はしない) */
  enableFolderAutoNext?: boolean;
  /** 自動再生による遷移か (true なら最小化中のウィンドウを前面に出さない) */
  autoNext?: boolean;
  /** 音声のみ再生モード */
  audioOnly?: boolean;
  /** レジューム再生開始秒数 (VIDEO_OPEN_PLAYER ハンドラが DB から解決してセット) */
  resumeSec?: number;
}
