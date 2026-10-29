---
title: NNDD-RE
description: NNDD-RE はニコニコ動画のダウンローダー兼プレイヤー。MineAP氏作 NNDD を Electron + TypeScript + React で再実装し、新ニコニコAPI (V3 DMS) に対応。
nav_order: 1
---

# NNDD-RE

MineAP氏作の NNDD（Adobe AIR/ActionScript）を **Electron + TypeScript + React** で再実装した精神的後継プロジェクトです。

本家NNDDとの互換性を目指しつつ、動画ダウンロードは**新ニコニコAPI（V3 DMS）**に対応しています。

[ダウンロード（最新版）](https://github.com/NNDD-Rebuild/NNDD-RE/releases/latest){: .btn .btn-primary .fs-6 .mb-2 .mr-2 }
[インストール方法](/NNDD-RE/install/){: .btn .fs-6 .mb-2 }

Windows / Linux / macOS に対応しています。ベータ版は[リリース一覧](https://github.com/NNDD-Rebuild/NNDD-RE/releases)から入手できます。

## NNDD-RE を作った経緯

NNDD は、ニコニコ動画の動画をダウンロードしてライブラリとして管理できるソフトでした。しかし、Adobe AIR 製の従来の NNDD は、ニコニコ動画側の **新ニコニコAPI（V3 DMS）** への移行に対応しきれませんでした。

NNDD-RE は、この新APIに対応するため、Electron + TypeScript + React で一から作り直したものです。NNDD本体の改修ではなく、本家NNDDと互換性があることを目指した、「精神的後継」と呼んでいます。見た目や操作感を完全に再現したものではありません。

本家NNDDからの乗り換えは、[NNDDからの移行](/NNDD-RE/migrate-from-nndd/)を参照してください。

## はじめに

- [インストール・アップデート](/NNDD-RE/install/) — 入手方法、アップデート、外部ツール、データの保存先
- [使い方ガイド](/NNDD-RE/usage-guide/) — ログイン、ダウンロード、再生、自動ダウンロード
- [NNDDからの移行](/NNDD-RE/migrate-from-nndd/) — 本家NNDDの設定・マイリスト・ライブラリを引き継ぐ
- [よくある質問](/NNDD-RE/faq/)
- [トラブルシューティング](/NNDD-RE/troubleshooting/)

## タブ別ガイド

- [ランキング](/NNDD-RE/ranking/) — ジャンル別ランキング
- [検索](/NNDD-RE/search/) — キーワード・タグ検索、保存検索
- [フォロー中](/NNDD-RE/follow/) — フォロー中ユーザーの新着動画
- [生放送](/NNDD-RE/live/) — 生放送・追っかけ再生・タイムシフトの視聴、録画
- [マイリスト](/NNDD-RE/mylist/) — マイリスト・チャンネル・シリーズ・プレイリスト
- [DLリスト](/NNDD-RE/download/) — ダウンロードキューの管理、自動ダウンロード
- [ライブラリ](/NNDD-RE/library/) — ダウンロード済み動画のローカル管理
- [履歴・統計](/NNDD-RE/history/) — 視聴履歴と統計
- [プレイヤー](/NNDD-RE/player/) — 再生・コメント・連続再生・キーボード操作

## 設定・連携

- [設定](/NNDD-RE/settings/) — 全設定タブ・項目のリファレンス
- [内蔵HTTPサーバー・LAN共有](/NNDD-RE/http-server-integration/) — スマホや他のPCからの閲覧、Tailscale
- [GitHub同期・バックアップ](/NNDD-RE/github-sync/) — 複数端末での設定共有
- [Discord連携・Webhook通知](/NNDD-RE/discord-webhook/)
- [プライバシー](/NNDD-RE/privacy/) — 保存されるデータ、通信先、匿名の利用統計

開発環境の構築やビルド手順は [GitHubリポジトリのREADME](https://github.com/NNDD-Rebuild/NNDD-RE) を参照してください。

## 主な機能

### ダウンロード・再生

- 動画ダウンロード（既定では yt-dlp / FFmpeg なしで動作。ログイン情報で認証）
- ストリーミング再生（ニコニコのサーバーから直接再生。ニコニコ公式プレイヤーの埋め込みにも対応）
- 再生コントロール（画質切替、0.25x〜2.0x の倍速再生、音声のみ再生モード）
- 連続再生（次の動画の先読み、スキップボタン、検索結果やマイリストからの連続再生）
- コメント付きプレイヤー（流れるコメント描画、コメント一覧、NG設定）

### ライブラリ・検索

- ローカルライブラリ管理（フォルダ、タグ、お気に入り）
- キーワード・タグ検索、保存検索
- ランキング表示（24ジャンル × 5期間）
- 視聴履歴（アプリ内履歴とニコ動の視聴履歴を切り替えて表示）
- 統計ダッシュボード（月別ダウンロード数、日別視聴数、タグ別集計）

### マイリスト・チャンネル・フォロー

- マイリスト・チャンネル・ユーザー投稿・シリーズの登録と閲覧
- 自作プレイリスト（ニコニコの非公開マイリストと同期することもできます）
- フォロー中ユーザーの新着動画
- 自動ダウンロード（曜日と時刻を指定。マイリスト・シリーズ・フォロー中の投稿者が対象）

### 生放送

- 放送中の番組、追っかけ再生（プレミアム会員）、タイムシフトの視聴
- 放送中の番組の録画、録画予約、タイムシフトの保存
- フォロー中の放送者が放送を始めたときの通知

### バックアップ・連携

- GitHub Gist を使った設定の同期・バックアップ（複数のプロファイルを管理できます）
- 内蔵HTTPサーバー（スマホや他のPCのブラウザからライブラリを再生）
- LANライブラリ共有（別のNNDD / NNDD-REのライブラリを参照）
- Discord の Rich Presence、Webhook 通知

### その他

- NGリスト（コメントのNGワード / NGユーザーID / NGコマンド / 許可ID、ライブラリのNGタグ）
- システムトレイ常駐
- 自動アップデート
- 接続診断、ログビューア
