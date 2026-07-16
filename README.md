# NNDD-RE

MineAP氏作のNNDD（Adobe AIR/ActionScript）を **Electron + TypeScript + React** で再実装した精神的後継プロジェクト

オリジナル `NNDD-master/` の機能・デザインを再現しつつ、動画ダウンロードは**新ニコニコAPI (V3 DMS)** に対応しています。

## ドキュメント

詳しい使い方は [ドキュメントサイト](https://nndd-rebuild.github.io/NNDD-RE/) を参照してください。

- [使い方ガイド](https://nndd-rebuild.github.io/NNDD-RE/usage-guide/)
- [キーボードショートカット](https://nndd-rebuild.github.io/NNDD-RE/keyboard-shortcuts/)
- [内蔵HTTPサーバー連携](https://nndd-rebuild.github.io/NNDD-RE/http-server-integration/)
- [トラブルシューティング](https://nndd-rebuild.github.io/NNDD-RE/troubleshooting/)

## 主な機能

- 動画ダウンロード (yt-dlp + FFmpeg によるベスト画質DL、Cookie認証)
- ストリーミング再生 (yt-dlp/FFmpeg 不要、hls.js でニコニコCDNから直接再生 / ニコニコ公式プレイヤー埋め込みにも対応)
- ローカルライブラリ管理 (SQLite、命名規則 `タイトル[sm12345].mp4`、フォルダ管理)
- ニコニココメント付き動画プレイヤー (Canvas APIで流れるコメント描画)
- 再生コントロール強化 (画質切替、倍速再生 0.25x〜2.0x、音声のみ再生モード)
- 連続再生強化 (残り5秒での自動プリロード、スキップボタン、検索結果からのプレイリスト連続再生)
- マイリスト・チャンネル・コミュニティ・ユーザー投稿・シリーズ取得 (シリーズはページネーション対応、マイリスト名はインライン編集可)
- チャンネル動画対応 (CHバッジ表示)
- フォロー中フィード (フォロー中ユーザーの新着動画)
- ランキング表示 (17ジャンル × 5期間)
- キーワード/タグ検索 (snapshot API V2)
- 視聴履歴
- NGリスト (コメント/タグ/投稿者、完全一致指定・投稿者からのワンクリックNG登録に対応)
- DLスケジューラー (曜日+時刻指定)
- GitHub Gist を使ったバックアップ/同期 (Device Flowログイン、複数プロファイル管理、アプリ設定・NGリスト・マイリスト・スケジュール・保存検索・プレイリスト・視聴履歴を選択してアップロード/ダウンロード、起動・終了時の自動アップロードにも対応)
- 内蔵HTTPサーバー (他アプリ連携、Range対応動画配信)
- LANライブラリ共有 (同一LAN上の他NNDD/NNDD-REインスタンスのライブラリをライブラリタブ内「LANライブラリ」から閲覧・再生)
- システムトレイ常駐
- 自動更新 (electron-updater)
- 多重起動防止
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
│   │   ├── watch/             ウォッチページ解析 (WatchPageParser / WatchInfoHandler)
│   │   ├── video/             WatchSession / yt-dlpラッパー / (未使用の自前HLSパイプライン)
│   │   ├── comment/           コメントV3クライアント / XML読み書き
│   │   ├── search/            検索API (snapshot v2)
│   │   ├── mylist/            マイリストAPI (nvapi v2)
│   │   ├── ranking/           ランキングRSS
│   │   ├── follow/            フォロー中フィード
│   │   └── ConnectionDiag.ts  接続診断
│   ├── downloader/            DownloadManager / ScheduleManager / MyListAutoDL
│   ├── githubSync/            GitHub Gist バックアップ/同期 (BackupManager)
│   ├── library/                LibraryScanner
│   ├── player/                 PlayerManager / カスタムプロトコル / HLSプロキシ
│   ├── server/                 内蔵HTTPサーバー / LANライブラリクライアント
│   ├── tray/                   システムトレイ
│   ├── update/                 自動更新
│   ├── config/                 電子ストア設定
│   ├── ipc/                    IPC登録
│   └── util/                   Logger, BinaryInstaller (yt-dlp/FFmpeg管理)
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
│   │   ├── library/           ライブラリ (LANライブラリタブ含む)
│   │   ├── history/           履歴
│   │   ├── lan/               (未使用の初期プロトタイプ、実運用は library/ 側)
│   │   ├── settings/          設定 (12サブタブ、githubSync/ サブフォルダ含む)
│   │   ├── player/            VideoPlayer / CommentOverlay / CommentRenderer / CommentList / NgListDialog
│   │   └── common/            VideoCard / TitleBar / StatusBar / LoginArea / ContinuousPlayButton
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

これでメインプロセス + Vite (HMR付きReact) + Electron が同時起動します。Windowsではルート直下の `1_起動.bat` をダブルクリックしても同じことができます。

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

初回ログイン → 動画ダウンロード → 動画再生 → スケジュール自動DL、の4ステップです。詳細は [使い方ガイド](https://nndd-rebuild.github.io/NNDD-RE/usage-guide/) を参照してください。

## キーボードショートカット (プレイヤー)

Space / F / M / V / ←→ / ↑↓ など。一覧は [キーボードショートカット](https://nndd-rebuild.github.io/NNDD-RE/keyboard-shortcuts/) を参照してください。

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
- [x] Phase 10: GitHub Gistバックアップ/同期・チャンネル動画対応・再生コントロール強化 (画質切替/倍速/音声のみ)・連続再生強化

## 内蔵HTTPサーバー (他アプリ連携)

設定 → 全般 → 内蔵HTTPサーバー「起動」をクリックすると `http://127.0.0.1:12345/` で稼働します。エンドポイント一覧は [内蔵HTTPサーバー連携](https://nndd-rebuild.github.io/NNDD-RE/http-server-integration/) を参照してください。

## アーキテクチャの要点

### 動画の再生とダウンロード (yt-dlp/FFmpegの要不要が異なる)

再生 (ストリーミング、デフォルト動作) は hls.js が niconico CDN に直接アクセスするため yt-dlp・FFmpeg は不要です。ダウンロード (ライブラリへの保存) には yt-dlp + FFmpeg が必須です。詳細な経路図は [トラブルシューティング](https://nndd-rebuild.github.io/NNDD-RE/troubleshooting/) を参照してください。

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
- FFmpeg / yt-dlp は **動画のダウンロード (ライブラリへの保存) にのみ必要**です。動画の視聴 (デフォルトのストリーミング再生) は niconico CDN から `hls.js` で直接再生するため、どちらも不要です
- FFmpeg / yt-dlp は設定 → 外部ツール画面からオンデマンドでダウンロードします (バイナリは `userData/bin/` 配下に保存、yt-dlpと同じディレクトリに置くことでyt-dlpがFFmpegを自動検出します)
- カスタムプロトコル `nndd-re-local://` は CSP 設定で許可済みです

## 参考

- オリジナル: `../NNDD-master/`
- 新API仕様参考: `../Niconicome-develop/` (C#/WPF実装)
