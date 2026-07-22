/**
 * IPC チャネル名定義 (preload <-> main)
 *
 * `nndd:` 名前空間を必ず付けてElectronシステム標準と衝突しないようにする。
 */
export const IpcChannel = {
  // ライブラリ
  LIBRARY_LIST: 'nndd:library:list',
  LIBRARY_GET: 'nndd:library:get',
  LIBRARY_DELETE: 'nndd:library:delete',
  LIBRARY_SCAN: 'nndd:library:scan',
  LIBRARY_UPDATE_TAGS: 'nndd:library:updateTags',

  // 認証
  AUTH_LOGIN: 'nndd:auth:login',
  AUTH_LOGOUT: 'nndd:auth:logout',
  AUTH_STATUS: 'nndd:auth:status',
  AUTH_OPEN_LOGIN_WINDOW: 'nndd:auth:openLoginWindow',
  /** メール+パスワード送信 (アプリ内ログイン) */
  AUTH_LOGIN_FORM: 'nndd:auth:loginForm',
  /** 2段階認証コード送信 */
  AUTH_LOGIN_MFA: 'nndd:auth:loginMfa',
  /** メール/パスワードをセキュアストレージに保存 ({ email, password }) */
  AUTH_SAVE_CREDENTIALS: 'nndd:auth:saveCredentials',
  /** 保存済みメール/パスワードを削除 */
  AUTH_CLEAR_CREDENTIALS: 'nndd:auth:clearCredentials',
  /** 保存済みメール/パスワードが存在するか → boolean */
  AUTH_HAS_CREDENTIALS: 'nndd:auth:hasCredentials',
  /** 起動時セッション確認 + 期限切れなら保存済み認証情報で自動再ログイン → AutoReloginResult */
  AUTH_AUTO_RELOGIN: 'nndd:auth:autoRelogin',
  /** 保存済みメールアドレスを返す → string | null */
  AUTH_GET_SAVED_EMAIL: 'nndd:auth:getSavedEmail',
  /** 保存済み認証情報でログイン → FormLoginResult */
  AUTH_LOGIN_WITH_SAVED: 'nndd:auth:loginWithSaved',
  /** セッション期限切れ通知 (main→renderer) → { mfaRequired?: boolean; mfaSubmitUrl?: string } */
  AUTH_SESSION_EXPIRED: 'nndd:auth:sessionExpired',

  // ダウンロード
  DOWNLOAD_ENQUEUE: 'nndd:download:enqueue',
  DOWNLOAD_CANCEL: 'nndd:download:cancel',
  DOWNLOAD_LIST: 'nndd:download:list',
  DOWNLOAD_RETRY: 'nndd:download:retry',
  DOWNLOAD_REMOVE: 'nndd:download:remove',
  DOWNLOAD_CLEAR_COMPLETED: 'nndd:download:clearCompleted',
  DOWNLOAD_PROGRESS_EVENT: 'nndd:download:progress', // 通知

  // 検索
  SEARCH_EXECUTE: 'nndd:search:execute',
  SEARCH_SAVED_LIST: 'nndd:search:savedList',
  SEARCH_SAVED_ADD: 'nndd:search:savedAdd',
  SEARCH_SAVED_REMOVE: 'nndd:search:savedRemove',

  // ランキング
  RANKING_FETCH: 'nndd:ranking:fetch',
  RANKING_GENRES: 'nndd:ranking:genres',

  // マイリスト
  MYLIST_LIST: 'nndd:mylist:list',
  MYLIST_GET: 'nndd:mylist:get',
  MYLIST_ADD: 'nndd:mylist:add',
  MYLIST_REMOVE: 'nndd:mylist:remove',
  MYLIST_RENEW: 'nndd:mylist:renew',
  MYLIST_RENEW_ALL: 'nndd:mylist:renewAll',
  /** ログイン済みアカウントのマイリスト一覧を取得 */
  MYLIST_FETCH_ACCOUNT: 'nndd:mylist:fetchAccount',
  /** {url, type} からマイリスト/チャンネル/ユーザー投稿の表示名を取得 → {name: string} | null */
  MYLIST_FETCH_INFO: 'nndd:mylist:fetchInfo',
  /** {url, type, page, pageSize} から動画一覧をページ指定で取得 → {items: MyListItem[], total: number} */
  MYLIST_FETCH_PAGE: 'nndd:mylist:fetchPage',
  /** シリーズIDからアイテム一覧を取得 → {name: string, items: {videoId:string,title:string}[]} */
  SERIES_FETCH: 'nndd:series:fetch',
  /** マイリストの表示名を更新 */
  MYLIST_UPDATE_NAME: 'nndd:mylist:updateName',
  /** 動画をとりあえずマイリストに追加 → true */
  MYLIST_ADD_VIDEO_DEFLIST: 'nndd:mylist:addVideoDeflist',

  // 動画
  VIDEO_GET_WATCH_INFO: 'nndd:video:getWatchInfo',
  VIDEO_GET_COMMENTS: 'nndd:video:getComments',
  VIDEO_OPEN_PLAYER: 'nndd:video:openPlayer',
  VIDEO_BUILD_LOCAL_URL: 'nndd:video:buildLocalUrl',
  VIDEO_GET_STREAM_URL: 'nndd:video:getStreamUrl',
  /** ストリーミング (yt-dlp 経由) の進捗通知 */
  VIDEO_STREAM_PROGRESS_EVENT: 'nndd:video:streamProgress',

  // 履歴
  HISTORY_LIST: 'nndd:history:list',
  HISTORY_ADD: 'nndd:history:add',
  HISTORY_CLEAR: 'nndd:history:clear',

  // プレイリスト (完全ローカル、サーバー同期なし)
  PLAYLIST_LIST: 'nndd:playlist:list',
  PLAYLIST_CREATE: 'nndd:playlist:create',
  PLAYLIST_RENAME: 'nndd:playlist:rename',
  PLAYLIST_REMOVE: 'nndd:playlist:remove',
  PLAYLIST_GET_ITEMS: 'nndd:playlist:getItems',
  PLAYLIST_ADD_VIDEO: 'nndd:playlist:addVideo',
  PLAYLIST_REMOVE_VIDEO: 'nndd:playlist:removeVideo',
  PLAYLIST_REORDER: 'nndd:playlist:reorder',
  /** 動画が登録済みのプレイリストID一覧 (追加メニューのチェック表示用) */
  PLAYLIST_LIST_CONTAINING: 'nndd:playlist:listContaining',

  // 再生位置レジューム
  RESUME_GET: 'nndd:resume:get',
  RESUME_SAVE: 'nndd:resume:save',
  RESUME_CLEAR: 'nndd:resume:clear',
  /** 複数動画IDのレジューム情報をまとめて取得 (VideoCard等でのバッジ表示用) */
  RESUME_LIST_BATCH: 'nndd:resume:listBatch',

  // スケジュール
  SCHEDULE_LIST: 'nndd:schedule:list',
  SCHEDULE_ADD: 'nndd:schedule:add',
  SCHEDULE_UPDATE: 'nndd:schedule:update',
  SCHEDULE_REMOVE: 'nndd:schedule:remove',

  // 設定
  CONFIG_GET: 'nndd:config:get',
  CONFIG_SET: 'nndd:config:set',
  CONFIG_GET_ALL: 'nndd:config:getAll',

  // システム
  SYS_OPEN_PATH: 'nndd:sys:openPath',
  SYS_CHOOSE_DIRECTORY: 'nndd:sys:chooseDirectory',
  /** ファイル選択ダイアログ (filters?: Electron.FileFilter[]) → string | null */
  SYS_CHOOSE_FILE: 'nndd:sys:chooseFile',
  SYS_GET_VERSION: 'nndd:sys:getVersion',
  SYS_GET_APP_INFO: 'nndd:sys:getAppInfo',

  // NGリスト
  NG_LIST_COMMENT: 'nndd:ng:listComment',
  NG_ADD_COMMENT: 'nndd:ng:addComment',
  NG_REMOVE_COMMENT: 'nndd:ng:removeComment',
  NG_LIST_TAG: 'nndd:ng:listTag',
  NG_ADD_TAG: 'nndd:ng:addTag',
  NG_REMOVE_TAG: 'nndd:ng:removeTag',
  NG_LIST_UP: 'nndd:ng:listUp',
  NG_ADD_UP: 'nndd:ng:addUp',
  NG_REMOVE_UP: 'nndd:ng:removeUp',

  // コメントローカル読み込み
  COMMENT_READ_LOCAL: 'nndd:comment:readLocal',

  // 過去コメント
  /** 過去コメントをニコニコから取得 (videoId + whenUnixSec + maxCount?) */
  PAST_COMMENT_FETCH: 'nndd:pastComment:fetch',
  /** 過去コメント取得の進捗通知 (main→renderer, msg: string) */
  PAST_COMMENT_FETCH_PROGRESS: 'nndd:pastComment:fetchProgress',
  /** ローカルXMLから日時フィルタして過去コメント取得 (filePath + whenUnixSec) */
  PAST_COMMENT_FETCH_LOCAL: 'nndd:pastComment:fetchLocal',

  // ThumbInfo XML ローカル読み込み (ローカル再生時の動画情報復元)
  THUMB_INFO_XML_READ: 'nndd:info:readLocal',

  // 再生回数カウントアップ (10秒以上再生時)
  VIDEO_INCREMENT_PLAY_COUNT: 'nndd:video:incrementPlayCount',
  VIDEO_DELETE_CACHE: 'nndd:video:deleteCache',

  // ニコニコ市場情報ファイルを開く (存在しない場合は null を返す)
  LIBRARY_OPEN_ICHIBA: 'nndd:library:openIchiba',

  // 接続診断
  DIAG_RUN: 'nndd:diag:run',

  // HTTPサーバー制御
  HTTPD_START: 'nndd:httpd:start',
  HTTPD_STOP: 'nndd:httpd:stop',
  HTTPD_STATUS: 'nndd:httpd:status',

  // LANライブラリ (本家NNDD互換クライアント)
  LAN_STATUS: 'nndd:lan:status',
  LAN_LIBRARY_LIST: 'nndd:lan:library:list',
  LAN_VIDEO_STREAM: 'nndd:lan:video:stream',

  // ログ
  LOG_READ: 'nndd:log:read',
  LOG_CLEAR: 'nndd:log:clear',
  LOG_GET_PATH: 'nndd:log:getPath',

  // niconicoモード WebContentsView制御 (one-way)
  PLAYER_NICONICO_INIT: 'nndd:player:niconico:init',
  PLAYER_NICONICO_RESIZE: 'nndd:player:niconico:resize',
  PLAYER_NICONICO_DESTROY: 'nndd:player:niconico:destroy',
  /** niconicoプレイヤーのフルスクリーン状態変化 → renderer通知 */
  PLAYER_NICONICO_FULLSCREEN: 'nndd:player:niconico:fullscreen',
  /** BrowserWindowのフルスクリーン状態変化 → renderer通知 */
  PLAYER_WINDOW_FULLSCREEN: 'nndd:player:window:fullscreen',

  // 更新
  UPDATE_CHECK: 'nndd:update:check',
  UPDATE_DOWNLOAD: 'nndd:update:download',
  UPDATE_INSTALL: 'nndd:update:install',
  UPDATE_EVENT: 'nndd:update:event',

  // コメントウィンドウ (別 BrowserWindow)
  /** Player→Main: コメントウィンドウを開く/フォーカス */
  COMMENT_WINDOW_OPEN: 'nndd:comment:window:open',
  /** Player→Main(→Comment): コメント配列をプッシュ */
  COMMENT_WINDOW_PUSH: 'nndd:comment:window:push',
  /** Player→Main(→Comment): 現在再生位置 (秒) */
  COMMENT_WINDOW_TIME: 'nndd:comment:window:time',
  /** Comment→Main(→Player): シーク要求 (秒) */
  COMMENT_WINDOW_SEEK: 'nndd:comment:window:seek',
  /** Main→Comment: 初期化データ */
  COMMENT_WINDOW_INIT: 'nndd:comment:window:init',
  /** Main→Player: コメントウィンドウからのシーク通知 */
  PLAYER_SEEK: 'nndd:player:seek',

  /**
   * Comment→Main(→Player): 過去コメント配列をプッシュ。
   * null を送ると過去コメントモード解除。
   */
  COMMENT_WINDOW_PAST_PUSH: 'nndd:comment:window:past:push',
  /** Main→Player: コメントウィンドウからの過去コメント */
  PLAYER_PAST_COMMENTS: 'nndd:player:pastComments',

  /**
   * ローカルXMLに対して差分コメント取得・マージ保存。
   * args: (videoId: string, xmlPath: string)
   * returns: { added: number }
   */
  PAST_COMMENT_REFETCH: 'nndd:pastComment:refetch',

  // ストリームキャッシュ管理
  /** キャッシュ情報取得 → { sizeBytes: number; fileCount: number; dir: string } */
  CACHE_INFO: 'nndd:cache:info',
  /** キャッシュ全削除 */
  CACHE_CLEAR: 'nndd:cache:clear',
  /** キャッシュディレクトリ変更 (再起動後に有効) */
  CACHE_SET_DIR: 'nndd:cache:setDir',

  // フォロー中フィード
  /** フォロー中の新着動画取得 → SearchResultItem[] */
  FOLLOW_FEED: 'nndd:follow:feed',
  /** フォロー新着APIエンドポイント候補を全て試してレスポンス確認 (デバッグ用) */
  FOLLOW_PROBE: 'nndd:follow:probe',
  /** フォロー中ユーザー一覧取得 → { id, nickname, iconUrl }[] */
  FOLLOW_USERS: 'nndd:follow:users',

  // システム
  /** 内蔵ブラウザウィンドウで URL/ファイルを開く */
  SYS_OPEN_IN_BROWSER: 'nndd:sys:openInBrowser',

  // ナビゲーション (プレイヤーウィンドウ → メインウィンドウ)
  /** マイリストIDを指定してマイリストタブを開く */
  NAV_MYLIST: 'nndd:nav:mylist',
  /** シリーズIDを指定してマイリストタブ(シリーズ表示)を開く */
  NAV_SERIES: 'nndd:nav:series',
  /** タグ文字列を指定して検索タブでタグ検索を実行する */
  NAV_SEARCH_TAG: 'nndd:nav:searchTag',
  /** ユーザー情報を指定してフォロー中タブでそのユーザーの投稿動画に絞り込む(フォロー有無問わず) */
  NAV_FOLLOW_USER: 'nndd:nav:followUser',

  /** ユーザーIDからアイコンURL取得 → string | null */
  USER_ICON_FETCH: 'nndd:user:iconFetch',

  // 画像キャッシュ
  /** 画像URLをImageCacheで取得してローカルURLを返す (url: string) → string */
  IMAGE_FETCH: 'nndd:image:fetch',
  /** キャッシュ使用状況取得 → { sizeBytes: number; fileCount: number; dir: string } */
  IMAGE_CACHE_INFO: 'nndd:imageCache:info',
  /** キャッシュを全削除 → true */
  IMAGE_CACHE_CLEAR: 'nndd:imageCache:clear',
  /** キャッシュ有効/無効設定 (enabled: boolean) → true */
  IMAGE_CACHE_ENABLED_SET: 'nndd:imageCache:enabledSet',
  /** キャッシュ上限サイズ設定 (maxSizeMb: number) → true */
  IMAGE_CACHE_MAX_SIZE_SET: 'nndd:imageCache:maxSizeSet',

  // ライブラリ フォルダ操作
  /** 動画IDの配列を渡してライブラリにDL済みのものだけ返す ({ videoIds: string[] } → string[]) */
  LIBRARY_CHECK_BATCH: 'nndd:library:checkBatch',
  /** ライブラリ配下にフォルダを作成 (folderName: string) → createdPath: string */
  LIBRARY_FOLDER_CREATE: 'nndd:library:folder:create',
  /** フォルダとその配下ファイルを削除 (folderPath: string) → true */
  LIBRARY_FOLDER_DELETE: 'nndd:library:folder:delete',
  /** ライブラリ配下のサブディレクトリ一覧を返す () → string[] */
  LIBRARY_FOLDER_LIST: 'nndd:library:folder:list',
  /** 今コメント no 配列JSONを読む (filePath: string) → number[] */
  COMMENT_NOW_IDS_READ: 'nndd:comment:nowIds:read',
  /** 動画ファイルを別フォルダへ移動 ({ videoIds: number[], targetFolder: string }) → true */
  LIBRARY_VIDEO_MOVE: 'nndd:library:video:move',
  /** 指定フォルダ内の動画ファイル一覧を名前順で返す (folderPath: string) → string[] */
  LIBRARY_FOLDER_VIDEOS: 'nndd:library:folder:videos',

  // 外部ツール (バイナリ管理)
  /** yt-dlp / ffmpeg の検出状態を返す → { ytDlp: BinaryStatus, ffmpeg: BinaryStatus } */
  BINARY_STATUS: 'nndd:binary:status',
  /** yt-dlp を userData/bin にダウンロードする → installPath: string */
  BINARY_INSTALL_YT_DLP: 'nndd:binary:install:yt-dlp',
  /** ffmpeg を userData/bin にダウンロード → installPath: string */
  BINARY_INSTALL_FFMPEG: 'nndd:binary:install:ffmpeg',
  /** ダウンロード進捗イベント (main → renderer) { tool: string; pct: number } */
  BINARY_INSTALL_PROGRESS: 'nndd:binary:install:progress',

  // ウィンドウ制御 (カスタムタイトルバー用)
  WIN_MINIMIZE: 'nndd:win:minimize',
  WIN_MAXIMIZE_TOGGLE: 'nndd:win:maximizeToggle',
  WIN_CLOSE: 'nndd:win:close',
  WIN_IS_MAXIMIZED: 'nndd:win:isMaximized',
  /** Main→Renderer: 最大化状態変化通知 (maximized: boolean) */
  WIN_MAXIMIZE_CHANGED: 'nndd:win:maximizeChanged',

  // GitHub OAuth Device Flow
  /** → GitHubStatus */
  GITHUB_STATUS: 'nndd:github:status',
  /** Device Flow開始 → DeviceFlowStartResult | { error: string } */
  GITHUB_START_DEVICE_FLOW: 'nndd:github:startDeviceFlow',
  /** Main→Renderer: Device Flow進捗通知 → DeviceFlowEvent */
  GITHUB_DEVICE_FLOW_EVENT: 'nndd:github:deviceFlowEvent',
  GITHUB_CANCEL_DEVICE_FLOW: 'nndd:github:cancelDeviceFlow',
  GITHUB_LOGOUT: 'nndd:github:logout',

  // バックアップ・同期 (GitHub Gist)
  /** → SyncProfile[] */
  BACKUP_LIST_PROFILES: 'nndd:backup:listProfiles',
  /** → string | null (自動アップロード対象のアクティブプロファイルID) */
  BACKUP_GET_ACTIVE_PROFILE_ID: 'nndd:backup:getActiveProfileId',
  /** (name: string) → SyncProfile */
  BACKUP_ADD_PROFILE: 'nndd:backup:addProfile',
  /** (id: string, patch: Partial<SyncProfile>) → SyncProfile */
  BACKUP_UPDATE_PROFILE: 'nndd:backup:updateProfile',
  /** (id: string) → void */
  BACKUP_REMOVE_PROFILE: 'nndd:backup:removeProfile',
  /** (id: string | null) → void */
  BACKUP_SET_ACTIVE_PROFILE: 'nndd:backup:setActiveProfile',
  /** (profileId: string, gistId: string) → SyncProfile */
  BACKUP_LINK_EXISTING_GIST: 'nndd:backup:linkExistingGist',
  /** → GistSummary[] (自アプリ作成のGistのみ) */
  BACKUP_LIST_CANDIDATE_GISTS: 'nndd:backup:listCandidateGists',
  /** → SyncProfile[] (GitHub上の未連携Gistから新規インポートされたプロファイル) */
  BACKUP_IMPORT_PROFILES: 'nndd:backup:importProfiles',
  /** (profileId: string) → BackupResult */
  BACKUP_UPLOAD: 'nndd:backup:upload',
  /** (profileId: string) → BackupResult */
  BACKUP_DOWNLOAD: 'nndd:backup:download',
  /** (profileId: string) → BackupPayload | null */
  BACKUP_PREVIEW: 'nndd:backup:preview'
} as const;

export type IpcChannelValue = typeof IpcChannel[keyof typeof IpcChannel];

export interface AutoReloginResult {
  ok: boolean;
  mfaRequired?: boolean;
  mfaSubmitUrl?: string;
  /** 保存済み認証情報なし — 何もしない */
  noCredentials?: boolean;
  error?: string;
}
