/**
 * NNDD ライブラリDBのスキーマ定義。
 * 元: src/org/mineap/nndd/library/sqlite/Queries.as / DbAccessHelper.as
 *
 * 元の AIR 版から完全互換のスキーマを移植する。
 * 既存のオフライン NNDD ライブラリ DB をそのまま読み込めるようにする。
 */

export const DB_SCHEMA_VERSION = '19';

export const CREATE_TABLES = [
  /* NNDDREVideo - 動画本体 */
  `CREATE TABLE IF NOT EXISTS NNDDREVideo (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE,
    uri TEXT,
    dirpath_id INTEGER,
    videoName TEXT,
    modificationDate REAL,
    creationDate REAL,
    thumbUrl TEXT,
    playCount REAL,
    time REAL,
    lastPlayDate REAL,
    yetReading INTEGER,
    pubDate REAL,
    isFavorite INTEGER DEFAULT 0,
    description TEXT
  );`,

  `CREATE INDEX IF NOT EXISTS keyindex ON NNDDREVideo (key);`,

  /* タグ文字列 */
  `CREATE TABLE IF NOT EXISTS tagstring (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tag TEXT UNIQUE
  );`,

  /* 動画とタグの関連 */
  `CREATE TABLE IF NOT EXISTS NNDDREVideo_tag (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    NNDDREVideo_id INTEGER,
    tag_id INTEGER,
    UNIQUE(NNDDREVideo_id, tag_id)
  );`,

  /* ディレクトリパス (動画格納先) */
  `CREATE TABLE IF NOT EXISTS file (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dirpath TEXT UNIQUE
  );`,

  /* スキーマバージョン */
  `CREATE TABLE IF NOT EXISTS version (
    id INTEGER PRIMARY KEY,
    version TEXT
  );`,

  /* マイリスト一覧 (元 AIR 版はファイルベースだったが、DBに統合) */
  `CREATE TABLE IF NOT EXISTS mylist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account TEXT NOT NULL DEFAULT '',
    url TEXT,
    name TEXT,
    type TEXT,
    isDir INTEGER DEFAULT 0,
    unPlayCount INTEGER DEFAULT 0,
    lastRenewed REAL,
    icon TEXT,
    parentUrl TEXT,
    UNIQUE(account, url)
  );`,

  /* 視聴履歴 */
  `CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    videoId TEXT,
    title TEXT,
    thumbnailUrl TEXT,
    watchedAt REAL,
    isLocal INTEGER,
    watchSeconds REAL DEFAULT 0
  );`,

  /* ダウンロードスケジュール */
  `CREATE TABLE IF NOT EXISTS schedule (
    id TEXT NOT NULL,
    account TEXT NOT NULL DEFAULT '',
    name TEXT,
    targetType TEXT DEFAULT 'mylist',
    targetMyListUrl TEXT,
    targetId TEXT,
    daysOfWeek TEXT,
    time TEXT,
    enabled INTEGER,
    lastRun REAL,
    makeSubfolder INTEGER DEFAULT 0,
    PRIMARY KEY (account, id)
  );`,

  /* 保存検索 */
  `CREATE TABLE IF NOT EXISTS saved_search (
    id TEXT PRIMARY KEY,
    name TEXT,
    word TEXT,
    type TEXT,
    sortType TEXT,
    parentId TEXT,
    isDir INTEGER DEFAULT 0
  );`,

  /* NGリスト (コメント) */
  `CREATE TABLE IF NOT EXISTS ng_list (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account TEXT NOT NULL DEFAULT '',
    type TEXT,
    value TEXT,
    UNIQUE(account, type, value)
  );`,

  /* サーバー側NGとの同期で使う「前回同期した時点の一覧」(アカウントごと)。削除の伝播を判定するための基準 */
  `CREATE TABLE IF NOT EXISTS ng_sync_base (
    account TEXT NOT NULL,
    type TEXT NOT NULL,
    value TEXT NOT NULL,
    UNIQUE(account, type, value)
  );`,

  /* 検索ワードの入力履歴 (usedAt の新しい順に表示、最大10件) */
  `CREATE TABLE IF NOT EXISTS search_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word TEXT UNIQUE NOT NULL,
    usedAt INTEGER NOT NULL
  );`,

  /* マイリストURLの入力履歴 (usedAt の新しい順に表示、最大10件) */
  `CREATE TABLE IF NOT EXISTS mylist_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL,
    name TEXT NOT NULL,
    usedAt INTEGER NOT NULL,
    UNIQUE(account, url)
  );`,

  /* NGタグ */
  `CREATE TABLE IF NOT EXISTS ng_tag (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tag TEXT UNIQUE
  );`,

  /* NGユーザー (動画投稿者) */
  `CREATE TABLE IF NOT EXISTS ng_up (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId TEXT UNIQUE
  );`,

  /* 自作プレイリスト (ローカル。serverMylistId があればニコニコ側の同名マイリストと同期) */
  `CREATE TABLE IF NOT EXISTS playlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL,
    createdAt REAL,
    updatedAt REAL,
    icon TEXT,
    serverMylistId TEXT,
    syncKey TEXT
  );`,

  /* この PC では取り込まない登録キー。ローカルで削除・同期解除したプレイリストが、ニコニコ側に残ったマイリストから復活しないようにする */
  `CREATE TABLE IF NOT EXISTS playlist_sync_dismissed (
    account TEXT NOT NULL DEFAULT '',
    syncKey TEXT NOT NULL,
    PRIMARY KEY (account, syncKey)
  );`,

  /* プレイリストとニコニコ側マイリストの同期で使う「前回同期した時点の動画一覧」。削除の伝播を判定するための基準 */
  `CREATE TABLE IF NOT EXISTS playlist_sync_base (
    playlist_id INTEGER NOT NULL,
    videoId TEXT NOT NULL,
    UNIQUE(playlist_id, videoId)
  );`,

  /* プレイリスト内動画 (追加時のタイトル等スナップショットを保持) */
  `CREATE TABLE IF NOT EXISTS playlist_item (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    playlist_id INTEGER NOT NULL,
    videoId TEXT NOT NULL,
    title TEXT,
    thumbnailUrl TEXT,
    lengthSec REAL,
    sortOrder INTEGER NOT NULL,
    addedAt REAL,
    UNIQUE(playlist_id, videoId)
  );`,

  `CREATE INDEX IF NOT EXISTS playlist_item_order_idx ON playlist_item (playlist_id, sortOrder);`,

  /* 動画ごとの再生位置レジューム */
  `CREATE TABLE IF NOT EXISTS resume_position (
    videoKey TEXT PRIMARY KEY,
    positionSec REAL,
    durationSec REAL,
    updatedAt REAL
  );`,

  /* ニコニコ動画本家 (公式サイト) 側の視聴履歴。アプリ内history (自前計測) とは別出所 */
  `CREATE TABLE IF NOT EXISTS nico_watch_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account TEXT NOT NULL DEFAULT '',
    videoId TEXT NOT NULL,
    title TEXT,
    thumbnailUrl TEXT,
    watchedAt REAL NOT NULL DEFAULT 0,
    fetchedAt REAL,
    UNIQUE (account, videoId, watchedAt)
  );`
];

/**
 * SELECT クエリ群 (元: Queries.as)
 */
export const Q = {
  SELECT_VERSION: `SELECT version FROM version WHERE id = 1;`,
  INSERT_VERSION: `INSERT OR REPLACE INTO version (id, version) VALUES (1, ?);`,

  SELECT_VIDEO_ALL: `
    SELECT v.id, v.key, v.uri, v.videoName,
           v.modificationDate, v.creationDate, v.thumbUrl,
           v.playCount, v.time, v.lastPlayDate, v.yetReading, v.pubDate, v.isFavorite, v.description
    FROM NNDDREVideo v
    ORDER BY v.pubDate DESC;`,

  SELECT_VIDEO_BY_KEY: `
    SELECT id, key, uri, videoName,
           modificationDate, creationDate, thumbUrl,
           playCount, time, lastPlayDate, yetReading, pubDate, isFavorite, description
    FROM NNDDREVideo WHERE key = ?;`,

  SELECT_VIDEO_BY_ID: `
    SELECT id, key, uri, videoName,
           modificationDate, creationDate, thumbUrl,
           playCount, time, lastPlayDate, yetReading, pubDate, isFavorite, description
    FROM NNDDREVideo WHERE id = ?;`,

  SELECT_VIDEO_FAVORITE_BY_KEY: `SELECT id, isFavorite FROM NNDDREVideo WHERE key = ?;`,

  /** ライブラリスキャンの差分判定用 (タグ・説明文を読まない軽量版) */
  SELECT_VIDEO_SCAN_SNAPSHOT: `
    SELECT id, key, uri, modificationDate, thumbUrl, time FROM NNDDREVideo;`,

  INSERT_VIDEO: `
    INSERT OR REPLACE INTO NNDDREVideo
      (key, uri, dirpath_id, videoName,
       modificationDate, creationDate, thumbUrl, playCount,
       time, lastPlayDate, yetReading, pubDate, isFavorite, description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,

  UPDATE_VIDEO_FAVORITE: `UPDATE NNDDREVideo SET isFavorite = ? WHERE id = ?;`,

  UPDATE_VIDEO: `
    UPDATE NNDDREVideo SET
      uri = ?, dirpath_id = ?, videoName = ?,
      modificationDate = ?, thumbUrl = ?, playCount = ?, time = ?,
      lastPlayDate = ?, yetReading = ?, pubDate = ?
    WHERE id = ?;`,

  INCREMENT_PLAY_COUNT: `
    UPDATE NNDDREVideo SET playCount = playCount + 1, lastPlayDate = ?
    WHERE key = ?;`,

  DELETE_VIDEO: `DELETE FROM NNDDREVideo WHERE id = ?;`,
  DELETE_VIDEO_TAGS: `DELETE FROM NNDDREVideo_tag WHERE NNDDREVideo_id = ?;`,

  SELECT_TAGS_BY_VIDEO: `
    SELECT t.tag FROM tagstring t
    INNER JOIN NNDDREVideo_tag vt ON vt.tag_id = t.id
    WHERE vt.NNDDREVideo_id = ?;`,

  INSERT_TAG: `INSERT OR IGNORE INTO tagstring (tag) VALUES (?);`,
  SELECT_TAG_ID: `SELECT id FROM tagstring WHERE tag = ?;`,
  INSERT_VIDEO_TAG: `
    INSERT OR IGNORE INTO NNDDREVideo_tag (NNDDREVideo_id, tag_id)
    VALUES (?, ?);`,

  INSERT_FILE: `INSERT OR IGNORE INTO file (dirpath) VALUES (?);`,
  SELECT_FILE_ID: `SELECT id FROM file WHERE dirpath = ?;`,
  DELETE_UNUSED_FILE: `
    DELETE FROM file WHERE id NOT IN (
      SELECT DISTINCT dirpath_id FROM NNDDREVideo WHERE dirpath_id IS NOT NULL
    );`,

  // マイリスト (すべてアカウントごと。第1引数が account)
  SELECT_MYLISTS: `SELECT * FROM mylist WHERE account = ? ORDER BY isDir DESC, name;`,
  SELECT_MYLIST_PARENT: `SELECT parentUrl FROM mylist WHERE account = ? AND url = ?;`,
  INSERT_MYLIST: `
    INSERT OR REPLACE INTO mylist (account, url, name, type, isDir, unPlayCount, lastRenewed, icon, parentUrl)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
  UPDATE_MYLIST_NAME: `UPDATE mylist SET name = ? WHERE account = ? AND url = ?;`,
  UPDATE_MYLIST_PARENT: `UPDATE mylist SET parentUrl = ? WHERE account = ? AND url = ?;`,
  RELEASE_MYLIST_CHILDREN: `UPDATE mylist SET parentUrl = NULL WHERE account = ? AND parentUrl = ?;`,
  UPDATE_MYLIST_ICON: `UPDATE mylist SET icon = ? WHERE account = ? AND url = ?;`,
  DELETE_MYLIST: `DELETE FROM mylist WHERE account = ? AND url = ?;`,
  DELETE_ALL_MYLIST: `DELETE FROM mylist WHERE account = ?;`,

  // 履歴
  SELECT_HISTORY: `SELECT * FROM history ORDER BY watchedAt DESC LIMIT ?;`,
  /** バックアップ用: 上限付きで全件相当を取得 */
  SELECT_HISTORY_ALL: `SELECT * FROM history ORDER BY watchedAt DESC LIMIT ?;`,
  INSERT_HISTORY: `
    INSERT INTO history (videoId, title, thumbnailUrl, watchedAt, isLocal, watchSeconds)
    VALUES (?, ?, ?, ?, ?, ?);`,
  DELETE_HISTORY: `DELETE FROM history;`,
  DELETE_HISTORY_BY_ID: `DELETE FROM history WHERE id = ?;`,

  // スケジュール (アカウントごと)
  SELECT_SCHEDULES: `SELECT * FROM schedule WHERE account = ?;`,
  INSERT_SCHEDULE: `
    INSERT OR REPLACE INTO schedule
      (id, account, name, targetType, targetMyListUrl, targetId, daysOfWeek, time, enabled, lastRun, makeSubfolder)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
  UPDATE_SCHEDULE_LAST_RUN: `UPDATE schedule SET lastRun = ? WHERE account = ? AND id = ?;`,
  DELETE_SCHEDULE: `DELETE FROM schedule WHERE account = ? AND id = ?;`,
  DELETE_ALL_SCHEDULE: `DELETE FROM schedule WHERE account = ?;`,

  // 保存検索
  SELECT_SAVED_SEARCHES: `SELECT * FROM saved_search;`,
  INSERT_SAVED_SEARCH: `
    INSERT OR REPLACE INTO saved_search (id, name, word, type, sortType, parentId, isDir)
    VALUES (?, ?, ?, ?, ?, ?, ?);`,
  UPDATE_SAVED_SEARCH_PARENT: `UPDATE saved_search SET parentId = ? WHERE id = ?;`,
  DELETE_SAVED_SEARCH: `DELETE FROM saved_search WHERE id = ?;`,
  DELETE_ALL_SAVED_SEARCH: `DELETE FROM saved_search;`,

  // NGリスト
  // コメントNG (アカウントごと。第1引数が account)
  SELECT_NG_LIST: `SELECT * FROM ng_list WHERE account = ?;`,
  INSERT_NG_LIST: `INSERT OR IGNORE INTO ng_list (account, type, value) VALUES (?, ?, ?);`,
  DELETE_NG_LIST: `DELETE FROM ng_list WHERE account = ? AND type = ? AND value = ?;`,
  DELETE_ALL_NG_LIST: `DELETE FROM ng_list WHERE account = ?;`,
  SELECT_NG_SYNC_BASE: `SELECT type, value FROM ng_sync_base WHERE account = ?;`,
  INSERT_NG_SYNC_BASE: `INSERT OR IGNORE INTO ng_sync_base (account, type, value) VALUES (?, ?, ?);`,
  DELETE_NG_SYNC_BASE_BY_ACCOUNT: `DELETE FROM ng_sync_base WHERE account = ?;`,
  DELETE_ALL_NG_SYNC_BASE: `DELETE FROM ng_sync_base WHERE account = ?;`,

  SELECT_SEARCH_HISTORY: `SELECT word FROM search_history ORDER BY usedAt DESC, id DESC LIMIT ?;`,
  UPSERT_SEARCH_HISTORY: `INSERT INTO search_history (word, usedAt) VALUES (?, ?)
    ON CONFLICT(word) DO UPDATE SET usedAt = excluded.usedAt;`,
  INSERT_SEARCH_HISTORY_IGNORE: `INSERT OR IGNORE INTO search_history (word, usedAt) VALUES (?, ?);`,
  TRIM_SEARCH_HISTORY: `DELETE FROM search_history WHERE id NOT IN
    (SELECT id FROM search_history ORDER BY usedAt DESC, id DESC LIMIT ?);`,
  SELECT_SEARCH_HISTORY_USED_RANGE: `SELECT MIN(usedAt) AS minUsedAt, MAX(usedAt) AS maxUsedAt FROM search_history;`,
  DELETE_ALL_SEARCH_HISTORY: `DELETE FROM search_history;`,

  SELECT_MYLIST_HISTORY: `SELECT name, url FROM mylist_history WHERE account = ? ORDER BY usedAt DESC, id DESC LIMIT ?;`,
  UPSERT_MYLIST_HISTORY: `INSERT INTO mylist_history (account, url, name, usedAt) VALUES (?, ?, ?, ?)
    ON CONFLICT(account, url) DO UPDATE SET name = excluded.name, usedAt = excluded.usedAt;`,
  INSERT_MYLIST_HISTORY_IGNORE: `INSERT OR IGNORE INTO mylist_history (account, url, name, usedAt) VALUES (?, ?, ?, ?);`,
  TRIM_MYLIST_HISTORY: `DELETE FROM mylist_history WHERE account = ? AND id NOT IN
    (SELECT id FROM mylist_history WHERE account = ? ORDER BY usedAt DESC, id DESC LIMIT ?);`,
  SELECT_MYLIST_HISTORY_USED_RANGE: `SELECT MIN(usedAt) AS minUsedAt, MAX(usedAt) AS maxUsedAt FROM mylist_history WHERE account = ?;`,
  DELETE_ALL_MYLIST_HISTORY: `DELETE FROM mylist_history WHERE account = ?;`,

  SELECT_NG_TAGS: `SELECT tag FROM ng_tag;`,
  INSERT_NG_TAG: `INSERT OR IGNORE INTO ng_tag (tag) VALUES (?);`,
  DELETE_NG_TAG: `DELETE FROM ng_tag WHERE tag = ?;`,
  DELETE_ALL_NG_TAG: `DELETE FROM ng_tag;`,

  SELECT_NG_UPS: `SELECT userId FROM ng_up;`,
  INSERT_NG_UP: `INSERT OR IGNORE INTO ng_up (userId) VALUES (?);`,
  DELETE_NG_UP: `DELETE FROM ng_up WHERE userId = ?;`,
  DELETE_ALL_NG_UP: `DELETE FROM ng_up;`,

  // プレイリスト (完全ローカル)
  SELECT_PLAYLISTS: `SELECT * FROM playlist WHERE account = ? ORDER BY name;`,
  INSERT_PLAYLIST: `INSERT INTO playlist (account, name, createdAt, updatedAt) VALUES (?, ?, ?, ?);`,
  UPDATE_PLAYLIST_NAME: `UPDATE playlist SET name = ?, updatedAt = ? WHERE id = ?;`,
  UPDATE_PLAYLIST_ICON: `UPDATE playlist SET icon = ? WHERE id = ?;`,
  DELETE_PLAYLIST: `DELETE FROM playlist WHERE id = ?;`,
  DELETE_ALL_PLAYLIST: `DELETE FROM playlist WHERE account = ?;`,

  SELECT_PLAYLIST_ITEMS: `SELECT * FROM playlist_item WHERE playlist_id = ? ORDER BY sortOrder;`,
  SELECT_PLAYLIST_ITEM_MAX_ORDER: `SELECT MAX(sortOrder) AS maxOrder FROM playlist_item WHERE playlist_id = ?;`,
  INSERT_PLAYLIST_ITEM: `
    INSERT OR IGNORE INTO playlist_item
      (playlist_id, videoId, title, thumbnailUrl, lengthSec, sortOrder, addedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?);`,
  DELETE_PLAYLIST_ITEM: `DELETE FROM playlist_item WHERE playlist_id = ? AND videoId = ?;`,
  DELETE_PLAYLIST_ITEMS: `DELETE FROM playlist_item WHERE playlist_id = ?;`,
  UPDATE_PLAYLIST_SERVER_MYLIST: `UPDATE playlist SET serverMylistId = ? WHERE id = ?;`,
  SELECT_PLAYLIST_SYNC_BASE: `SELECT videoId FROM playlist_sync_base WHERE playlist_id = ?;`,
  INSERT_PLAYLIST_SYNC_BASE: `INSERT OR IGNORE INTO playlist_sync_base (playlist_id, videoId) VALUES (?, ?);`,
  DELETE_PLAYLIST_SYNC_BASE: `DELETE FROM playlist_sync_base WHERE playlist_id = ?;`,
  DELETE_ALL_PLAYLIST_SYNC_BASE: `DELETE FROM playlist_sync_base WHERE playlist_id IN (SELECT id FROM playlist WHERE account = ?);`,
  DELETE_ALL_PLAYLIST_ITEM: `DELETE FROM playlist_item WHERE playlist_id IN (SELECT id FROM playlist WHERE account = ?);`,
  UPDATE_PLAYLIST_ITEM_ORDER: `UPDATE playlist_item SET sortOrder = ? WHERE playlist_id = ? AND videoId = ?;`,
  SELECT_PLAYLISTS_CONTAINING_VIDEO: `SELECT playlist_id FROM playlist_item WHERE videoId = ? AND playlist_id IN (SELECT id FROM playlist WHERE account = ?);`,

  // 再生位置レジューム
  SELECT_RESUME: `SELECT * FROM resume_position WHERE videoKey = ?;`,
  UPSERT_RESUME: `
    INSERT OR REPLACE INTO resume_position (videoKey, positionSec, durationSec, updatedAt)
    VALUES (?, ?, ?, ?);`,
  DELETE_RESUME: `DELETE FROM resume_position WHERE videoKey = ?;`,

  // ニコニコ動画本家 視聴履歴
  SELECT_NICO_WATCH_HISTORY: `SELECT * FROM nico_watch_history WHERE account = ? ORDER BY watchedAt DESC LIMIT ?;`,
  SELECT_NICO_WATCH_HISTORY_KEYS: `SELECT id, videoId, watchedAt FROM nico_watch_history WHERE account = ?;`,
  SELECT_NICO_WATCH_HISTORY_EXISTS: `SELECT 1 FROM nico_watch_history WHERE account = ? AND videoId = ?;`,
  UPSERT_NICO_WATCH_HISTORY: `
    INSERT INTO nico_watch_history (account, videoId, title, thumbnailUrl, watchedAt, fetchedAt)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (account, videoId, watchedAt) DO UPDATE SET
      title = excluded.title, thumbnailUrl = excluded.thumbnailUrl, fetchedAt = excluded.fetchedAt;`,
  DELETE_NICO_WATCH_HISTORY: `DELETE FROM nico_watch_history WHERE account = ?;`,
  DELETE_NICO_WATCH_HISTORY_BY_VIDEO_ID: `DELETE FROM nico_watch_history WHERE account = ? AND videoId = ?;`,
  /** 本家の履歴に無くなった項目の掃除用 */
  DELETE_NICO_WATCH_HISTORY_BY_ID: `DELETE FROM nico_watch_history WHERE id = ?;`
} as const;
