---
title: NNDD-RE
nav_order: 1
---

# NNDD-RE

MineAP氏作の NNDD（Adobe AIR/ActionScript）を **Electron + TypeScript + React** で再実装した精神的後継プロジェクトです。

オリジナル NNDD の機能・デザインを再現しつつ、動画ダウンロードは**新ニコニコAPI（V3 DMS）**に対応しています。

## クイックリンク

- [使い方ガイド](/NNDD-RE/usage-guide/) — 初回ログイン〜ダウンロード〜再生〜自動ダウンロード
- [設定](/NNDD-RE/settings/) — 全設定タブ・項目のリファレンス
- [キーボードショートカット](/NNDD-RE/keyboard-shortcuts/)
- [内蔵HTTPサーバー・LAN共有](/NNDD-RE/http-server-integration/)
- [GitHub同期・バックアップ](/NNDD-RE/github-sync/)
- [Discord連携・Webhook通知](/NNDD-RE/discord-webhook/)
- [トラブルシューティング](/NNDD-RE/troubleshooting/)

開発環境の構築やビルド手順は [GitHubリポジトリのREADME](https://github.com/NNDD-Rebuild/NNDD-RE) を参照してください。

## タブ別ガイド

- [ランキング](/NNDD-RE/ranking/) — ジャンル別ランキング表示
- [検索](/NNDD-RE/search/) — キーワード・タグ検索、保存検索
- [フォロー中](/NNDD-RE/follow/) — フォロー中ユーザーの新着動画
- [マイリスト](/NNDD-RE/mylist/) — マイリスト・チャンネル・シリーズ・自作プレイリスト
- [DLリスト](/NNDD-RE/download/) — ダウンロードキューの管理
- [ライブラリ](/NNDD-RE/library/) — ダウンロード済み動画のローカル管理
- [履歴](/NNDD-RE/history/) — 視聴履歴・実視聴時間
- [統計](/NNDD-RE/stats/) — ライブラリ・視聴傾向の集計
- [プレイヤー](/NNDD-RE/player/) — 再生・コメント・連続再生

## 主な機能

### ダウンロード・再生

- 動画ダウンロード（既定はネイティブHLS実装＋mediabunny muxで外部ツール不要。yt-dlp / FFmpegはフォールバック・代替設定として利用可、Cookie認証）
- ストリーミング再生（hls.js でニコニコCDNから直接再生 / ニコニコ公式プレイヤー埋め込みにも対応）
- 再生コントロール強化（画質切替、倍速再生 0.25x〜2.0x、音声のみ再生モード）
- 連続再生強化（残り5秒での自動プリロード、スキップボタン、検索結果からのプレイリスト連続再生）

### ライブラリ・検索

- ローカルライブラリ管理（SQLite、命名規則 `タイトル[sm12345].mp4`、フォルダ管理）
- キーワード/タグ検索（snapshot API V2、保存検索）
- ランキング表示（24ジャンル × 5期間）
- 視聴履歴（アプリ内履歴＋ニコ動本家履歴の統合、実視聴時間の計測）
- 統計ダッシュボード（月別DL数・日別視聴数・タグ別集計）

### マイリスト・チャンネル・フォロー

- マイリスト・チャンネル・コミュニティ・ユーザー投稿・シリーズ取得
- チャンネル動画対応（CHバッジ表示）
- フォロー中フィード（フォロー中ユーザーの新着動画）
- DLスケジューラー（曜日+時刻指定）

### バックアップ・連携

- GitHub Gist を使ったバックアップ/同期（Device Flowログイン、複数プロファイル管理）
- 内蔵HTTPサーバー（他アプリ連携、Range対応動画配信）
- LANライブラリ共有

### その他

- ニコニココメント付き動画プレイヤー（Canvas APIで流れるコメント描画）
- NGリスト（コメント/タグ/投稿者）
- システムトレイ常駐
- 自動更新
- 接続診断
- ログビューア
