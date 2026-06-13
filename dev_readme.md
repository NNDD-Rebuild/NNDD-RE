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
| `NicoContext` | ニコニコAPI認証 + HTTP クライアント管理 | `main.ts` |
| `LibraryManager` | DB + 全 DAO (Video/MyList/History 等) 管理 | `main.ts` |
| `DownloadManager` | 動画 DL キュー・進捗 emit | `main.ts` → IPC 呼び出しで enqueue |
| `PlayerManager` | プレイヤー BrowserWindow 生成・管理 | `main.ts` → VIDEO_OPEN_PLAYER で new |
| `ScheduleManager` | スケジューラー定期実行 | `main.ts` |
| `ConfigStore` | 設定値の永続化 | `main.ts` 起動時に load |

### ニコニコAPI（src/main/nicovideo）

#### 認証・セッション

- **`AuthManager`**: Cookie 取得 → `NicoContext` へ登録
- **`LoginWindow`**: ブラウザウィンドウでログイン・Cookie 抽出
- **`CookieStore`**: tough-cookie で Cookie 永続化

#### 動画取得・DL

- **`WatchPageParser`**: watch ページの JSON 抽出 (動画メタ)
- **`WatchSession`**: `/v1/watch/{id}/access-rights/hls` で session ID 取得
- **`M3U8Parser`**: master.m3u8 の variant / segment URL 解析
- **`SegmentDownloader`**: m4s セグメント並列 DL + AES-128 復号
- **`FFmpegManager`**: init + segments を mux して MP4 出力
- **`YtDlpDownloader/Streamer`**: 新 DMS 非対応動画を yt-dlp 代替

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
- **`LocalVideoProtocol`**: `nndd-local://` ハンドラ (ローカルファイル再生)
- **`StreamProtocol`**: `nndd-stream://` ハンドラ (ストリーミング再生)

### その他

- **`NnddHttpServer`**: Express サーバー (内蔵, `/api/library`, `/api/mylist` 等)
- **`TrayManager`**: システムトレイ・メニュー管理
- **`UpdateManager`**: electron-updater
- **`Logger`**: ログファイル出力 (`~/Documents/NNDD-RE/system/logs/`)
- **`LibraryScanner`**: ライブラリディレクトリをスキャン・DB 同期

---

## IPC チャンネル（src/shared/types/ipc.ts）

`IpcChannel` enum で全チャンネルをホワイトリスト管理。使用例：

### 認証・設定

| チャンネル | 型 | 説明 |
|---|---|---|
| `AUTH_LOGIN_WITH_BROWSER` | `() → void` | ブラウザログイン |
| `AUTH_LOGOUT` | `() → void` | ログアウト |
| `CONFIG_GET` | `(key: string) → any` | 設定取得 |
| `CONFIG_SET` | `(key, value) → void` | 設定保存 |

### ダウンロード

| チャンネル | 型 | 説明 |
|---|---|---|
| `DOWNLOAD_ENQUEUE` | `(videoId, opts?) → void` | DL キューに追加 |
| `DOWNLOAD_CANCEL` | `(videoId) → void` | DL キャンセル |
| `DOWNLOAD_GET_QUEUE` | `() → DownloadTask[]` | キュー一覧 |
| `DOWNLOAD_ON_PROGRESS` | listener | emit: `{ videoId, progress, status }` |

### ライブラリ

| チャンネル | 型 | 説明 |
|---|---|---|
| `LIBRARY_GET_ALL` | `(limit?, offset?) → Video[]` | 全動画 |
| `LIBRARY_SEARCH` | `(query) → Video[]` | 検索 |
| `LIBRARY_DELETE` | `(videoId) → void` | 削除 |
| `LIBRARY_CHECK_BATCH` | `(videoIds: string[]) → Record<id, bool>` | 一括確認 |

### 検索・ランキング・マイリスト

| チャンネル | 型 |
|---|---|
| `SEARCH_QUERY` | `(query) → SearchResult[]` |
| `RANKING_GET` | `(genre, period) → Video[]` |
| `MYLIST_GET_ALL` | `() → MyList[]` |
| `MYLIST_GET_VIDEOS` | `(mylistId) → Video[]` |

### プレイヤー

| チャンネル | 型 | 説明 |
|---|---|---|
| `VIDEO_OPEN_PLAYER` | `(videoId / localPath) → void` | 新ウィンドウで再生 |
| `VIDEO_GET_STREAM_URL` | `(videoId) → string` | ストリーミング URL |
| `VIDEO_GET_COMMENTS` | `(videoId, offset?) → Comment[]` | コメント取得 |

---

## Preload（src/preload/index.ts）

`window.nndd` 経由で IPC API 公開：

```typescript
// レンダラー側での使用
await window.nndd.invoke<Video[]>(
  window.nndd.channels.LIBRARY_GET_ALL,
  { limit: 20, offset: 0 }
);

// リスナー登録
window.nndd.on(
  window.nndd.channels.DOWNLOAD_ON_PROGRESS,
  (evt, data) => { /* handle */ }
);
```

---

## レンダラー（src/renderer）

### メインウィンドウ（App.tsx）

7 タブ構成：

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

5. **DLリスト** (`components/download/DownloadView.tsx`)
   - キュー・進捗表示

6. **ライブラリ** (`components/library/LibraryView.tsx`)
   - ダウンロード済み動画
   - 検索・フィルター

7. **履歴** (`components/history/HistoryView.tsx`)
   - 視聴履歴

### コンポーネント

#### common

- **`VideoCard.tsx`**: 動画カード (DL済みバッジ・再生ボタン)
- **`TitleBar.tsx`**: ウィンドウタイトルバー
- **`StatusBar.tsx`**: 下部ステータスバー
- **`LoginModal.tsx`**: ログイン モーダル

#### player

- **`VideoPlayer.tsx`**: hls.js + canvas オーバーレイ
- **`CommentOverlay.tsx`**: コメント描画 (Canvas)
- **`CommentRenderer.ts`**: コメント流れロジック（5 レイヤー × 12 スロット）
- **`VideoController.tsx`**: 再生制御（再生/一時停止・音量・字幕）
- **`VideoInfoView.tsx`**: 動画情報（タイトル・説明・統計）

#### settings

- **`SettingsView.tsx`**: 設定ハブ
- **`GeneralSettings.tsx`**: 全般（ログイン・HTTPサーバー・更新）
- **`NicoSettings.tsx`**: ニコニコ（クッキー情報）
- **`PlayerSettings.tsx`**: プレイヤー（キーボード・UI）
- **`LibrarySettings.tsx`**: ライブラリ（DLディレクトリ・キャッシュ）
- **`ScheduleSettings.tsx`**: スケジューラー（曜日・時刻）
- **`UpdateSettings.tsx`**: 更新（バージョン・チェック）
- **`LogViewer.tsx`**: ログ表示
- **`ConnectionDiagnostics.tsx`**: 接続診断

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

1. `src/shared/types/ipc.ts` の `IpcChannel` enum に追加
   ```typescript
   export enum IpcChannel {
     // 既存...
     MY_NEW_CHANNEL = 'nndd:namespace:action',
   }
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

---

## リソース

- **CLAUDE.md**: プロジェクトクイック操作
- **README.md**: ユーザー向けドキュメント
- **src/shared/types/**: 全型定義
- **src/main/nicovideo**: ニコニコ API クライアント
- **オリジナル**: `../NNDD-master/` (AS3 実装参考)
