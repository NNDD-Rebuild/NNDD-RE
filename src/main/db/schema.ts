/**
 * NNDD ライブラリDBのスキーマ定義。
 * 元: src/org/mineap/nndd/library/sqlite/Queries.as / DbAccessHelper.as
 *
 * 元の AIR 版から完全互換のスキーマを移植する。
 * 既存のオフライン NNDD ライブラリ DB をそのまま読み込めるようにする。
 */

export const DB_SCHEMA_VERSION = '5';

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
    pubDate REAL
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
    url TEXT UNIQUE,
    name TEXT,
    type TEXT,
    isDir INTEGER DEFAULT 0,
    unPlayCount INTEGER DEFAULT 0,
    lastRenewed REAL
  );`,

  /* 視聴履歴 */
  `CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    videoId TEXT,
    title TEXT,
    thumbnailUrl TEXT,
    watchedAt REAL,
    isLocal INTEGER
  );`,

  /* ダウンロードスケジュール */
  `CREATE TABLE IF NOT EXISTS schedule (
    id TEXT PRIMARY KEY,
    name TEXT,
    targetMyListUrl TEXT,
    daysOfWeek TEXT,
    time TEXT,
    enabled INTEGER,
    lastRun REAL
  );`,

  /* 保存検索 */
  `CREATE TABLE IF NOT EXISTS saved_search (
    id TEXT PRIMARY KEY,
    name TEXT,
    word TEXT,
    type TEXT,
    sortType TEXT
  );`,

  /* NGリスト (コメント) */
  `CREATE TABLE IF NOT EXISTS ng_list (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT,
    value TEXT,
    UNIQUE(type, value)
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

  /* 自作プレイリスト (ローカル完結、サーバー同期なし) */
  `CREATE TABLE IF NOT EXISTS playlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    createdAt REAL,
    updatedAt REAL
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
           v.playCount, v.time, v.lastPlayDate, v.yetReading, v.pubDate
    FROM NNDDREVideo v
    ORDER BY v.pubDate DESC;`,

  SELECT_VIDEO_BY_KEY: `
    SELECT id, key, uri, videoName,
           modificationDate, creationDate, thumbUrl,
           playCount, time, lastPlayDate, yetReading, pubDate
    FROM NNDDREVideo WHERE key = ?;`,

  SELECT_VIDEO_BY_ID: `
    SELECT id, key, uri, videoName,
           modificationDate, creationDate, thumbUrl,
           playCount, time, lastPlayDate, yetReading, pubDate
    FROM NNDDREVideo WHERE id = ?;`,

  INSERT_VIDEO: `
    INSERT OR REPLACE INTO NNDDREVideo
      (key, uri, dirpath_id, videoName,
       modificationDate, creationDate, thumbUrl, playCount,
       time, lastPlayDate, yetReading, pubDate)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,

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

  // マイリスト
  SELECT_MYLISTS: `SELECT * FROM mylist ORDER BY name;`,
  INSERT_MYLIST: `
    INSERT OR REPLACE INTO mylist (url, name, type, isDir, unPlayCount, lastRenewed)
    VALUES (?, ?, ?, ?, ?, ?);`,
  DELETE_MYLIST: `DELETE FROM mylist WHERE url = ?;`,
  DELETE_ALL_MYLIST: `DELETE FROM mylist;`,

  // 履歴
  SELECT_HISTORY: `SELECT * FROM history ORDER BY watchedAt DESC LIMIT ?;`,
  /** バックアップ用: 上限付きで全件相当を取得 */
  SELECT_HISTORY_ALL: `SELECT * FROM history ORDER BY watchedAt DESC LIMIT ?;`,
  INSERT_HISTORY: `
    INSERT INTO history (videoId, title, thumbnailUrl, watchedAt, isLocal)
    VALUES (?, ?, ?, ?, ?);`,
  DELETE_HISTORY: `DELETE FROM history;`,

  // スケジュール
  SELECT_SCHEDULES: `SELECT * FROM schedule;`,
  INSERT_SCHEDULE: `
    INSERT OR REPLACE INTO schedule
      (id, name, targetMyListUrl, daysOfWeek, time, enabled, lastRun)
    VALUES (?, ?, ?, ?, ?, ?, ?);`,
  DELETE_SCHEDULE: `DELETE FROM schedule WHERE id = ?;`,
  DELETE_ALL_SCHEDULE: `DELETE FROM schedule;`,

  // 保存検索
  SELECT_SAVED_SEARCHES: `SELECT * FROM saved_search;`,
  INSERT_SAVED_SEARCH: `
    INSERT OR REPLACE INTO saved_search (id, name, word, type, sortType)
    VALUES (?, ?, ?, ?, ?);`,
  DELETE_SAVED_SEARCH: `DELETE FROM saved_search WHERE id = ?;`,
  DELETE_ALL_SAVED_SEARCH: `DELETE FROM saved_search;`,

  // NGリスト
  SELECT_NG_LIST: `SELECT * FROM ng_list;`,
  INSERT_NG_LIST: `INSERT OR IGNORE INTO ng_list (type, value) VALUES (?, ?);`,
  DELETE_NG_LIST: `DELETE FROM ng_list WHERE type = ? AND value = ?;`,
  DELETE_ALL_NG_LIST: `DELETE FROM ng_list;`,

  SELECT_NG_TAGS: `SELECT tag FROM ng_tag;`,
  INSERT_NG_TAG: `INSERT OR IGNORE INTO ng_tag (tag) VALUES (?);`,
  DELETE_NG_TAG: `DELETE FROM ng_tag WHERE tag = ?;`,
  DELETE_ALL_NG_TAG: `DELETE FROM ng_tag;`,

  SELECT_NG_UPS: `SELECT userId FROM ng_up;`,
  INSERT_NG_UP: `INSERT OR IGNORE INTO ng_up (userId) VALUES (?);`,
  DELETE_NG_UP: `DELETE FROM ng_up WHERE userId = ?;`,
  DELETE_ALL_NG_UP: `DELETE FROM ng_up;`,

  // プレイリスト (完全ローカル)
  SELECT_PLAYLISTS: `SELECT * FROM playlist ORDER BY name;`,
  INSERT_PLAYLIST: `INSERT INTO playlist (name, createdAt, updatedAt) VALUES (?, ?, ?);`,
  UPDATE_PLAYLIST_NAME: `UPDATE playlist SET name = ?, updatedAt = ? WHERE id = ?;`,
  DELETE_PLAYLIST: `DELETE FROM playlist WHERE id = ?;`,
  DELETE_ALL_PLAYLIST: `DELETE FROM playlist;`,

  SELECT_PLAYLIST_ITEMS: `SELECT * FROM playlist_item WHERE playlist_id = ? ORDER BY sortOrder;`,
  SELECT_PLAYLIST_ITEM_MAX_ORDER: `SELECT MAX(sortOrder) AS maxOrder FROM playlist_item WHERE playlist_id = ?;`,
  INSERT_PLAYLIST_ITEM: `
    INSERT OR IGNORE INTO playlist_item
      (playlist_id, videoId, title, thumbnailUrl, lengthSec, sortOrder, addedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?);`,
  DELETE_PLAYLIST_ITEM: `DELETE FROM playlist_item WHERE playlist_id = ? AND videoId = ?;`,
  DELETE_PLAYLIST_ITEMS: `DELETE FROM playlist_item WHERE playlist_id = ?;`,
  DELETE_ALL_PLAYLIST_ITEM: `DELETE FROM playlist_item;`,
  UPDATE_PLAYLIST_ITEM_ORDER: `UPDATE playlist_item SET sortOrder = ? WHERE playlist_id = ? AND videoId = ?;`,
  SELECT_PLAYLISTS_CONTAINING_VIDEO: `SELECT playlist_id FROM playlist_item WHERE videoId = ?;`,

  // 再生位置レジューム
  SELECT_RESUME: `SELECT * FROM resume_position WHERE videoKey = ?;`,
  UPSERT_RESUME: `
    INSERT OR REPLACE INTO resume_position (videoKey, positionSec, durationSec, updatedAt)
    VALUES (?, ?, ?, ?);`,
  DELETE_RESUME: `DELETE FROM resume_position WHERE videoKey = ?;`
} as const;
