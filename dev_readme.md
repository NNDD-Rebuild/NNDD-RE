# NNDD-RE 開発ガイド

TypeScript + React + Electron でニコニコ動画をダウンロード・再生するアプリケーション。このガイドは新機能追加・バグ修正時の指針。

## クイックスタート

```bash
npm install
npm run dev          # 開発実行 (main + renderer HMR)
npm run tc:all      # 型チェック (node + web 両方)
npm run build       # プロダクションビルド
npm run check:ipc   # IpcChannel と ipcMain.handle 登録の突き合わせ
npm run gen:proto   # proto/nicolive から src/main/nicovideo/live/gen/ を生成
```

詳細は CLAUDE.md を参照。

---

## アーキテクチャ概観

```
┌─────────────────┐
│  Renderer       │  React 18 + Tailwind
│  (Browser)      │
└────────┬────────┘
         │ IPC (contextBridge)
┌────────▼────────┐
│  Preload        │  node_integration=false 下で contextBridge 経由で API 公開
└────────┬────────┘
         │ ipcMain.handle
┌────────▼────────┐
│  Main           │  Electron main process (Node.js)
│  Process        │  ・API呼び出し ・DB操作 ・ファイルI/O ・外部プロセス
└─────────────────┘
```

### データ保存先

| 用途 | パス |
|---|---|
| SQLite DB | `~/Documents/NNDD-RE/system/library.db` |
| DL動画 | `~/Documents/NNDD-RE/library/Downloads/` |
| 画像キャッシュ (サムネ・アイコン) | `userData/nndd-cache/image/` |
| 映像ストリームキャッシュ | `userData/nndd-cache/movie/` (設定 `cacheRoot` 時は `<cacheRoot>/cache/movie/`) |
| 設定 | `userData/nndd-config.json` (electron-store、`name: 'nndd-config'`) |
| Cookie | `userData/accounts/<ユーザーID>.json` (tough-cookie、アカウント別。旧単一アカウント時代は `userData/cookies.json`) |
| ログ | `userData/log/nndd.log` (超過分は `nndd.log.1` 〜 `.N` へローテート。N は設定の保持世代数、既定3) |

---

## メインプロセス（src/main）

### シングルトン・マネージャー

| クラス | 役割 | 初期化 |
|---|---|---|
| `NicoContext` | ニコニコAPI認証 + HTTP クライアント管理 | `main.ts` (`NicoContext.initialize()`、`get()`はstaticシングルトン) |
| `LibraryManager` | DB + 全 DAO (Video/MyList/History 等) 管理 | `main.ts` (`LibraryManager.createDefault()`) |
| `ConfigStore` | 設定値の永続化 | `main.ts` (`getConfigStore()`) |
| `BackupManager` | GitHub Gist バックアップ/同期 | `main.ts` で `new`（`src/main/githubSync/BackupManager.ts`） |
| `TrayManager` | システムトレイ・メニュー管理 | `main.ts` で `new` |
| `AccountManager` | ニコニコのマルチアカウント管理 (アクティブ ID・切り替え) | `main.ts` (`AccountManager.initialize()`、staticシングルトン) |
| `NnddHttpServer` | 内蔵HTTPサーバー | `main.ts` ではなく `ipc/handlers/http.ts` 内で `new`（`httpServer.enabled` またはヘッドレス時に自動起動、`HTTPD_START` でも起動）。`main.ts` は終了時の `shutdownHttpServer()` のみ参照 |
| `PlayerManager` | プレイヤー BrowserWindow 生成・管理 | staticシングルトン (`PlayerManager.get()`)。実際の起動は `ipc/handlers/video.ts` の `VIDEO_OPEN_PLAYER` ハンドラ、`main.ts` では終了時の `closeAll()` のみ参照 |
| `DownloadManager` | 動画 DL キュー・進捗 emit | `main.ts` ではなく `registerIpc.ts` 内で `new` |
| `ScheduleManager` | スケジューラー定期実行 | `main.ts` ではなく `registerIpc.ts` 内で `new` |
| `UpdateManager` | electron-updater ラッパー | `getUpdateManager()` による遅延取得。`main.ts` は起動時の `checkOnStartup()`、`ipc/handlers/system.ts` の update系ハンドラが `check()` / `download()` / `install()` を呼ぶ |

### ニコニコAPI（src/main/nicovideo）

#### 認証・セッション

- **`AuthManager`**: Cookie 取得 → `NicoContext` へ登録
- **`LoginWindow`**: ブラウザウィンドウでログイン・Cookie 抽出
- **`CookieStore`**: tough-cookie で Cookie 永続化

#### 動画取得・DL

- **`WatchPageParser`**: watch ページの HTML/JSON 抽出 (動画メタ、低レイヤ)
- **`WatchInfoHandler`**: `WatchPageParser` を使いつつ画像キャッシュ差し替え等の上位処理を行うハンドラ。`ipc/handlers/` から呼ばれる実際の取得口はこちら
- **`WatchSession`**: `/v1/watch/{id}/access-rights/hls` で session ID 取得。再生 (ストリーミング) 側は `ipc/handlers/video.ts` の `ensureStreamSession()` 経由で使う。ネイティブDLも `VideoDownloader` からセッション取得に使う
- **`VideoDownloader`** (`src/main/nicovideo/video/VideoDownloader.ts`): **既定の動画DL**。`WatchSession` → `M3U8Parser` → `SegmentDownloader` で HLS セグメントを取得・AES-128 復号し、mux して保存する。yt-dlp・FFmpeg 不要
- **`YtDlpDownloader`**: yt-dlp で bestvideo+bestaudio を取得して mux。`useNativeVideoDownloader` が false のときと、ネイティブ失敗時のフォールバック (下記「動画DLの経路」)
- **`YtDlpStreamer`**: ストリーミングキャッシュ (`userData/nndd-cache/movie` または `<cacheRoot>/cache/movie`) の管理 (パス解決・キャッシュ確認・削除)
- **`M3U8Parser` / `SegmentDownloader` / `Aes128Decryptor`**: ネイティブDL (`VideoDownloader`) と生放送の録画 (`LiveRecorder` / `LiveDownloader`) が使うHLS処理
- **`MediabunnyMuxer`**: 既定の mux (JS 実装、stream copy、ffmpeg 不要)
- **`FFmpegManager`**: `downloadMuxImplementation` が `ffmpeg` のときの mux

### 動画DL・再生とyt-dlp/FFmpegの関係

yt-dlp・FFmpeg は既定では使わない。外部ツールが要るのは設定で yt-dlp / ffmpeg を選んだときだけ。

**動画DLの経路** (`DownloadManager.downloadVideoWithFallback`、`src/main/downloader/DownloadManager.ts`) は設定で決まる:

- 既定 (`useNativeVideoDownloader: true`、`downloadMuxImplementation: 'mediabunny'`): ネイティブDL + mediabunny mux。yt-dlp・FFmpeg 不要。失敗時はエラーをそのまま出す (yt-dlp へはフォールバックしない)
- `downloadMuxImplementation: 'ffmpeg'`: ネイティブでセグメント取得 → FFmpeg で mux。ネイティブが失敗したら yt-dlp にフォールバックする (この場合のみ)
- `useNativeVideoDownloader: false`: 常に yt-dlp (mux は yt-dlp が行い、FFmpeg バイナリを使う)。トラブル時の緊急回避用
- 音声のみ (`isAudioOnly`) はネイティブ必須。`useNativeVideoDownloader: false` だとエラー
- `commentOnly: true` は動画DLをスキップ (コメントのみ)

- **再生** (`VIDEO_GET_STREAM_URL`): `getConfigStore().get('player').streamingMode` (`'native' | 'hls' | 'niconico'`、デフォルト `native`) に応じて分岐。`native`/`hls` はどちらも `ensureStreamSession()` → `WatchSession.ensure()` で HLS URL を取得し、`native` は hls.js が直接、`hls` は `StreamServer`/`HlsProxy` 経由でプロキシ再生。`niconico` は公式プレイヤーの webview 埋め込み。**いずれも yt-dlp・FFmpeg 不要**。既にキャッシュ済みファイル (`YtDlpStreamer.getCachedPath()`) があれば最優先でそれを再生
- **`BinaryInstaller.ts`** (`src/main/util/BinaryInstaller.ts`): yt-dlp/FFmpeg/ffplay のパス解決・バージョン確認・オンデマンドインストールを一元管理。`userData/bin/` に配置。yt-dlpはGitHub Releases本家、ffmpeg/ffplayは `yt-dlp/FFmpeg-Builds` から取得 (Windowsはwinget優先、macOSのffmpeg自動取得は非対応でbrew案内)。バイナリが見つからない場合、`YtDlpDownloader.findExe()` は `ytDlpPath`設定 → `userData/bin/` → PATH上の `yt-dlp` の順にフォールバックし、最終的に見つからなければDL項目が `FAIL` になるだけでアプリはクラッシュしない

#### コメント

- **`CommentClient`**: V3 API でスレッド/コメント取得
- **`CommentXmlReader`**: XML コメントファイル読み込み
- **`CommentCommandParser`**: `@sm12345` `!jikkyou` コマンド解析

#### 検索・ランキング・マイリスト

- **`SearchClient`**: snapshot API v2 / nvapi (`SearchApiMode`、キーワード・タグ検索)
- **`RankingClient`**: ニコニコ動画本体のランキングページの BFF (`/ranking/genre/{featuredKey}?term=…&responseType=json`) を取得。ジャンルは新体系の `featuredKey`、期間は `RankingTerm` (`hour` / `24h` / `week` / `month` / `total`)。急上昇 (`fetchHot`) は nvapi、失敗時のみ RSS にフォールバック
- **`MyListClient`**: nvapi (`/v2/mylists/{id}` 公開マイリスト、`/v1/users/me/mylists` 自分のマイリスト)。取得は `MylistFetcher`、サーバー側プレイリスト同期は `PlaylistServerSync`
- **`FollowFeedClient`**: フォロー情報・ニコレポ取得
- **Pマーク (プレミアム会員向けの動画)**: 動画カードの右上に出す。判定元は watch ページの `payment.video.isPremium` と一致することを実測した一覧側の値で、検索 (nvapi) とランキングは各項目の `acf68865` (難読化されたキー名で、仕様ではないため変わる可能性あり)、検索 (スナップショット) はタグ「プレミアム限定動画（プレミアム）」。同じ「…（お試し）」タグは無料動画に付くので対象外。マイリスト・フォロー・ニコレポの一覧には判定できる値が無く、Pマークは出ない

### DB（src/main/db）

#### スキーマ・クエリ

- **`schema.ts`**: SQL DDL (`CREATE_TABLES`) + `Q` オブジェクト (共通クエリ) + `DB_SCHEMA_VERSION` (現在 `'19'`)
- **`Database.ts`**: better-sqlite3 ラッパー。`migrate(from, to)` が `version` テーブルの値と `DB_SCHEMA_VERSION` を比べて段階的に ALTER / 表の作り直しを行う

#### アカウント別のデータ

マイリスト (`mylist`)・マイリスト入力履歴 (`mylist_history`)・自作プレイリスト (`playlist` / `playlist_sync_dismissed`)・スケジュール (`schedule`)・コメントNG (`ng_list` / `ng_sync_base`)・ニコ動視聴履歴 (`nico_watch_history`) は `account` 列 (ニコニコのユーザーID。未ログインは空文字) を持ち、アカウントごとに分かれる。スキーマ版 18 で `mylist` / `mylist_history` / `playlist` / `playlist_sync_dismissed` / `schedule` に、版 19 で `ng_list` / `nico_watch_history` に追加した (`playlist` 以外は一意制約を `account` 付きに変えるため `Database.rebuildWithAccount` で表を作り直す。`playlist` は `ALTER TABLE` で列だけ足す)。

- DAO の一覧・追加・削除は第1引数に `account` を取る。IPC ハンドラは `AccountManager.key` を渡す。非同期の長い処理 (スケジュール実行、マイリスト一括更新、プレイリストの取り込み) は、開始時点の `account` を控えて渡す。途中で切り替わっても、始めたアカウントの行を更新するため
- `playlist_item` / `playlist_sync_base` は `playlist_id` で結びつくので `account` を持たない。ニコニコ側に触れるプレイリスト操作は、`library.ts` の `assertOwnPlaylist` で今のアカウントのものか確かめる
- バージョン 17 以前 (NG・視聴履歴は 18 以前) のデータは `account=''` になり、最初にログインしたアカウントへ一度だけ引き継ぐ (`registerIpc.ts` の `AccountManager.onActiveChange` → `LibraryManager.adoptUnscopedData`、設定 `accountScopeAdopted` で一回限り。コメントNG・ニコ動視聴履歴は版 19 で後から対象になったため、設定 `accountScopeAdoptedNgHistory` で別に一度だけ引き継ぐ)
- アカウント間の移動・コピーは `LibraryManager.transferAccountData` (DB) と `library.ts` の `ACCOUNT_DATA_TRANSFER` (録画予約は config)。UI は設定 > バックアップ・移行 > アカウントのデータ移動 (`general/AccountDataSection.tsx`)。プレイリストは移動・コピーでニコニコ側との同期を解除する。移動先に同じ URL / 番組 / ID があれば移動先を優先する
- 録画予約 (`liveRecordReservations`) は各予約に `account` を持つ。`LiveRecordScheduler` は今のアカウントの予約だけ実行する
- 切り替えで捨てる基準: `LiveFollowNotifier.seen` と `ChannelWatcher.lastSeenVideoId` はアカウントごとに持つ。renderer は `useAppStore` の `accounts.activeId` を依存にして読み込み直す
- バックアップ (`BackupManager`) は `accounts` (ユーザーID → マイリスト・スケジュール・プレイリスト) を書き出す。形式 1 のアプリでも読めるよう、従来の `myList` / `schedule` / `playlist` に今のアカウント分を重ねて入れる。復元は `accounts` に入っているアカウント分だけを置き換える

#### DAO

| DAO | テーブル | メソッド例 |
|---|---|---|
| `VideoDao` | `NNDDREVideo`, `tagstring`, `NNDDREVideo_tag`, `file` | list, getByKey, insertOrUpdate, setTags, delete |
| `MyListDao` | `mylist` | list(account), upsert(account, …), remove(account, url) |
| `HistoryDao` | `history` | list, add, remove, clear, existsBatch |
| `SearchDao` | `saved_search` | list, upsert, move, remove |
| `ScheduleDao` | `schedule` | list(account), upsert(account, …), remove(account, id) |
| `NgListDao` | `ng_list`, `ng_sync_base`, `ng_tag`, `ng_up` | listComment(account), addComment, removeComment, listTags, listUps |
| `InputHistoryDao` | `search_history`, `mylist_history` | listSearch, addSearch, listMyList(account), addMyList |
| `PlaylistDao` | `playlist`, `playlist_item`, `playlist_sync_base`, `playlist_sync_dismissed` | (自作プレイリスト) |
| `ResumeDao` | `resume_position` | (動画ごとの再生位置) |
| `NicoWatchHistoryDao` | `nico_watch_history` | (ニコニコ本家側の視聴履歴) |

各 DAO は `constructor(db: NnddDatabase)` で依存注入。

### ダウンロード

- **`DownloadManager`** (`EventEmitter`): キュー・進捗 emit
  - `enqueue(opts: EnqueueOptions)` (`videoId`・`commentOnly`・`saveDir` など) でキューに追加
  - `on('change', item)` / `on('changeAll', list)` を購読して `DOWNLOAD_PROGRESS_EVENT` で renderer へ通知
- **`MyListAutoDownloader`** / **`SeriesAutoDownloader`** / **`FollowUserAutoDownloader`**: マイリスト・シリーズ・フォローユーザーの新着を取得 + enqueue
- **`ScheduleManager`**: 曜日・時刻指定のスケジュール実行 (上記3つの自動DLを呼ぶ)
- **`ChannelWatcher`**: チャンネル新着監視 (トレイ通知)

### プレイヤー・カスタムプロトコル

- **`PlayerManager`**: 動画プレイヤー BrowserWindow の生成・管理（既存ウィンドウがあれば再利用して新しい動画パラメータを送る。`hideWatchHistory` が切り替わったときだけ作り直す）
- **`LocalVideoProtocol`**: `nndd-re-local://` の Electron カスタムプロトコルハンドラ (`protocol.handle()`、ローカルファイル再生)。実装されているカスタムプロトコルはこれのみ
- **`StreamServer`**: 通常の Node `http` サーバー (`/hls/proxy` 等)。HLSプロキシ再生 (`streamingMode: 'hls'`) 用
- **`HlsProxy`**: `StreamServer` 上で master/variant m3u8 とセグメントをプロキシするロジック
- **`HlsSessionInterceptor`**: HLSセッション関連のリクエストインターセプト
- **`CommentWindowManager`**: コメント別ウィンドウの管理
- **`LivePlayerManager`** / **`LiveCommentWindowManager`**: 生放送プレイヤー / コメントリスト浮動ウィンドウ (下記「ニコニコ生放送」)
- **`ExternalPlayer`**: 外部プレイヤー起動
- **`src/main/protocol/CmdProtocol.ts`** (`nndd-re-cmd://`): 外部起動用 (ブラウザ拡張等)。`app.setAsDefaultProtocolClient` で登録。`play/videoId` / `download/videoId` / `mylist/mylistId` / `live/programId` / `liveRecord/programId` に対応

### GitHub同期バックアップ (`src/main/githubSync/`)

- **`BackupManager`**: GitHub Gist を使った設定・データのバックアップ/同期。対象は「アプリ設定・NGリスト・マイリスト・スケジュール・保存検索・プレイリスト・視聴履歴」の7項目で、`SyncProfile.dataScope` ごとにON/OFF選択可能。`auth.*`/`developer.*`/`githubSync.*`（機微情報）や `libraryRoot` 等の端末固有パス、`ui.window`（モニタ構成依存）は `SYNCABLE_CONFIG_KEYS` ホワイトリストで除外
- 認証は GitHub Device Flow（`GitHubLoginArea.tsx` がログインUI、`DeviceFlowModal.tsx` がユーザーコード表示・認証待ちUI、進捗は `GITHUB_DEVICE_FLOW_EVENT` で Main→Renderer 通知）
- 複数の「同期プロファイル」（`ProfileList.tsx`、`ProfileEditor.tsx`）を作成でき、プロファイルごとに1つのGistと紐付け・アクティブ切替が可能。既存Gistへの再連携もサポート
- アップロードは手動または起動時・終了時の自動実行（内容ハッシュ比較で無変更時はスキップ）。ダウンロードは常に手動（ローカルデータを対象スコープについて全置換する破壊的操作のため、UI側で確認ダイアログを出す）
- 関連ファイル: `src/main/githubSync/BackupManager.ts`, `src/renderer/components/settings/BackupSettings.tsx`, `src/renderer/components/settings/githubSync/`（`DeviceFlowModal.tsx`, `GitHubLoginArea.tsx`, `ProfileEditor.tsx`, `ProfileList.tsx`）

### LANライブラリ共有

同一LAN上の他の NNDD/NNDD-RE インスタンスとサーバー/クライアントの表裏関係で連携する:

- **サーバー側**: `NnddHttpServer.ts` が `POST /NNDDServer` で本家NNDD互換のXML API (`GET_VIDEO_ID_LIST` 等) を提供 (`httpServer` 設定で有効化)
- **クライアント側**: `src/main/server/LanLibraryClient.ts` が同じXMLプロトコルで他インスタンスに接続 (`remoteNndd` 設定を使用)
- UI は `src/renderer/components/library/LibraryView.tsx` のサイドバーにある「LANライブラリ」(`LAN_FOLDER` を選択した状態) で、本体は `LanLibraryPane.tsx`、取得は `hooks/library/useLanLibrary.ts`。IPCチャンネルは `LAN_STATUS` / `LAN_LIBRARY_LIST` / `LAN_VIDEO_STREAM`
- **注意**: `src/renderer/components/lan/LanLibraryView.tsx` は同機能の初期プロトタイプで、コードベースのどこからも参照されていない孤立コンポーネント（未使用、技術的負債）。実運用は上記の `LibraryView.tsx` + `LanLibraryPane.tsx` なので、新規開発時に誤って `LanLibraryView.tsx` を編集しないよう注意

### ニコニコ生放送 (`src/main/nicovideo/live/`)

放送中・追っかけ再生・タイムシフトの視聴。データの流れ:

```
live.nicovideo.jp/watch/lvXXX の #embedded-data (data-props)
  → site.relive.webSocketUrl (視聴WebSocket)
      送信: startWatching { stream: { quality, protocol:'hls', latency:'low', chasePlay }, room, reconnect }
            keepSeat (seat.keepIntervalSec ごと) / ping への pong
      受信: stream        → HLS の URL + 署名Cookie (stream.cookies)
            messageServer → コメントサーバー (NDGR) の viewUri
            statistics / disconnect / serverTime 等
  → HLS: hls.js で再生 (renderer)
  → コメント: NDGR (protobuf over HTTP) から受信 → niconicomments で描画
```

主なファイル:

- **`LiveWatchPage.ts`**: watchページの解析 (`fetchLiveWatchPage`)、視聴できない理由の判定、タイムシフトの予約→視聴開始 (`activateTimeshift`、視聴期限のカウントが始まるので必ずユーザー確認後に呼ぶ)
- **`LiveSession.ts`**: 1番組分の視聴セッション。WebSocket の維持・再接続・画質変更、NDGR の起動、受信内容を `LiveEvent` として renderer へ送る。タイムシフトかどうかは webSocketUrl が `/timeshift` で終わるかで判定
- **`NdgrClient.ts`**: コメントサーバー (NDGR) のクライアント。放送中の受信 (`start`)、過去コメントの全件取得 (`fetchArchive`)、指定時刻の周辺だけの取得 (`fetchBackwardAround`)
- **`LiveChatConverter.ts`**: NDGR の Chat → `NNDDREComment` (位置・サイズ・色・フォント・184 をコマンド文字列に変換)
- **`LiveListClient.ts`**: 番組一覧 (フォロー中・番組検索・ランキング・カテゴリ別・タイムシフト予約)
- **`LivePoc.ts`**: 視聴フロー・番組一覧APIの調査用 PoC。設定 > デバッグ から番組ID または URL を指定して実行し、結果をログに出す
- **`src/main/player/LivePlayerManager.ts`**: 生放送プレイヤーウィンドウの管理。ウィンドウごとにメモリ上の専用 partition を使い、HLS の署名Cookieを webRequest でリクエストヘッダーへ付与する。同じ番組は1ウィンドウのみ
- **`src/main/player/LiveCommentWindowManager.ts`**: コメントリストの浮動ウィンドウ。コメントのデータはプレイヤー側が持ち、このクラスは中継だけ行う (プレイヤー → snapshot / append / position → 浮動ウィンドウ)

コメントの protobuf 定義は `proto/nicolive/` (`n-air-app/nicolive-comment-protobuf`、MIT。取得元とコミットは同フォルダの README)。`npm run gen:proto` で `src/main/nicovideo/live/gen/` に TypeScript を生成する (`@bufbuild/protobuf` v2 + buf)。生成物は手で編集しない。

過去コメントの取得方法は番組のコメント数で切り替える (`LiveSession` の `FULL_ARCHIVE_LIMIT` = 1万件):

- 1万件以下: 開いたときに全件をバックグラウンドで取得
- 1万件超: 再生位置の周辺だけ取得し、シーク時や取得済み範囲の端に近づいたときに追加で取得

#### 生放送 API の注意点 (調査で分かったこと)

- **NDGR**: `viewUri?at=now` は `ChunkedEntry.next.at` だけを返す。`?at={next.at}` をストリーミングで読むと `segment` / `previous` / `backward` と次の `next` が流れてくる。`at` に過去の unix 秒を渡すと、その時点から遡る `backward` が取れる
- **NDGR の過去コメント**: `backward.segment.uri` の応答は `PackedSegment` 単体 (長さプレフィックス無し)。`next.uri` を辿ると更に古い区間。1ページ約570件
- **HLS の署名Cookie**: `stream.cookies` は CloudFront 署名Cookieがパス別 (playlists / segments/video / segments/audio / keys) に複数来る。URL のパスに合うものだけ送らないと 403。hls.js は withCredentials 無しで取得するため、Chromium の Cookie ストアに入れても送られない → webRequest でヘッダーに付ける
- **番組検索** (`api.cas.nicovideo.jp/v2/search/programs.json`): `X-Frontend-Id: 9` ヘッダー必須、`searchWord` 必須 (空は不可)、`searchTargets` は `keyword` のみ、`limit` は 20 が上限 (超えると `invalid limit`)
- **フォロー中**: 放送中は `/front/api/pages/follow/v1/programs?status=onair`。放送予定はこの API では取れず、`/follow` ページの embedded-data (`followedPrograms.comingsoonProgramListState`) から読む
- **ランキング**: 専用 API は無く、`/ranking?type=onair|comingsoon|closed` (closed は `select_date=YYYYMMDD`) の embedded-data から読む
- **カテゴリ別**: `/front/api/pages/recent/v1/programs?tab=…&offset=…&sortOrder=…`。`offset` は件数ではなくページ番号 (1ページ70件)
- **アニメ生放送** (`LiveAnimeClient.ts`、生放送タブの「アニメ」): 専用 API は無く、`anime.nicovideo.jp/live/` の HTML にある `<script id="tktk-module">` の `window.TKTK['live_reserved' | 'live_past' (+ `_regular` / `_ikkyo` / `_tokuban`)]` から読む。ページは放送予定 (`/live/`, `reserved-*.html`) と見逃し配信 (`past*.html`) に分かれる。項目は `s("…")` / `n('…')` / `b('…')` / `d_s('…')` (JST) の呼び出しの並びで、リモートの JS は実行せず正規表現で読む。見逃し配信の項目には開始時刻が無く、`timeshiftExpired` (視聴期限) と視聴数・コメント数だけ付く。未ログインでも全件読める。会員種別: 一覧データにプレミアムのフラグは無く、「【ニコニコプレミアム限定】」はタイトルの文字列で判断している。サイトの案内では、プレミアム会員は見逃し配信を事前予約なしで視聴でき、一般会員はタイムシフト予約が必要。プレミアム判定は nvapi `/v1/users/me` の `isPremium` を優先し、取れなければ `window.TKTK.user` を見る (ログイン中の `TKTK.user` の形式は未確認)
- **コメント描画**: niconicomments の流れコメントは vpos の1秒前に右端から出現する。生放送コメントの vpos は投稿した瞬間なので、流れコメントは +1秒して渡す。遅れて届いたリアルタイムのコメントは出現位置を「今」に寄せる (接続直後にまとめて届く直前区間の分は寄せない)
- **追っかけ再生はプレミアム会員限定**: watchページの `program.isChasePlayEnabled` は会員種別に関係なく `true` になる。一般会員・未ログインで `chasePlay: true` を送ると、公式番組は `NO_PERMISSION`、チャンネル・ユーザー番組は `NO_STREAM_AVAILABLE` で断られる (`chasePlay: false` なら視聴できる)。`LiveSession` は `user.accountType === 'premium'` のときだけ追っかけ再生で要求し、念のため上記エラー時は通常視聴でつなぎ直す。同種の「フラグは会員種別を反映しない」問題は他機能にも起こりうる → 実装前に `nico-account-diff` スキルを参照
- **低遅延 (LL-HLS) と追っかけ再生の切り替え**: 公式プレイヤーは常に `chasePlay: false` で受信する。このとき HLS は LL-HLS (`TARGETDURATION` 3秒、`PART-TARGET` 0.5秒、`PART-HOLD-BACK` 1秒) で、遅延はライブ端から約1〜2秒になる。`chasePlay: true` だと part の無い6秒セグメントの通常 HLS になり、再生位置の工夫では遅延を詰められない (ブラウザより8秒以上遅れる原因だった)。NNDD-RE は放送中は `chasePlay: false` で始め、巻き戻したいときだけ `changeStream` で `chasePlay: true` に切り替え、「最新」で戻す。公式プレイヤーの「通信モード」(`latency: high | low`) は `chasePlay` に影響せず、どちらも LL-HLS のままだった
- **低遅延の hls.js 設定**: `liveSyncDuration` を指定すると `PART-HOLD-BACK` より優先されて遅延が固定されるので、低遅延では指定しない (追っかけ再生の通常 HLS だけ `liveSyncDuration: 8` に詰める)
- **巻き戻しの切り替え** (`LivePlayerApp.tsx` の `rewindToVpos`): 低遅延中のシークバーは、巻き戻せる範囲が無いので番組開始〜現在の仮のバー (`LiveRewindBar.tsx`) にし、5秒以上前へ操作すると追っかけ再生へ切り替える。切り替え直後の新しい Hls は、いったんライブ端付近から再生を始める。その前にシークすると上書きされてライブ端に戻るので、再生を止めたまま (`holdPlaybackRef`) 開始位置への移動が終わるのを待ってからシークし、再生を始める。待つ間は映像・コメントを隠し、つまみを巻き戻し先に留める
- **遅れ表示**: hls.js はライブ時に最新セグメントより数セグメント手前を再生する。遅れはシーク可能範囲の末尾ではなく `hls.liveSyncPosition` を基準に計算する

#### 放送者の操作・番組状態の表示 (コメントサーバーの state / message)

コメントサーバー (NDGR) からは、コメント以外に放送者の操作や番組の状態も届く。`LiveSession` が `LiveEvent` に変換して renderer へ送る。`NicoliveState` は変わった項目だけが入ってくる。

- **アンケート** (`enquete`): 映像の左下に表示 (`LiveOverlays.tsx` の `EnqueteOverlay`)。投票中は選択肢、結果は得票率のバー。左下のパネルから投票できる (視聴 WebSocket へ `{type:"answerEnquete",data:{answer:選択肢の0始まりindex}}` を送る。サーバーからの応答は無い)。開始と結果はお知らせタブにも残る
- **コメント表示レイアウト** (`comment_mode`): `splitTop` はコメントを映像の上半分だけに流す、`background` はコメントを薄く (不透明度 0.4) 表示する。コメント描画領域 (`overlayRef`) のスタイルを切り替えるだけで、描画エンジンは ResizeObserver で追従する
- **コメント投稿制限** (`comment_lock`): 制限中は映像の右下に表示し、番組情報タブにも出す。コメント投稿の UI はまだ無いので状態の表示のみ
- **タグ更新** (`tag_updated`): 番組情報のタグを差し替える
- **放送者の NG (SSNG)** (`ssng_updated`): ユーザー・ワード・コマンドの追加と削除。削除は id しか届かないので id をキーに renderer のメモリだけで持ち、番組ごとの一時的なものとして扱う (保存しない)。ユーザー自身の NG リストに足して、画面の描画とコメントリスト (浮動ウィンドウ含む) に適用する
- **終了予定** (視聴 WebSocket の `schedule`): 番組情報タブに終了予定時刻と残り時間を出し、延長で値が変わったら追従する
- **移動指示** (`move_order`): 別番組へのジャンプ / URL への移動。映像上部にバナーを出し、お知らせタブにも残す。設定 > 生放送の「放送者の移動指示に自動で従う」が ON のときだけ、待ち時間 (最短 5 秒) の後に自動で移動する (バナーの「中止」で止められる)
- **クリエイターサポート** (`creator_support_goal_status`): 目標名・達成率・達成済みを小さなゲージで映像の右上に出す
- **転送コメント** (`forwarded_chat`): 別番組から転送されたコメント。コメントリストで「転送」の表示を付ける。コラボは画面にも流し、クルーズはリストのみ
- **タイムシフト予約数**: `state.statistics` の `timeshift_reservations`。番組情報とコメントウィンドウのヘッダーに出す

#### ニコ生ゲーム (akashic) とニコ生クルーズ

ニコ生クルーズの「次の行き先を選ぶ投票」と「下部の番組情報 (フォロー星ボタン付き)」は HTML ではなく、**ニコ生ゲーム (akashic) の canvas ゲーム**として描画される。`enquete` / `move_order` は使われない。公式プレイヤーと同じく、公式 CDN のゲームコードをそのまま実行して映像の上に重ねている (クルーズ以外のニコ生ゲームも同じ仕組みで動く見込み)。

**データの流れ**

1. watch ページの embedded-data から `akashic.enabled` と `site.coe.coeContentBaseUrl` を読む (`LiveWatchPage.ts` → `LiveStartResult.akashic`)。ログイン中ならユーザー ID・名前・プレミアムかどうかも渡す
2. 視聴 WebSocket の `akashicMessageServer.viewUri` (mpn) を `AkashicClient` が購読する。形式はコメントサーバーと同じ NDGR で、`NicoliveState.akashic_state` (`epoch` / `join` / `continuation` / `shared`) にゲームの進行イベントが入る。`NdgrClient` の `readSnapshot` で、接続時の状態スナップショット (`backward.snapshot`) も先に読む (途中参加でも進行中のゲームを復元するため)
3. `LiveEvent` の `akashic` で renderer へ送り、`AkashicLayer` が sandbox 付き iframe (`public/akashic/akashic-host.html`。親の CSP を引き継がないよう別文書にしている) の中のホスト (`akashic-host.js`) に postMessage で渡す
4. ホストは公式 CDN のランタイム (`engineFilesV3_13_4_Canvas.js` など) を読み込み、土台のゲーム (`nicocas/5.0.2.0`) を起動する。イベントは `[32, 2, ":akashic", payload]` として注入する。子ゲーム (クルーズなど) は、土台のゲームが `external.coe.startSession` を呼んだときに起動する

**イベントの適用ルール** (ホストの `applyBatch`)

- `epoch` の昇順に適用し、すでに適用した `epoch` 以下は捨てる
- 接続時のスナップショットは `join` + `shared`、以降は `continuation` + `shared` を適用する (`join` は途中参加者向け、`continuation` は参加済みの視聴者向け、`shared` は全員向け)
- 途中参加時は、スナップショットの後に過去分の更新が短時間にまとめて届き、子ゲームが立て続けに入れ替わる。起動中に破棄された子ゲームは起動せずに片付ける

**ホストが用意する plugin** (`external.*`)

- `api`: 投票・フォローの HTTP。iframe → 親 → main (`LIVE_AKASHIC_API`、`AkashicApi.ts`) の順に渡し、ログイン済みの Cookie と `X-Frontend-Id: 9` を付けて送る。宛先は https の `nicovideo.jp` ドメインに限る
  - 投票: `POST {voteBaseURL}/v1/services/cruise/programs/{番組ID}/votes`、body `{"id":"0|1"}`。ゲームは締め切り時に1回だけ送る (選択していなければ送らない)
  - フォロー: `POST {followBaseURL}/v1/slowly/follow/user/followees/{ユーザーID}`。成功は 202
- `send`: `nx:open` だけ処理する (http(s) の URL を開く。生放送の URL ならこのアプリのプレイヤーで開く)
- `nico`: フロントエンド情報・番組・アカウント・視聴状態を返す。`coe`: `startSession` / `exitSession`。`ichiba`・`agvSupplement`・`instanceStorage` は何もしないか、メモリ上だけで動く

**安全面**

- ゲームのコードは外部から読み込んだものなので、preload (`window.nndd`) の無い sandbox 付きの iframe で動かし (本番の file:// は `allow-scripts allow-same-origin`。file:// は 1 ファイルごとに別 origin なので親には届かない。開発サーバーは `allow-scripts` だけ)、ホストの文書自身の CSP でスクリプトの読み込み元を `resource.akashic.coe.nicovideo.jp` に絞る
- 子ゲームの URL も同じ配信元のものだけ実行する (公式の `trustedChildOrigin` と同じ)。iframe 実行を求める untrusted なゲームは対応しない
- ゲーム画面が出ている間 (子ゲームの実行中) だけ iframe がマウスを受け取り、それ以外は映像の操作を邪魔しない

**クルーズの仕様 (公式の採取結果、約72秒周期)**

- 投票画面 (「次の行き先を選んでください」→ 締め切りまで5秒のカウントダウン → 結果) → 番組情報パネル (約30秒) の繰り返し。選択肢は2つの番組で、番組のタグが並ぶだけ。結果は整数の %
- 投票・フォローはログインが必要 (未ログインはサーバーが拒否する)
- 土台の `nicocas` の版 (5.0.2.0) は公式 (usecase) も固定値で使っている。公式が更新したら `akashic/akashic-host.js` の `NICOCAS_VERSION` を追従させる

**未確認・未対応**

- ログイン状態での投票・フォローの実送信 (応答の形式、`X-Frontend-Id` 以外のヘッダの要否)
- タイムシフト視聴では表示しない (進行を再現できないため)
- ゲーム側の `platform` (alert など)・`ichiba`・非 local セッション (playlog サーバが必要) は未対応
- 音量は映像の `volume` / `muted` に連動 (公式と同じく最大 0.4 倍)

#### タイムシフト予約と通知

- 番組一覧の各カードに「TS予約」、タイムシフト予約一覧に「予約解除」のボタンがある。予約は `POST /api/v2/programs/{id}/timeshift/reservation` (視聴開始はしない)、解除は `DELETE /api/v2/timeshift/reservations?programIds=lv…` (いずれも live2.nicovideo.jp)。エラーコードは `LiveWatchPage.ts` の `TIMESHIFT_ERROR_MESSAGES` で日本語の文面にする
- フォロー中の放送者の番組開始通知 (`LiveFollowNotifier.ts`): 設定 > 生放送 > 通知で ON にすると、フォロー中 (放送中) の一覧を指定間隔で取得し、前回なかった番組を OS 通知する。最初の取得と未ログイン中は通知しない。一覧は先頭から 2 ページ分 (2 回目は取得済みの件数を `offset` に指定) まで見る。2 ページ目までで取りきれない分は見えない。どちらかの取得に失敗した回は前回の状態を保ち、通知しない。通知クリックで生放送プレイヤーを開く

#### NCV 連携 (起動)

設定 > 外部ツール・連携 > 外部ツール > NCV (`ExternalToolsSettings.tsx`、`live.ncvEnabled` / `live.ncvPath`) が ON のとき、生放送を開くと `LivePlayerManager.launchNcv` が NCV を起動する。起動は視聴開始後 (`startSession`、タイムシフトかどうかが分かってから) に決め、`live.ncvLaunchDelaySec` 秒 (既定 3、0 で即時) 待ってから行う。タイムシフトは `live.ncvTimeshift` (既定 ON) が OFF なら起動せず、コメントリストも通常の表示方式になる。起動したかは `LiveStartResult.ncvLaunched` で renderer に返し、プレイヤーの URL の `ncv=pending` (RE から起動予定) / `ncv=linked` (NCV から呼ばれた) と合わせてコメントリスト表示を決める。

#### 実機で未確認の点

実際のレスポンスで確かめられていないため、動作確認のときはログ (`LiveSession` / `LiveWatchPage` / `LiveListClient`) を見ること。

- `schedule` の時刻の形式 (ISO 文字列 / 秒 / ミリ秒のどれでも読めるようにしてあるが、実データは未確認)
- `move_order` と `ssng_updated` の中身 (生データをログに出している。SSNG の種別対応は USER → ユーザーID、COMMAND → コマンド、WORD → ワード)
- タイムシフト予約の解除 API の応答形式、一般会員での予約件数制限などのエラーコード (`nico-account-diff` のとおり会員種別による差は未検証)
- タイムシフト予約一覧の `timeshiftSetting` (`status` / `watchLimit` / `endTime`) と `timeshiftTicket.expireTimeMs` の読み方は、プレミアム会員の実通信 (HAR) で確認済み。一般会員での値は未検証 (カードの視聴可否・期限表示は `LiveView.tsx` の `timeshiftStatusOf`。公式の一覧ページの判定を移植したもの)

### 会員種別による機能差

出典: https://premium.nicovideo.jp/payment/premium_detail (公式マーケティングページの要約。**数値は変動するため実装の根拠にはせず、必ず実機で会員種別を分けて検証すること**)

#### ニコニコ動画

| 機能 | 一般会員 | プレミアム会員 |
|---|---|---|
| 最高画質 | 制限あり | 1080p |
| 動画広告 | 表示 | 非表示 |
| バックグラウンド再生 | 非対応 | 対応 |
| サムネイルシーク (シークバーのプレビュー) | 非対応 | 対応 |
| レジューム再生 (続きから再生) | 非対応 | 対応 |
| プレミアム限定動画 | 視聴不可 | 視聴可能 |
| あとで見る / マイリスト登録数 | 少ない (100件等) | 大幅に多い |
| 視聴履歴保持期間 | 短い (30日) | 長い (180日) |
| 同時視聴タブ数 | 制限あり (3タブ) | 無制限 |
| 再生速度上限 | 1.25倍 | 2.0倍 |
| Picture-in-Picture | 非対応 | 対応 |
| 音声のみ再生 | 非対応 | 対応 |

#### ニコニコ生放送

| 機能 | 一般会員 | プレミアム会員 | 備考 |
|---|---|---|---|
| **追っかけ再生 (chasePlay)** | **非対応** | 対応 | **実機で確定済み** (2026-09-27、`account: standard/non` で `chasePlay: true` → `NO_PERMISSION`/`NO_STREAM_AVAILABLE`)。フラグ `isChasePlayEnabled` は会員種別に関係なく `true` |
| 視聴優先度 (満員時) | 入場規制あり | 優先入場 | 未検証 |
| 配信画質上限 | 低い | 高い | 未検証。画質リストは `startWatching` の応答 `availableQualities` で実際に確認するのが確実 |
| タイムシフト予約 | 要予約・件数制限あり | 予約不要な番組が広い・件数制限緩い | 未検証。`activateTimeshift` (予約→視聴開始) は会員種別を問わず呼べる想定だが、番組側の制限は別途あり得る |
| コメント表示色数・位置 | 制限あり | 拡張 | 未検証 |
| 再生速度上限 | 1.25倍 | 2.0倍 | タイムシフト再生時。未検証 |

「未検証」の項目は、この表の記載のみを信じて実装しない。前回と同じ事故になる。

### その他

- **`NnddHttpServer`**: Express サーバー (内蔵, `/api/library`, `/api/mylist`, `/api/video/:id/*`, `/library`, `POST /NNDDServer` 等)。Tailscale 公開は `src/main/server/tailscale/`
- **`TrayManager`**: システムトレイ・メニュー管理
- **`UpdateManager`**: electron-updater
- **`LogFormat.ts`**: ログ引数の整形。printf 形式 (`%s %d …`) に対応するが `util.format` は使わない (オブジェクトが inspect 形式になりマスクが効かなくなるため)
- **`RendererConsole.ts`**: レンダラーの console を main のログへ転送 (`console-message` の details 形式、debug は `log.verbose`)。新しいウィンドウでは直接 `console-message` を購読せずこれを使う
- **`Logger`**: ログファイル出力 (`userData/log/nndd.log`)。ファイルには生のまま書く (マスクしない)。起動ごとに `[INFO][Session] ===== session start =====` の目印行を `markSessionStart()` で書く (single instance lock 取得後。ログクリア時にも書き直す)
- **開発者へのログ送信** (設定 > ログ > 「開発者に送信」): `LogExtract.ts` (起動単位・日時での切り出し、electron 非依存) → `LogMask.ts` (送信時だけ Cookie・トークン・ユーザーID・メールなどを `***` に、ファイル/フォルダのパス (Windows・UNC・主要な POSIX ルート) を拡張子だけ残して `<path>` に) → `maskOptional` (UI のチェックで選ぶ追加マスク: 動画ID・タイトル・サムネ / チャンネルID・名前 / マイリスト・シリーズ・予約の名前。ログの定型書式のみ対象。会員種別 `premium=` はデバッグに必須なのでマスクしない。マスクは**エントリ単位**に掛ける: 「エントリ末尾まで伏せる」規則があるため) → `LogExport.ts` (プレビューを main が保持し、`LOG_EXPORT_SEND` は previewId だけ受けて gzip 送信)。送信先 `LOG_UPLOAD_URL` は `LogExport.ts` の定数で、受け口は別リポジトリ `NNDD-RE_cfworker` (Cloudflare Workers + R2)。URL が空だと送信はエラーになる。IPC は `LOG_EXPORT_PREVIEW` / `LOG_EXPORT_SEND` / `LOG_EXPORT_HISTORY` / `LOG_EXPORT_DELETE`。送信すると Worker が削除トークンを返し、`LogExportHistory.ts` が `userData/log-uploads.json` (ConfigStore には入れない: GitHub 同期で流れるため) に保存する。renderer にはトークンを渡さず、削除は id だけを受けて main がトークンを引く。30日超の履歴は読み込み時に間引く。`LOG_EXPORT_SYNC` (`syncLogExportHistory`) が `POST /upload/check` に履歴のトークンを送り、web 側で消された分・期限切れの分を履歴から外す (通信できないときは何もしない)
- **`LibraryScanner`**: ライブラリディレクトリをスキャン・DB 同期
- **`DiscordRpcManager`** (`src/main/discord/`): Discord Rich Presence
- **`WebhookNotifier`** (`src/main/notification/`): Webhook 通知
- **`HonkeImporter`** (`src/main/import/`): 本家 NNDD のデータ取り込み
- **`Telemetry`** (`src/main/telemetry/`): 利用状況の送信 (同意制)
- **`CmdProtocol`**: 上記「プレイヤー・カスタムプロトコル」参照
- **`BinaryInstaller`** (`src/main/util/BinaryInstaller.ts`): yt-dlp/FFmpeg/ffplay のパス管理・オンデマンドインストール (`userData/bin/`)

---

## IPC チャンネル（src/shared/types/ipc.ts）

`IpcChannel` は `enum` ではなく `export const IpcChannel = {...}` というオブジェクトリテラルで全チャンネルをホワイトリスト管理。キーは `LIBRARY_LIST` のようなSCREAMING_SNAKE_CASE、値は必ず `'nndd:namespace:action'` 形式。使用例（実在するチャンネル名で記載）：

### 認証・設定

| チャンネル | 説明 |
|---|---|
| `AUTH_OPEN_LOGIN_WINDOW` | ブラウザログイン |
| `AUTH_LOGIN_FORM` / `AUTH_LOGIN_MFA` / `AUTH_LOGIN_WITH_SAVED` | フォームログイン / 二要素認証 / 保存パスワードでのログイン |
| `AUTH_LOGOUT` | ログアウト |
| `AUTH_STATUS` | ログイン状態取得 |
| `CONFIG_GET` / `CONFIG_SET` / `CONFIG_GET_ALL` | 設定取得・保存・全件取得 |

### ダウンロード

| チャンネル | 説明 |
|---|---|
| `DOWNLOAD_ENQUEUE` | DL キューに追加 |
| `DOWNLOAD_CANCEL` | DL キャンセル |
| `DOWNLOAD_LIST` | キュー一覧 |
| `DOWNLOAD_PAUSE` / `DOWNLOAD_RESUME` / `DOWNLOAD_RETRY` / `DOWNLOAD_REMOVE` / `DOWNLOAD_CLEAR_COMPLETED` | 一時停止・再開・再試行・削除・完了分クリア (`*_ALL` の一括版あり) |
| `DOWNLOAD_PROGRESS_EVENT` | 進捗通知 (Main→Renderer) |

### ライブラリ

| チャンネル | 説明 |
|---|---|
| `LIBRARY_LIST` | 全動画一覧 |
| `LIBRARY_GET` | 個別動画取得 |
| `LIBRARY_DELETE` | 削除 |
| `LIBRARY_CHECK_BATCH` | DL済み一括確認 (VideoCardの緑ボタン表示に使用) |

### 検索・ランキング・マイリスト・プレイヤー

| チャンネル | 説明 |
|---|---|
| `SEARCH_EXECUTE` | 検索実行 |
| `RANKING_FETCH` | ランキング取得 |
| `MYLIST_LIST` / `MYLIST_GET` | マイリスト一覧 / 個別取得 |
| `MYLIST_RENEW` | マイリストの新着を再取得 |
| `MYLIST_AUTO_DOWNLOAD_ALL` | 全マイリストの新着を自動DL |
| `VIDEO_GET_WATCH_INFO` | watch ページ情報取得 |
| `VIDEO_OPEN_PLAYER` | プレイヤーウィンドウで再生 |
| `VIDEO_GET_STREAM_URL` | ストリーミングURL取得 (`player.streamingMode` に応じて分岐) |
| `VIDEO_GET_COMMENTS` | コメント取得 |

### GitHub同期・バックアップ

| チャンネル | 説明 |
|---|---|
| `GITHUB_STATUS` / `GITHUB_START_DEVICE_FLOW` / `GITHUB_DEVICE_FLOW_EVENT` / `GITHUB_CANCEL_DEVICE_FLOW` / `GITHUB_LOGOUT` | GitHub Device Flow ログイン・状態確認 |
| `BACKUP_LIST_PROFILES` / `BACKUP_ADD_PROFILE` / `BACKUP_UPDATE_PROFILE` / `BACKUP_REMOVE_PROFILE` / `BACKUP_SET_ACTIVE_PROFILE` | 同期プロファイルのCRUD・切替 |
| `BACKUP_LINK_EXISTING_GIST` / `BACKUP_LIST_CANDIDATE_GISTS` | 既存Gistへの再連携 |
| `BACKUP_LIST_REVISIONS` / `BACKUP_RESTORE_REVISION` | Gist のリビジョン一覧・復元 |
| `BACKUP_UPLOAD` / `BACKUP_DOWNLOAD` / `BACKUP_PREVIEW` | アップロード・ダウンロード（破壊的、要確認）・プレビュー |

### LANライブラリ

| チャンネル | 説明 |
|---|---|
| `LAN_STATUS` | リモートNNDD/NNDD-REへの疎通確認 |
| `LAN_LIBRARY_LIST` | リモートライブラリ一覧取得 |
| `LAN_VIDEO_STREAM` | リモート動画のストリームURL取得 |

### 生放送

| チャンネル | 説明 |
|---|---|
| `LIVE_OPEN_PLAYER` | 生放送プレイヤーを開く (番組ID / URL) |
| `LIVE_START` / `LIVE_STOP` | プレイヤーからの視聴開始・終了 (開始時に `LiveStartResult` を返す) |
| `LIVE_EVENT` | main → プレイヤーへのイベント (`LiveEvent`: ストリーム・コメント・統計・状態など) |
| `LIVE_CHANGE_QUALITY` | 画質変更 |
| `LIVE_TIMESHIFT_ACTIVATE` | タイムシフトの予約 → 視聴開始 (ユーザー確認後のみ) |
| `LIVE_TIMESHIFT_RESERVE` / `LIVE_TIMESHIFT_CANCEL` | タイムシフト予約 (視聴開始しない) / 予約解除 |
| `LIVE_SET_CHASE_PLAY` / `LIVE_ANSWER_ENQUETE` | 追っかけ再生の切り替え / アンケート投票 |
| `LIVE_RECORD_ASK` / `LIVE_RECORD_RESERVE` / `LIVE_RECORD_UNRESERVE` / `LIVE_RECORD_RESERVATIONS` | 生放送の録画 (確認・予約・解除・一覧) |
| `LIVE_AKASHIC_API` | ニコ生ゲームの投票・フォロー HTTP を main 経由で実行 |
| `LIVE_FETCH_COMMENTS_AROUND` | 再生位置の周辺のコメントを取得 (コメント数が多い番組) |
| `LIVE_LIST_FOLLOWING` / `LIVE_SEARCH` / `LIVE_RANKING` / `LIVE_RECENT` / `LIVE_ANIME` / `LIVE_LIST_TIMESHIFT_RESERVATIONS` | 番組一覧 |
| `LIVE_COMMENT_WINDOW_*` | コメントリストの浮動ウィンドウの開閉・中継 |
| `NAV_LIVE_SEARCH` | プレイヤーのタグから生放送タブで番組検索 |
| `LIVE_POC_RUN` | 調査用 PoC の実行 (デバッグ設定) |

---

## Preload（src/preload/index.ts）

`window.nndd` 経由で IPC API 公開：

```typescript
// レンダラー側での使用
await window.nndd.invoke<Video[]>(
  window.nndd.channels.LIBRARY_LIST,
  { limit: 20, offset: 0 }
);

// リスナー登録
window.nndd.on(
  window.nndd.channels.DOWNLOAD_PROGRESS_EVENT,
  (evt, data) => { /* handle */ }
);
```

---

## レンダラー（src/renderer）

### メインウィンドウ（App.tsx）

10 タブ構成（`useAppStore.ts` の `MAIN_TABS` で定義。ランキング・検索・フォロー中・生放送・マイリスト・DLリスト・ライブラリ・履歴・統計・設定）。主なもの：

1. **ランキング** (`components/ranking/RankingView.tsx`)
   - 17 ジャンル × 5 期間
   - Zustand: `pendingMylistId` (マイリスト詳細へのナビ)

2. **検索** (`components/search/SearchView.tsx`)
   - キーワード / タグ検索
   - ページネーション

3. **マイリスト** (`components/mylist/MyListView.tsx`)
   - 登録マイリスト一覧
   - マイリスト内動画

4. **フォロー** (`components/follow/FollowView.tsx`)
   - フォローチャンネル・ユーザーの新着

- **生放送** (`components/live/LiveView.tsx`)
   - 番組ID・URL の直接入力、フォロー中 (放送中 / 放送予定)・ランキング・カテゴリ・検索・タイムシフト予約の一覧
   - 一覧の並びは動画一覧と同じ `VirtualizedItemList`

5. **DLリスト** (`components/download/DownloadView.tsx`)
   - キュー・進捗表示

6. **ライブラリ** (`components/library/LibraryView.tsx`)
   - ダウンロード済み動画
   - 検索・フィルター
   - 「LANライブラリ」（`LAN_STATUS`/`LAN_LIBRARY_LIST`/`LAN_VIDEO_STREAM` を利用、リモートNNDD/NNDD-RE参照）はサイドバー選択で `LanLibraryPane.tsx` を表示

7. **履歴** (`components/history/HistoryView.tsx`)
   - 視聴履歴

- **統計** (`components/stats/StatsView.tsx`)

8. **設定** (`components/settings/SettingsView.tsx`)
   - 13サブタブ（下記参照）

### コンポーネント

#### common

- **`VideoCard.tsx`**: 動画カード (DL済みバッジ・再生ボタン)
- **`TitleBar.tsx`**: ウィンドウタイトルバー
- **`StatusBar.tsx`**: 下部ステータスバー
- **`LoginModal.tsx`**: ログイン モーダル
- **`LoginArea.tsx`**: ログイン状態表示エリア
- **`VirtualizedItemList.tsx`**: 仮想スクロールの一覧 (`@tanstack/react-virtual`)
- **`OpenVideoDialog.tsx`** / **`MaintenanceBanner.tsx`** / **`ErrorNotice.tsx`**: 動画ID・URL・ローカルファイルを開くダイアログ / メンテナンス告知 / エラー表示
- **`AddToPlaylistMenuItem.tsx`**: プレイリスト追加メニュー項目
- **`ContinuousPlayButton.tsx`**: 連続再生ボタン
- **`Placeholder.tsx`**: 空状態プレースホルダー

#### player

- **`VideoPlayer.tsx`**: hls.js + canvas オーバーレイ
- **`CommentOverlay.tsx`**: コメント描画 (Canvas)
- **`CommentRenderer.ts`**: `@xpadev-net/niconicomments` をラップしたコメント描画
- **`CommentList.tsx`**: コメント一覧表示
- **`VideoController.tsx`**: 再生制御（再生/一時停止・音量・画質・倍速）
- **`VideoInfoView.tsx`**: 動画情報（タイトル・説明・統計）
- **`NgListDialog.tsx`**: NGリスト管理ダイアログ
- **`LiveRewindBar.tsx`**: 生放送の仮シークバー

#### 生放送 (別エントリ)

- **`LivePlayerApp.tsx`** (`live-player.html`): 生放送プレイヤー。レイアウト・操作バー・コメントリストは通常プレイヤーと共通 (`VideoController` の `live` などのオプション、`CommentList`)。`CommentRenderer` は `addComments` / `setVposProvider` で生放送用に使う
- **`LiveCommentApp.tsx`** (`live-comment.html`): コメントリストの浮動ウィンドウ。通常プレイヤーの `CommentApp` と同じ見た目

#### settings

`SettingsView.tsx` の `SUBTABS` は12個 + 開発者モード限定の「デバッグ」で計13サブタブ。各サブタブの中身:

- **`SettingsView.tsx`**: 設定ハブ
- 全般 (`GeneralSettings.tsx`): ログイン・ライブラリルート・トレイ/ウィンドウ・プライバシー・開発者モード (`general/` 配下の各 Section)
- 表示・検索 (`NicoSettings.tsx`): 起動時タブ・テーマなど
- ダウンロード (`LibrarySettings.tsx` の `DownloadSettings` + `ScheduleSettings.tsx` を `SettingsTabs` で束ねる)
- ライブラリ (`LibrarySettings.tsx` の `LibrarySettings`)
- プレイヤー (`PlayerSettings.tsx`)
- 生放送 (`LiveSettings.tsx`)
- NGコメント (`NgCommentSettings.tsx`)
- 外部ツール・連携 (`IntegrationSettings.tsx`): 外部ツール (`ExternalToolsSettings.tsx`: yt-dlp/FFmpeg/ffplayの検出状態・パス指定・オンデマンドインストール、外部プレイヤー、NCV)・通知/連携 (Discord Rich Presence / Webhook / チャンネル新着監視)・サーバー/LAN (`general/HttpServerSection.tsx`、`TailscaleSidecarSection.tsx`、`general/LanLibrarySection.tsx`)
- バックアップ・移行 (`BackupSettings.tsx`): GitHub Gistバックアップ/同期 (`githubSync/` のコンポーネントを利用)・`HonkeImportSettings.tsx` (本家NNDDからの取り込み)・`general/AccountDataSection.tsx`
- 情報・更新 (`UpdateSettings.tsx`): バージョン・更新チェック・`TelemetrySettings.tsx`
- 接続診断 (`ConnectionDiagnostics.tsx`)
- ログ (`LogViewer.tsx`)
- デバッグ (`DebugSettings.tsx`、開発者モード限定)
- **`settings/githubSync/`**: `DeviceFlowModal.tsx`, `GitHubLoginArea.tsx`, `ProfileEditor.tsx`, `ProfileList.tsx`, `RevisionHistoryModal.tsx`（`BackupSettings.tsx`からimport）

#### その他

各タブの View コンポーネントが `useAppStore`, `useConfig` フック経由で状態・設定を取得。

### Hooks

- **`useConfig.ts`**: `ConfigStore` キャッシュ + setter
- **`useKeyboardShortcuts.ts`**: プレイヤーのキーバインド管理
- `hooks/library/` / `hooks/live/` / `hooks/mylist/` / `hooks/player/`: 画面ごとの個別フック (例: `useLanLibrary.ts`、`useLiveHls.ts`)

### Store（Zustand）

**`useAppStore.ts`** が全アプリ状態を管理：

```typescript
type AppStore = {
  activeTab: MainTab;
  isLoggedIn: boolean;
  accounts: AccountsState;       // 登録済みアカウントとアクティブID
  pendingMylistId: string | null;  // マイリスト詳細へのナビ用
  pendingSeriesId: string | null;  // シリーズ詳細へのナビ用
  ...
}
```

---

## よくある開発タスク

### 1. 新しい IPC チャンネルを追加

1. `src/shared/types/ipc.ts` の `IpcChannel` オブジェクトリテラルに追加
   ```typescript
   export const IpcChannel = {
     // 既存...
     MY_NEW_CHANNEL: 'nndd:namespace:action',
   } as const;
   ```

2. `src/main/ipc/handlers/` の該当ドメインのファイル (`registerIpc.ts` から各 `register*Handlers` が呼ばれる) に handler 登録
   ```typescript
   ipcMain.handle(IpcChannel.MY_NEW_CHANNEL, async (event, args) => {
     return await myFunction(args);
   });
   ```

3. レンダラーから呼び出し
   ```typescript
   const result = await window.nndd.invoke(
     window.nndd.channels.MY_NEW_CHANNEL,
     { /* args */ }
   );
   ```

### 2. 新しい API エンドポイント（ニコニコ）を追加

1. `src/main/nicovideo/` に新 client クラスを作成 or 既存クラスに追加
2. `NicoContext.get().http` で HTTP リクエスト
3. API レスポンスを型定義 (`src/shared/types/` に追加)
4. IPC handler で呼び出し

例：
```typescript
// src/main/nicovideo/example/ExampleClient.ts
export class ExampleClient {
  constructor(private http: NicoHttp) {}
  
  async getExample(id: string): Promise<ExampleData> {
    const res = await this.http.get<ExampleResponse>(
      'https://api.nicovideo.jp/v2/example',
      { params: { id } }
    );
    return this.parseResponse(res);
  }
}

// src/main/ipc/handlers/<domain>.ts
ipcMain.handle(IpcChannel.EXAMPLE_GET, async (event, id) => {
  const client = new ExampleClient(NicoContext.get().http);
  return await client.getExample(id);
});
```

### 3. DB に新しいテーブル・DAO を追加

1. `src/main/db/schema.ts` に DDL を追加
   ```typescript
   const CREATE_TABLE_EXAMPLE = `
     CREATE TABLE IF NOT EXISTS examples (
       id TEXT PRIMARY KEY,
       name TEXT NOT NULL,
       created_at DATETIME DEFAULT CURRENT_TIMESTAMP
     )
   `;
   ```

2. `DB_SCHEMA_VERSION` を上げ、`Database.ts` の `migrate()` に旧版からの変更を追加
3. DAO クラスを `src/main/db/dao/` に作成し `dao/index.ts` で export
4. `LibraryManager` でインスタンス化 (`readonly xxxDao` として公開)

### 4. 新しいレンダラーコンポーネント

1. `src/renderer/components/{category}/{ComponentName}.tsx` を作成
2. タブなら App.tsx に import ・ mount
3. IPC call は `window.nndd.invoke(...)` で非同期実行
4. 状態は `useAppStore` / `useConfig` フック経由、または React local state

### 5. 型チェック

```bash
npm run tc:all      # node + web 両方
npm run tc          # node側のみ
npm run tc:web      # web側のみ
```

### 6. 既知の型エラーをスキップ

既知の型エラーリストは無い。`npm run tc:all` のエラーは基準 0 (CLAUDE.md「型エラーの基準」) なので、出たら自分の変更を疑う。

---

## デバッグ・トラブルシューティング

### ログを見る

```bash
# リアルタイムログ (stdout)
npm run dev

# ログファイル
<userData>/log/nndd.log
```

### DevTools を開く

Electron DevTools: `Ctrl+Shift+I`（メインウィンドウ）

### better-sqlite3 ビルドエラー

```bash
npm ci  # 依存を入れ直す (package.json に rebuild スクリプトは無い)
```

### IPC 呼び出しがタイムアウト

- レンダラー側で `window.nndd.channels.XXX` が定義されているか確認
- メインプロセスで `ipcMain.handle(...)` が登録されているか確認

### 動画が再生できない

- 接続診断（設定 > 接続診断）を実行
- Cookie 再ログインを試す
- `<userData>/log/nndd.log` (設定 > ログ でも閲覧可) を確認

### 動画がダウンロードできない

- 既定の設定ではダウンロードに yt-dlp / FFmpeg は不要。失敗時のエラー内容を確認する (ネイティブDLはフォールバックしない)
- yt-dlp / FFmpeg を使う設定 (`useNativeVideoDownloader: false` または `downloadMuxImplementation: 'ffmpeg'`) の場合は、設定 > 外部ツール・連携 で検出されているか確認する（本ドキュメントの「動画DL・再生とyt-dlp/FFmpegの関係」参照）
- `YtDlpDownloader.findExe()` は `ytDlpPath` 設定 → `userData/bin/` → PATH の順で探索するため、パス指定が誤っていないか確認

---

## リソース

- **CLAUDE.md**: プロジェクトクイック操作 (`.gitignore` 対象でリポジトリには含まれない)
- **README.md**: ユーザー向けドキュメント
- **src/shared/types/**: 全型定義
- **src/main/nicovideo**: ニコニコ API クライアント
- **オリジナル**: `../NNDD-master/` (AS3 実装参考)
