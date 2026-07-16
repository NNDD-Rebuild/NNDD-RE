---
title: 内蔵HTTPサーバー連携
---

# 内蔵HTTPサーバー（他アプリ連携）

設定 → 全般 → 内蔵HTTPサーバー「起動」をクリックすると `http://127.0.0.1:12345/` で稼働します。他のアプリケーションからNNDD-REのライブラリや動画にアクセスしたい場合に利用できます。

| エンドポイント | 用途 |
|---|---|
| `GET /health` | ヘルスチェック |
| `GET /api/library` | ライブラリ動画一覧（JSON） |
| `GET /api/mylist` | 登録マイリスト一覧（JSON） |
| `GET /api/video/:id` | 個別動画情報（JSON） |
| `GET /api/video/:id/stream` | 動画ストリーミング（Range対応） |
| `GET /api/video/:id/thumb` | サムネイル画像 |
| `GET /api/video/:id/comments` | コメント一覧（JSON） |
| `GET /library` | HTMLライブラリページ |
| `POST /NNDDServer` | 旧仕様XMLプロトコル（互換） |
| `GET /NNDDServer/:videoId` | 旧仕様 動画配信 |

同一LAN上の他のNNDD/NNDD-REインスタンスのライブラリを閲覧・再生する「LANライブラリ」機能も、この内蔵HTTPサーバーを利用しています。
