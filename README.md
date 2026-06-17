# NNDD-RE

NNDD (NicoNico Douga Downloader/Player) を Adobe AIR/ActionScript から **Electron + TypeScript + React** へ完全移植したプロジェクト。

オリジナル `NNDD-master/` の機能・デザインを再現しつつ、動画ダウンロードは**新ニコニコAPI (V3 DMS)** に対応しています。

## 主な機能

- 動画ダウンロード (HLS/DMS 対応、AES-128 復号、FFmpegでMP4結合)
- ローカルライブラリ管理 (SQLite、命名規則 `タイトル[sm12345].mp4`、フォルダ管理)
- ニコニココメント付き動画プレイヤー (Canvas APIで流れるコメント描画)
- マイリスト・チャンネル・コミュニティ・ユーザー投稿・シリーズ取得
- フォロー中フィード (フォロー中ユーザーの新着動画)
- ランキング表示 (17ジャンル × 5期間)
- キーワード/タグ検索 (snapshot API V2)
- 視聴履歴
- NGリスト (コメント/タグ/投稿者)
- DLスケジューラー (曜日+時刻指定)
- 内蔵HTTPサーバー (他アプリ連携、Range対応動画配信)
- LANライブラリ共有 (同一LAN上の他PCへ動画配信)
- システムトレイ常駐
- 自動更新 (electron-updater)
- 接続診断
- ログビューア

## 技術スタック

```
Electron 33 (デスクトップ基盤)
├─ TypeScript (メインプロセス / レンダラー共通)
├─ React 18 + Tailwind CSS (UI)
├─ better-sqlite3 (ライブラリDB)
├─ Express (内蔵HTTPサーバー)
├─ hls.js (HLS動画再生)
├─ mpegts.js (M2TS/TSストリーミング)
├─ @xpadev-net/niconicomments (コメント描画エンジン)
├─ tough-cookie (Cookie永続化)
├─ fast-xml-parser (RSS/コメントXML解析)
├─ electron-updater (自動更新)
└─ zustand (状態管理)
```

## ディレクトリ構成

```
src/
├── main/                      Electronメインプロセス (Node.js)
│   ├── main.ts                エントリポイント
│   ├── db/                    SQLite + DAO群
│   ├── nicovideo/             ニコニコAPI (V3 DMS対応)
│   │   ├── auth/              Cookie認証/ログインウィンドウ
│   │   ├── watch/             ウォッチページ解析
│   │   ├── video/             WatchSession / M3U8パーサ / セグメント / FFmpeg
│   │   ├── comment/           コメントV3クライアント / XML読み書き
│   │   ├── search/            検索API (snapshot v2)
│   │   ├── mylist/            マイリストAPI (nvapi v2)
│   │   ├── ranking/           ランキングRSS
│   │   ├── follow/            フォロー中フィード
│   │   └── ConnectionDiag.ts  接続診断
│   ├── downloader/            DownloadManager / ScheduleManager / MyListAutoDL
│   ├── library/               LibraryScanner
│   ├── player/                PlayerManager / カスタムプロトコル
│   ├── server/                内蔵HTTPサーバー
│   ├── tray/                  システムトレイ
│   ├── update/                自動更新
│   ├── config/                電子ストア設定
│   ├── ipc/                   IPC登録
│   └── util/                  Logger
├── preload/                   contextBridge IPC API
├── renderer/                  React UI
│   ├── App.tsx                メインウィンドウ (8タブ)
│   ├── PlayerApp.tsx          プレイヤーウィンドウ
│   ├── components/
│   │   ├── ranking/           ランキング
│   │   ├── search/            検索
│   │   ├── follow/            フォロー中
│   │   ├── mylist/            マイリスト
│   │   ├── download/          DLリスト
│   │   ├── library/           ライブラリ
│   │   ├── history/           履歴
│   │   ├── lan/               LANライブラリ
│   │   ├── settings/          設定 (9サブタブ)
│   │   ├── player/            VideoPlayer / CommentOverlay / CommentRenderer
│   │   └── common/            VideoCard / TitleBar / StatusBar
│   ├── hooks/                 useConfig, useKeyboardShortcuts
│   ├── store/                 Zustand
│   └── util/                  commentCommands
└── shared/                    メイン↔レンダラー共通
    ├── types/                 全データモデル + IPC定義
    └── constants/             API URL, ヘッダー, パス, ランキングジャンル
```

## セットアップ

### 必要なソフトウェア

- **Node.js 20+** (LTS推奨)
- **Visual Studio Build Tools** (Windows) または Python (better-sqlite3 ビルド用)

### インストール

```bash
cd NNDD-RE
npm install
```

### 開発実行

```bash
npm run dev
```

これでメインプロセス + Vite (HMR付きReact) + Electron が同時起動します。

### 型チェック

```bash
npm run tc:all
```

### プロダクションビルド

```bash
npm run build        # 全プラットフォーム共通ビルド
npm run dist:win     # Windowsインストーラ (.exe)
npm run dist:mac     # macOS DMG
npm run dist:linux   # Linux AppImage
```

成果物は `dist/` フォルダに出力されます。

## 使い方の流れ

1. **初回ログイン**
   - 設定 → 全般 → 「ブラウザでログイン」をクリック
   - 表示されるウィンドウで通常通りニコニコ動画にログイン
   - Cookieが自動的にNNDDに取り込まれる

2. **動画ダウンロード**
   - DLリストタブで動画ID (sm12345等) を入力 → 「DLリストに追加」
   - または検索/ランキング/マイリストから「DL」ボタン
   - 自動で WatchSession 確立 → HLSセグメントDL → AES復号 → FFmpegで MP4結合

3. **動画再生**
   - ライブラリで「再生」をクリック (ローカル再生)
   - 検索/ランキング/マイリストで「再生」 (ストリーミング)
   - コメントは自動的に重畳表示

4. **スケジュール自動DL**
   - マイリストを登録 → 設定 → スケジュール → 新規スケジュール
   - 曜日と時刻を指定すると、その時刻に自動でマイリストを更新し新着動画をDL

## キーボードショートカット (プレイヤー)

| キー | 動作 |
|---|---|
| Space | 再生/一時停止 |
| F / F11 | フルスクリーン切替 |
| M | ミュート切替 |
| V | コメント表示切替 |
| ← / → | -5秒 / +5秒 |
| Shift + ← / → | -10秒 / +10秒 |
| ↑ / ↓ | 音量+/- |

## 移植進捗

- [x] Phase 1: プロジェクト初期化・データモデル・DB
- [x] Phase 2: ニコニコAPIラッパー (V3 DMS)
- [x] Phase 3: ダウンロードエンジン (AES-128復号 + FFmpeg統合)
- [x] Phase 4: コメント描画エンジン (Canvas API、5レイヤー多重化)
- [x] Phase 5: 動画プレイヤーUI (hls.js + カスタムプロトコル)
- [x] Phase 6: ライブラリ管理・検索UI
- [x] Phase 7: マイリスト・ランキング・スケジューラー
- [x] Phase 8: HTTPサーバー・システムトレイ・接続診断
- [x] Phase 9: 設定・自動更新・キーボードショートカット・ログビューア

## 内蔵HTTPサーバー (他アプリ連携)

設定 → 全般 → 内蔵HTTPサーバー「起動」をクリックすると `http://127.0.0.1:12345/` で稼働します。

| エンドポイント | 用途 |
|---|---|
| `GET /health` | ヘルスチェック |
| `GET /api/library` | ライブラリ動画一覧 (JSON) |
| `GET /api/mylist` | 登録マイリスト一覧 (JSON) |
| `GET /api/video/:id` | 個別動画情報 (JSON) |
| `GET /api/video/:id/stream` | 動画ストリーミング (Range対応) |
| `GET /api/video/:id/thumb` | サムネイル画像 |
| `GET /api/video/:id/comments` | コメント一覧 (JSON) |
| `GET /library` | HTMLライブラリページ |
| `POST /NNDDServer` | 旧仕様XMLプロトコル (互換) |
| `GET /NNDDServer/:videoId` | 旧仕様 動画配信 |

## アーキテクチャの要点

### 新DMS APIによる動画ダウンロード

```
WatchPageParser  → data-api-data JSON抽出
       ↓
WatchSession     → POST /v1/watch/{id}/access-rights/hls
       ↓             (X-Access-Right-Key ヘッダー、最高品質を自動選択)
master.m3u8      → ContentUrl から取得
       ↓
M3U8Parser       → master + variant 解析
       ↓
SegmentDownloader → m4sセグメント並列DL (3並列) + AES-128復号
       ↓
FFmpegManager    → init + segments を連結し muxing → MP4
```

### コメント描画

`CommentRenderer` (Canvas API) は元の AS3 `CommentManager` を完全再現:

- 5レイヤー × 12スロットで多重化
- 流れる速度: `dist + (dist/50) * text.length` (元と同式)
- BIG=1.5x / MEDIUM=1.0x / SMALL=0.75x
- 通常16色 + プレミアム8色 + `#HHHHHH` 16進指定
- ドロップシャドウフィルター対応

## ライセンス

オリジナルと同じ MPLv2 を踏襲。

## 開発時の注意

- `better-sqlite3` はネイティブモジュールのため `electron-rebuild` または `electron-builder install-app-deps` の実行が必要になることがあります
- FFmpeg / yt-dlp は設定 → 外部ツール画面からオンデマンドでダウンロードします (バイナリは `userData` 配下に保存)
- カスタムプロトコル `nndd-re-local://` は CSP 設定で許可済みです

## 参考

- オリジナル: `../NNDD-master/`
- 新API仕様参考: `../Niconicome-develop/` (C#/WPF実装)
