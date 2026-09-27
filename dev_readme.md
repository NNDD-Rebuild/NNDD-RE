# NNDD-RE 開発ガイド

TypeScript + React + Electron でニコニコ動画をダウンロード・再生するアプリケーション。このガイドは新機能追加・バグ修正時の指針。

## クイックスタート

```bash
npm install
npm run dev          # 開発実行 (main + renderer HMR)
npm run tc:all      # 型チェック (node + web 両方)
npm run build       # プロダクションビルド
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
| キャッシュ | `userData/cache/` |
| 設定 | `userData/config.json` (Electron ConfigStore) |
| Cookie | `userData/session/` (tough-cookie) |

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
| `NnddHttpServer` | 内蔵HTTPサーバー | `main.ts` で `httpServer.enabled` 時のみ `new` |
| `PlayerManager` | プレイヤー BrowserWindow 生成・管理 | staticシングルトン (`PlayerManager.get()`)。実際の起動は `registerIpc.ts` の `VIDEO_OPEN_PLAYER` ハンドラ、`main.ts` では終了時の `closeAll()` のみ参照 |
| `DownloadManager` | 動画 DL キュー・進捗 emit | `main.ts` ではなく `registerIpc.ts` 内で `new` |
| `ScheduleManager` | スケジューラー定期実行 | `main.ts` ではなく `registerIpc.ts` 内で `new` |
| `UpdateManager` | electron-updater ラッパー | `main.ts` では未使用。`registerIpc.ts` の update系ハンドラで `getUpdateManager()` により遅延取得 |

### ニコニコAPI（src/main/nicovideo）

#### 認証・セッション

- **`AuthManager`**: Cookie 取得 → `NicoContext` へ登録
- **`LoginWindow`**: ブラウザウィンドウでログイン・Cookie 抽出
- **`CookieStore`**: tough-cookie で Cookie 永続化

#### 動画取得・DL

- **`WatchPageParser`**: watch ページの HTML/JSON 抽出 (動画メタ、低レイヤ)
- **`WatchInfoHandler`**: `WatchPageParser` を使いつつ画像キャッシュ差し替え等の上位処理を行うハンドラ。`registerIpc.ts` から呼ばれる実際の取得口はこちら
- **`WatchSession`**: `/v1/watch/{id}/access-rights/hls` で session ID 取得。**再生 (ストリーミング) 専用**に使われる (`ensureStreamSession()` 経由)
- **`YtDlpDownloader`**: **実際の動画ダウンロードで使われている唯一の経路**。`DownloadManager.runItem()` から直接呼ばれ、yt-dlp で bestvideo+bestaudio を取得しmux
- **`YtDlpStreamer`**: ストリーミングキャッシュ (`userData/nndd-cache/movie` または `<cacheRoot>/cache/movie`) の管理 (パス解決・キャッシュ確認・削除)
- **`M3U8Parser` / `SegmentDownloader` / `Aes128Decryptor` / `FFmpegManager` / `VideoDownloader.ts`**: 独自にHLSセグメントをDL・AES-128復号・FFmpegでmuxする自前パイプライン。**現在どこからも呼ばれていない未使用コード** (`nicovideo/index.ts` から re-export されているだけ)。README/CLAUDE.md に残る「WatchSession→M3U8Parser→SegmentDownloader→FFmpegManager」という説明はこの未使用実装を指しており、実際のDL処理とは異なるので注意

### 動画DL・再生とyt-dlp/FFmpegの関係

再生とダウンロードで必要な外部ツールが異なる。実装未確認のままREADMEを書くと上記の「未使用パイプライン」を実処理と誤解しやすいので要注意。

- **ダウンロード** (`DOWNLOAD_ENQUEUE`、`commentOnly: false`): `DownloadManager.ts:265` 付近で `YtDlpDownloader.download()` を直接呼び出す。yt-dlp が `--format bestvideo+bestaudio --merge-output-format mp4` でDLし、mux時にffmpegバイナリを外部プロセスとして必要とする（`userData/bin/` に yt-dlp と同居させることで yt-dlp が自動検出）。**yt-dlp・FFmpeg 両方が事実上必須**。`commentOnly: true` の場合はこのステップ自体スキップ
- **再生** (`VIDEO_GET_STREAM_URL`): `getConfigStore().get('player').streamingMode` (`'native' | 'hls' | 'niconico'`、デフォルト `native`) に応じて分岐。`native`/`hls` はどちらも `ensureStreamSession()` → `WatchSession.ensure()` で HLS URL を取得し、`native` は hls.js が直接、`hls` は `StreamServer`/`HlsProxy` 経由でプロキシ再生。`niconico` は公式プレイヤーの webview 埋め込み。**いずれも yt-dlp・FFmpeg 不要**。既にキャッシュ済みファイル (`YtDlpStreamer.getCachedPath()`) があれば最優先でそれを再生
- **`BinaryInstaller.ts`** (`src/main/util/BinaryInstaller.ts`): yt-dlp/FFmpeg/ffplay のパス解決・バージョン確認・オンデマンドインストールを一元管理。`userData/bin/` に配置。yt-dlpはGitHub Releases本家、ffmpeg/ffplayは `yt-dlp/FFmpeg-Builds` から取得 (Windowsはwinget優先、macOSのffmpeg自動取得は非対応でbrew案内)。バイナリが見つからない場合、`YtDlpDownloader.findExe()` は `ytDlpPath`設定 → `userData/bin/` → PATH上の `yt-dlp` の順にフォールバックし、最終的に見つからなければDL項目が `FAIL` になるだけでアプリはクラッシュしない
- **`StreamProtocol.ts`** の `spawnMergeDownload()` (yt-dlp+ffmpegでのマージDL、'wait'モード用) は定義されているが現状どこからも呼ばれていない未使用コード
- `ConfigStore.ts` の `player.streamingMode` 付近には `'cache'`/`'ffplay'`/`'streaming'` という古いモード名を説明したコメントが残っているが、現行の型定義は `'native' | 'hls' | 'niconico'` の3値のみ (コメントの更新漏れ)

#### コメント

- **`CommentClient`**: V3 API でスレッド/コメント取得
- **`CommentXmlReader`**: XML コメントファイル読み込み
- **`CommentCommandParser`**: `@sm12345` `!jikkyou` コマンド解析

#### 検索・ランキング・マイリスト

- **`SearchClient`**: snapshot API v2 (キーワード・タグ検索)
- **`RankingClient`**: ランキング RSS (17ジャンル × 5期間)
- **`MyListClient`**: nvapi v2 (マイリスト)
- **`FollowFeedClient`**: フォロー情報取得

### DB（src/main/db）

#### スキーマ・クエリ

- **`schema.ts`**: SQL DDL (テーブル定義) + `Q` オブジェクト (共通クエリ)
- **`Database.ts`**: better-sqlite3 ラッパー・トランザクション管理

#### DAO

| DAO | テーブル | メソッド例 |
|---|---|---|
| `VideoDao` | `videos` | getByVideoId, insertOrUpdate, search, delete |
| `MyListDao` | `mylists` | getAll, getById, insert, update, delete |
| `HistoryDao` | `history` | add, getLatest, delete |
| `SearchDao` | `search_cache` | cache, getCached |
| `ScheduleDao` | `schedules` | add, getAll, delete |
| `NgListDao` | `ng_users`, `ng_words` | add, getAll, delete |

各 DAO は `constructor(db: NnddDatabase)` で依存注入。

### ダウンロード

- **`DownloadManager`**: キュー・進捗 emit
  - `enqueue(videoId, commentOnly?)` → `download()` に振る
  - `on('progress', ...)` で IPC を emit
- **`MyListAutoDownloader`**: マイリストの新着を定期取得 + enqueue
- **`ScheduleManager`**: cron ライク (曜日・時刻指定)

### プレイヤー・カスタムプロトコル

- **`PlayerManager`**: BrowserWindow 管理（最大10）
- **`LocalVideoProtocol`**: `nndd-re-local://` の Electron カスタムプロトコルハンドラ (`protocol.handle()`、ローカルファイル再生)。実装されているカスタムプロトコルはこれのみ
- **`StreamServer`**: 通常の Node `http` サーバー (`/hls/proxy` 等)。HLSプロキシ再生 (`streamingMode: 'hls'`) 用
- **`HlsProxy`**: `StreamServer` 上で master/variant m3u8 とセグメントをプロキシするロジック
- **`HlsSessionInterceptor`**: HLSセッション関連のリクエストインターセプト
- **`StreamProtocol`**: **カスタムプロトコルではない**。yt-dlp+ffmpegでのマージDL用ユーティリティ関数 (`spawnMergeDownload()`) を提供するファイル。現状呼び出し元なし (未使用)
- **`CommentWindowManager`**: コメント別ウィンドウの管理

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
- UI は `src/renderer/components/library/LibraryView.tsx` 内にインライン実装された「LANライブラリ」タブ。IPCチャンネルは `LAN_STATUS` / `LAN_LIBRARY_LIST` / `LAN_VIDEO_STREAM`
- **注意**: `src/renderer/components/lan/LanLibraryView.tsx` は同機能の初期プロトタイプで、`App.tsx`/`SettingsView.tsx` を含めコードベースのどこからも参照されていない孤立コンポーネント（未使用、技術的負債）。実運用は上記の `LibraryView.tsx` 内タブなので、新規開発時に誤って `LanLibraryView.tsx` を編集しないよう注意

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
- **コメント描画**: niconicomments の流れコメントは vpos の1秒前に右端から出現する。生放送コメントの vpos は投稿した瞬間なので、流れコメントは +1秒して渡す。遅れて届いたリアルタイムのコメントは出現位置を「今」に寄せる (接続直後にまとめて届く直前区間の分は寄せない)
- **遅れ表示**: hls.js はライブ時に最新セグメントより数セグメント手前を再生する。遅れはシーク可能範囲の末尾ではなく `hls.liveSyncPosition` を基準に計算する

### その他

- **`NnddHttpServer`**: Express サーバー (内蔵, `/api/library`, `/api/mylist`, `POST /NNDDServer` 等)
- **`TrayManager`**: システムトレイ・メニュー管理
- **`UpdateManager`**: electron-updater
- **`Logger`**: ログファイル出力 (`~/Documents/NNDD-RE/system/logs/`)
- **`LibraryScanner`**: ライブラリディレクトリをスキャン・DB 同期
- **`BinaryInstaller`** (`src/main/util/BinaryInstaller.ts`): yt-dlp/FFmpeg/ffplay のパス管理・オンデマンドインストール (`userData/bin/`)

---

## IPC チャンネル（src/shared/types/ipc.ts）

`IpcChannel` は `enum` ではなく `export const IpcChannel = {...}` というオブジェクトリテラルで全チャンネルをホワイトリスト管理。キーは `LIBRARY_LIST` のようなSCREAMING_SNAKE_CASE、値は必ず `'nndd:namespace:action'` 形式。使用例（実在するチャンネル名で記載）：

### 認証・設定

| チャンネル | 説明 |
|---|---|
| `AUTH_LOGIN` | ブラウザログイン |
| `AUTH_LOGIN_FORM` / `AUTH_LOGIN_MFA` / `AUTH_LOGIN_WITH_SAVED` | フォームログイン / 二要素認証 / 保存パスワードでのログイン |
| `AUTH_LOGOUT` | ログアウト |
| `CONFIG_GET` / `CONFIG_SET` / `CONFIG_GET_ALL` | 設定取得・保存・全件取得 |

### ダウンロード

| チャンネル | 説明 |
|---|---|
| `DOWNLOAD_ENQUEUE` | DL キューに追加 |
| `DOWNLOAD_CANCEL` | DL キャンセル |
| `DOWNLOAD_LIST` | キュー一覧 |
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
| `MYLIST_RENEW_ALL` | 全マイリストの新着を再取得 |
| `VIDEO_OPEN_PLAYER` | プレイヤーウィンドウで再生 |
| `VIDEO_GET_STREAM_URL` | ストリーミングURL取得 (`player.streamingMode` に応じて分岐) |
| `VIDEO_GET_COMMENTS` | コメント取得 |

### GitHub同期・バックアップ

| チャンネル | 説明 |
|---|---|
| `GITHUB_STATUS` / `GITHUB_START_DEVICE_FLOW` / `GITHUB_DEVICE_FLOW_EVENT` / `GITHUB_CANCEL_DEVICE_FLOW` / `GITHUB_LOGOUT` | GitHub Device Flow ログイン・状態確認 |
| `BACKUP_LIST_PROFILES` / `BACKUP_ADD_PROFILE` / `BACKUP_UPDATE_PROFILE` / `BACKUP_REMOVE_PROFILE` / `BACKUP_SET_ACTIVE_PROFILE` | 同期プロファイルのCRUD・切替 |
| `BACKUP_LINK_EXISTING_GIST` / `BACKUP_LIST_CANDIDATE_GISTS` | 既存Gistへの再連携 |
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
| `LIVE_FETCH_COMMENTS_AROUND` | 再生位置の周辺のコメントを取得 (コメント数が多い番組) |
| `LIVE_LIST_FOLLOWING` / `LIVE_SEARCH` / `LIVE_RANKING` / `LIVE_RECENT` / `LIVE_LIST_TIMESHIFT_RESERVATIONS` | 番組一覧 |
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

10 タブ構成（`useAppStore.ts` の `MAIN_TABS` で定義）。主なもの：

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
   - 「LANライブラリ」サブタブ（`LAN_STATUS`/`LAN_LIBRARY_LIST`/`LAN_VIDEO_STREAM` を利用、リモートNNDD/NNDD-RE参照）もこの中にインライン実装

7. **履歴** (`components/history/HistoryView.tsx`)
   - 視聴履歴

8. **設定** (`components/settings/SettingsView.tsx`)
   - 13サブタブ（下記参照）

### コンポーネント

#### common

- **`VideoCard.tsx`**: 動画カード (DL済みバッジ・再生ボタン)
- **`TitleBar.tsx`**: ウィンドウタイトルバー
- **`StatusBar.tsx`**: 下部ステータスバー
- **`LoginModal.tsx`**: ログイン モーダル
- **`LoginArea.tsx`**: ログイン状態表示エリア
- **`AddToPlaylistMenuItem.tsx`**: プレイリスト追加メニュー項目
- **`ContinuousPlayButton.tsx`**: 連続再生ボタン
- **`Placeholder.tsx`**: 空状態プレースホルダー

#### player

- **`VideoPlayer.tsx`**: hls.js + canvas オーバーレイ
- **`CommentOverlay.tsx`**: コメント描画 (Canvas)
- **`CommentRenderer.ts`**: コメント流れロジック（5 レイヤー × 12 スロット）
- **`CommentList.tsx`**: コメント一覧表示
- **`VideoController.tsx`**: 再生制御（再生/一時停止・音量・画質・倍速）
- **`VideoInfoView.tsx`**: 動画情報（タイトル・説明・統計）
- **`NgListDialog.tsx`**: NGリスト管理ダイアログ

#### 生放送 (別エントリ)

- **`LivePlayerApp.tsx`** (`live-player.html`): 生放送プレイヤー。レイアウト・操作バー・コメントリストは通常プレイヤーと共通 (`VideoController` の `live` などのオプション、`CommentList`)。`CommentRenderer` は `addComments` / `setVposProvider` で生放送用に使う
- **`LiveCommentApp.tsx`** (`live-comment.html`): コメントリストの浮動ウィンドウ。通常プレイヤーの `CommentApp` と同じ見た目

#### settings

`SettingsView.tsx` の `SUBTABS` は12個 + 開発者モード限定の「デバッグ」で計13サブタブ:

- **`SettingsView.tsx`**: 設定ハブ
- **`GeneralSettings.tsx`**: 全般（ログイン・HTTPサーバー・更新・LANライブラリ説明）
- **`NicoSettings.tsx`**: ニコニコ（クッキー情報）
- **`PlayerSettings.tsx`**: プレイヤー（キーボード・UI）
- **`LiveSettings.tsx`**: 生放送（別番組を別ウィンドウで開くか、コメントリストの表示方式）
- **`LibrarySettings.tsx`**: ライブラリ（DLディレクトリ・キャッシュ）
- **`ScheduleSettings.tsx`**: スケジューラー（曜日・時刻）
- **`NgCommentSettings.tsx`**: NGコメント（完全一致・投稿者NG等）
- **`ExternalToolsSettings.tsx`**: 外部ツール（yt-dlp/FFmpeg/ffplayの検出状態・パス指定・オンデマンドインストール）
- **`ConnectionDiagnostics.tsx`**: 接続診断
- **`LogViewer.tsx`**: ログ表示
- **`UpdateSettings.tsx`**: 更新（バージョン・チェック、情報タブ）
- **`BackupSettings.tsx`**: GitHub Gistバックアップ/同期（`githubSync/` サブフォルダのコンポーネントを利用）
- **`DebugSettings.tsx`**: デバッグ（開発者モード限定）
- **`settings/githubSync/`**: `DeviceFlowModal.tsx`, `GitHubLoginArea.tsx`, `ProfileEditor.tsx`, `ProfileList.tsx`（`BackupSettings.tsx`からimport）

#### その他

各タブの View コンポーネントが `useAppStore`, `useConfig` フック経由で状態・設定を取得。

### Hooks

- **`useConfig.ts`**: `ConfigStore` キャッシュ + setter
- **`useKeyboardShortcuts.ts`**: プレイヤーのキーバインド管理

### Store（Zustand）

**`useAppStore.ts`** が全アプリ状態を管理：

```typescript
type AppStore = {
  currentTab: number;
  isLoggedIn: boolean;
  pendingMylistId?: string;  // マイリスト詳細へのナビ用
  pendingSeriesId?: string;  // シリーズ詳細へのナビ用
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

2. `src/main/ipc/registerIpc.ts` に handler 登録
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

// src/main/ipc/registerIpc.ts
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

2. `Database` クラスで migration
3. DAO クラスを `src/main/db/dao/` に作成
4. `LibraryManager` でインスタンス化

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

CLAUDE.md に既知エラーリストがあります。自分の変更と無関係なら無視OK。

---

## デバッグ・トラブルシューティング

### ログを見る

```bash
# リアルタイムログ (stdout)
npm run dev

# ログファイル
~/Documents/NNDD-RE/system/logs/
```

### DevTools を開く

Electron DevTools: `Ctrl+Shift+I`（メインウィンドウ）

### better-sqlite3 ビルドエラー

```bash
npm ci
npm run rebuild  # または electron-rebuild -f -t dev
```

### IPC 呼び出しがタイムアウト

- レンダラー側で `window.nndd.channels.XXX` が定義されているか確認
- メインプロセスで `ipcMain.handle(...)` が登録されているか確認

### 動画が再生できない

- 接続診断（設定 > 接続診断）を実行
- Cookie 再ログインを試す
- `~/Documents/NNDD-RE/system/logs/` を確認

### 動画がダウンロードできない

- 再生（ストリーミング）とは異なり、ダウンロードは yt-dlp + FFmpeg が必須。設定 > 外部ツール で両方が検出されているか確認する（本ドキュメントの「動画DL・再生とyt-dlp/FFmpegの関係」参照）
- `YtDlpDownloader.findExe()` は `ytDlpPath` 設定 → `userData/bin/` → PATH の順で探索するため、パス指定が誤っていないか確認

---

## リソース

- **CLAUDE.md**: プロジェクトクイック操作
- **README.md**: ユーザー向けドキュメント
- **src/shared/types/**: 全型定義
- **src/main/nicovideo**: ニコニコ API クライアント
- **オリジナル**: `../NNDD-master/` (AS3 実装参考)
