/**
 * プレイリスト (連続再生用)
 * 元: src/org/mineap/nndd/model/PlayList.as
 */
export interface PlayList {
  id: string;
  name: string;
  videos: PlayListItem[];
  /** ループ再生か */
  isLoop: boolean;
  /** シャッフルか */
  isShuffle: boolean;
}

export interface PlayListItem {
  /** ローカルファイルパスまたはニコニコ動画ID */
  uri: string;
  videoName: string;
  /** 動画長 (秒) */
  time: number;
}

/**
 * 視聴履歴項目
 */
export interface HistoryItem {
  videoId: string;
  title: string;
  thumbnailUrl: string;
  watchedAt: Date;
  /** ローカルファイルかどうか */
  isLocal: boolean;
  /** 実測視聴秒数 (open〜close間の経過時間からpause時間を除いた値) */
  watchSeconds: number;
}

/**
 * ニコニコ動画本家 (公式サイト) 側の視聴履歴項目。
 * このアプリ内の視聴記録 (HistoryItem) とは出所が異なるため別テーブルで管理する。
 */
export interface NicoWatchHistoryItem {
  videoId: string;
  title: string;
  thumbnailUrl: string;
  /** ニコニコ動画側の視聴日時。APIから取得できなければnull */
  watchedAt: Date | null;
  /** このアプリが取得した日時 */
  fetchedAt: Date;
}

/**
 * 自作プレイリスト (ローカル完結、サーバー同期なし)
 */
export interface Playlist {
  id: number;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  /** ユーザーが選択したカスタムアイコン (絵文字)。未設定なら既定表示 */
  icon?: string | null;
  /** 同期しているニコニコ側マイリストのID。未設定ならローカルのみ */
  serverMylistId?: string | null;
  /** 登録キー (UUID)。同期先マイリストの説明文にも入れ、別の PC で同じプレイリストだと見分ける */
  syncKey?: string | null;
}

/**
 * プレイリスト同期でニコニコ側に作るマイリストの説明文の目印。説明文はこの一文で始める。
 * 「アカウントから取得」などで、普通のマイリストと見分けて一覧から除くために使う。
 * (DB の紐付け = playlist.serverMylistId でも判定するので、Web で説明文を消されても、この PC では除外できる)
 */
export const PLAYLIST_SYNC_MARKER = 'NNDD-RE のプレイリストと同期しているマイリストです。';

/** 登録キーの形式: 説明文の末尾に `[NNDD-RE:playlist-sync:<UUID>]` として入れる */
const PLAYLIST_SYNC_KEY_RE = /\[NNDD-RE:playlist-sync:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]/;

/**
 * プレイリスト同期で作るマイリストの説明文。プレイリスト名は後で変わるので含めない。
 * 末尾の登録キー (プレイリストごとに一意) で、別の PC でも同じプレイリストのマイリストだと分かる。
 */
export function buildPlaylistSyncDescription(syncKey: string): string {
  return `${PLAYLIST_SYNC_MARKER}NNDD-RE で追加・削除した動画がここに反映されます。\n[NNDD-RE:playlist-sync:${syncKey}]`;
}

/** 説明文から登録キーを取り出す。無ければ null (キー導入前の同期用マイリストや、普通のマイリスト) */
export function extractPlaylistSyncKey(description: string | null | undefined): string | null {
  return PLAYLIST_SYNC_KEY_RE.exec(description ?? '')?.[1] ?? null;
}

/**
 * 説明文に登録キーを足した文字列を返す。すでにキーがあればそのまま。
 * 目印の一文で始まる (= このアプリが作った) 説明文は置き換え、そうでなければ (Web で書き換えられた) 元の文の後ろへ足す。
 */
export function withPlaylistSyncKey(current: string, syncKey: string): string {
  if (extractPlaylistSyncKey(current)) return current;
  if (current.includes(PLAYLIST_SYNC_MARKER)) return buildPlaylistSyncDescription(syncKey);
  return `${current}${current ? '\n' : ''}[NNDD-RE:playlist-sync:${syncKey}]`;
}

/** プレイリストとニコニコ側マイリストのマージ結果 (PLAYLIST_SERVER_SYNC / PLAYLIST_SET_SYNC) */
export interface PlaylistSyncResult {
  /** ニコニコ側にだけあった新しい動画をプレイリストへ追加した件数 */
  pulled: number;
  /** プレイリストにだけあった新しい動画をニコニコ側へ追加した件数 */
  pushed: number;
  /** ニコニコ側で削除されていたためプレイリストからも削除した件数 (aborted のときは削除予定の件数) */
  deletedLocal: number;
  /** プレイリストで削除されていたためニコニコ側からも削除した件数 (aborted のときは削除予定の件数) */
  deletedServer: number;
  /** 反映できなかった件数 (次回の同期で再試行される) */
  failed: number;
  /** 削除が大量で、確認なしでは実行しなかった (force: true で再実行すると削除を含めて同期する) */
  aborted?: 'massDelete';
}

/**
 * プレイリスト内の動画項目 (追加時のタイトル等スナップショット)
 */
export interface PlaylistItem {
  videoId: string;
  title: string;
  thumbnailUrl: string;
  lengthSec: number;
  sortOrder: number;
  addedAt: Date;
}

/**
 * 動画ごとの再生位置レジューム
 */
export interface ResumePosition {
  videoKey: string;
  positionSec: number;
  durationSec: number;
  updatedAt: Date;
}
