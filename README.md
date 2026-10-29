# NNDD-RE

MineAP氏作のNNDD（Adobe AIR/ActionScript）を **Electron + TypeScript + React** で再実装した精神的後継プロジェクト

オリジナル `NNDD-master/` との互換性を目指しつつ、動画ダウンロードは**新ニコニコAPI (V3 DMS)** に対応しています。

## ドキュメント

詳しい使い方は [ドキュメントサイト](https://nndd-rebuild.github.io/NNDD-RE/) を参照してください。

- [使い方ガイド](https://nndd-rebuild.github.io/NNDD-RE/usage-guide/)
- [プレイヤー (キーボードショートカット含む)](https://nndd-rebuild.github.io/NNDD-RE/player/)
- [ニコニコ生放送](https://nndd-rebuild.github.io/NNDD-RE/live/)
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
- ニコニコ生放送の視聴 (リアルタイム/タイムシフト/追っかけ再生、コメント表示・投稿、録画予約、放送のダウンロード)
- ランキング表示 (17ジャンル × 5期間)
- キーワード/タグ検索 (snapshot API V2)
- 視聴履歴・統計
- NGリスト (コメント/タグ/投稿者、完全一致指定・投稿者からのワンクリックNG登録、プレイヤーの流れコメントを右クリックしてNG登録、ニコニコのアカウント側NGとの同期に対応)
- ニコニコの複数アカウント対応 (マイリスト・プレイリスト・スケジュール・録画予約・コメントNG・視聴履歴をアカウントごとに管理、アカウント間の移動/コピー、プレイリストとニコニコのマイリストの同期)
- DLスケジューラー (曜日+時刻指定)
- GitHub Gist を使ったバックアップ/同期 (Device Flowログイン、複数プロファイル管理、アプリ設定・NGリスト・マイリスト・スケジュール・保存検索・プレイリスト・視聴履歴を選択してアップロード/ダウンロード、起動・終了時の自動アップロードにも対応)
- 内蔵HTTPサーバー (他アプリ連携、Range対応動画配信)
- 本家NNDDのライブラリ取り込み
- Discord Rich Presence / Webhook 通知
- Tailscale 連携 (内蔵HTTPサーバーを外出先から利用)
- ニコニコのメンテナンス検知・表示
- 匿名利用統計 (オプトイン)
- LANライブラリ共有 (同一LAN上の他NNDD/NNDD-REインスタンスのライブラリをライブラリタブ内「LANライブラリ」から閲覧・再生)
- システムトレイ常駐
- 自動更新 (electron-updater)
- 多重起動防止
- 接続診断
- ログビューア

## 技術スタック

```
Electron 43 (デスクトップ基盤)
├─ TypeScript (メインプロセス / レンダラー共通)
├─ React 18 + Tailwind CSS (UI)
├─ better-sqlite3 (ライブラリDB)
├─ Express (内蔵HTTPサーバー)
├─ hls.js (HLS動画再生)
├─ mpegts.js (FLVストリーミング)
├─ @bufbuild/protobuf (生放送コメント NDGR)
├─ @xpadev-net/niconicomments (コメント描画エンジン)
├─ tough-cookie (Cookie永続化)
├─ fast-xml-parser (RSS/コメントXML解析)
├─ electron-updater (自動更新)
├─ zustand (状態管理)
└─ ほか: @tanstack/react-virtual, @xhayper/discord-rpc, @aptabase/electron, mediabunny, qrcode
```

## ディレクトリ構成

```
src/
├── main/                      Electronメインプロセス (Node.js)
│   ├── main.ts                エントリポイント
│   ├── db/                    SQLite + DAO群
│   ├── nicovideo/             ニコニコAPI (V3 DMS対応)
│   │   ├── auth/              Cookie認証/ログインウィンドウ/複数アカウント管理 (AccountManager)
│   │   ├── watch/             ウォッチページ解析 (WatchPageParser / WatchInfoHandler)
│   │   ├── video/             WatchSession / yt-dlpラッパー / 自前HLSダウンローダー (既定のDL経路、失敗時 yt-dlp にフォールバック)
│   │   ├── comment/           コメントV3クライアント / XML読み書き
│   │   ├── channel/           チャンネル動画
│   │   ├── history/           ニコニコ視聴履歴
│   │   ├── live/              生放送 (視聴API / NDGRコメント / 録画予約 / 放送DL、gen/ は protobuf 生成物)
│   │   ├── ng/                アカウント側NGとの同期
│   │   ├── search/            検索API (snapshot v2)
│   │   ├── series/            シリーズ取得
│   │   ├── mylist/            マイリストAPI (nvapi v2)
│   │   ├── ranking/           ランキングRSS
│   │   ├── follow/            フォロー中フィード
│   │   ├── ConnectionDiag.ts  接続診断
│   │   └── MaintenanceMonitor.ts  メンテナンス検知
│   ├── downloader/            DownloadManager / ScheduleManager / MyListAutoDL
│   ├── github/                GitHub 認証 (Device Flow) / Gist クライアント
│   ├── githubSync/            GitHub Gist バックアップ/同期 (BackupManager)
│   ├── discord/               Discord Rich Presence
│   ├── import/                本家NNDDのライブラリ取り込み
│   ├── notification/          Webhook 通知
│   ├── protocol/              nndd-re-cmd プロトコル
│   ├── telemetry/             匿名利用統計
│   ├── workers/               画像キャッシュ等のワーカー
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
│   ├── App.tsx                メインウィンドウ (10タブ)
│   ├── PlayerApp.tsx          プレイヤーウィンドウ
│   ├── components/
│   │   ├── ranking/           ランキング
│   │   ├── search/            検索
│   │   ├── follow/            フォロー中
│   │   ├── mylist/            マイリスト
│   │   ├── download/          DLリスト
│   │   ├── library/           ライブラリ (LANライブラリタブ含む)
│   │   ├── history/           履歴
│   │   ├── live/              生放送 (一覧/視聴/コメント)
│   │   ├── stats/             統計
│   │   ├── telemetry/         利用統計の確認ダイアログ
│   │   ├── lan/               (未使用の初期プロトタイプ、実運用は library/ 側)
│   │   ├── settings/          設定 (12サブタブ、githubSync/ サブフォルダ含む)
│   │   ├── player/            VideoPlayer / CommentOverlay / CommentRenderer / CommentList / NgListDialog
│   │   └── common/            VideoCard / TitleBar / StatusBar / LoginArea / ContinuousPlayButton
│   ├── LivePlayerApp.tsx      生放送プレイヤーウィンドウ
│   ├── LiveCommentApp.tsx     生放送コメントウィンドウ
│   ├── hooks/                 useConfig, useKeyboardShortcuts, player/ live/ など
│   ├── store/                 Zustand
│   └── util/                  commentCommands, enqueueDownload など
└── shared/                    メイン↔レンダラー共通
    ├── types/                 全データモデル + IPC定義
    ├── constants/             API URL, ヘッダー, パス, ランキングジャンル
    └── utils/                 NG判定など共通ロジック
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

### 配布物についての注意 (コード署名なし)

[Releases](https://github.com/NNDD-Rebuild/NNDD-RE/releases) で配布しているビルド済みアプリは、コスト都合によりコード署名(Windows)・公証(macOS)を行っていません。そのためOSの警告が表示されることがあります。

- **Windows**: インストーラ実行時に SmartScreen が「WindowsによってPCが保護されました」と表示することがあります。「詳細情報」→「実行」をクリックしてください。
- **macOS**: アプリ起動時に「開発元を確認できないため開けません」と表示されることがあります。Finderでアプリを右クリック→「開く」を選択するか、ターミナルで以下を実行してください。
  ```bash
  xattr -cr /Applications/NNDD-RE.app
  ```
- **Linux**: 署名の警告は基本的に発生しません。

## 使い方の流れ

初回ログイン → 動画ダウンロード → 動画再生 → スケジュール自動DL、の4ステップです。詳細は [使い方ガイド](https://nndd-rebuild.github.io/NNDD-RE/usage-guide/) を参照してください。

## キーボードショートカット (プレイヤー)

Space / F / M / V / ←→ / ↑↓ など。一覧は [プレイヤー](https://nndd-rebuild.github.io/NNDD-RE/player/) の「キーボードショートカット」を参照してください。

## 内蔵HTTPサーバー (他アプリ連携)

設定 → 外部ツール・連携 → サーバー・LAN「起動」をクリックすると `http://127.0.0.1:12345/` で稼働します。エンドポイント一覧は [内蔵HTTPサーバー連携](https://nndd-rebuild.github.io/NNDD-RE/http-server-integration/) を参照してください。

## アーキテクチャの要点

### 動画の再生とダウンロード

再生 (ストリーミング、デフォルト動作) は hls.js が niconico CDN に直接アクセスするため yt-dlp・FFmpeg は不要です。詳細な経路図は [トラブルシューティング](https://nndd-rebuild.github.io/NNDD-RE/troubleshooting/) を参照してください。

### コメント描画

`CommentRenderer` は [@xpadev-net/niconicomments](https://github.com/xpadev-net/niconicomments) をラップした描画クラスで、動画プレイヤーと生放送プレイヤーの両方で使います。ブラウザ版ライブラリ (内蔵HTTPサーバー) にも同じものをバンドルして配信します。

- ニコニコ公式に近いコメントの配置・色・サイズ・コマンド (ue / shita / big / small / 色指定 など) に対応
- NG判定は描画側と共通のロジック (`src/shared/utils/ngMatch.ts`) を使用

## ライセンス

オリジナル (本家 NNDD) と同じ [MIT ライセンス](LICENSE) を踏襲しています。

## 開発時の注意

- `better-sqlite3` はネイティブモジュールのため `electron-rebuild` または `electron-builder install-app-deps` の実行が必要になることがあります
- FFmpeg / yt-dlp は **動画のダウンロード (ライブラリへの保存) にのみ必要**です。動画の視聴 (デフォルトのストリーミング再生) は niconico CDN から `hls.js` で直接再生するため、どちらも不要です
- FFmpeg / yt-dlp は設定 → 外部ツール・連携 → 外部ツール画面からオンデマンドでダウンロードします (バイナリは `userData/bin/` 配下に保存、yt-dlpと同じディレクトリに置くことでyt-dlpがFFmpegを自動検出します)
- カスタムプロトコル `nndd-re-local://` は CSP 設定で許可済みです

