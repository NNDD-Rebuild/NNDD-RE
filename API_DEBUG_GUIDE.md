# Watch v3 API データダンプ ガイド

## 概要
動画ストリーミング時に取得する Watch v3 API の生データをJSONファイルに保存できます。

## 使用方法

### 環境変数で有効化（推奨）

#### Windows PowerShell の場合
```powershell
$env:DEBUG_API_DUMP="./apitest"
npm run dev
```

#### Windows CMD の場合
```cmd
set DEBUG_API_DUMP=./apitest
npm run dev
```

#### macOS/Linux の場合
```bash
export DEBUG_API_DUMP="./apitest"
npm run dev
```

### 動作確認

1. 上記コマンドでアプリを起動
2. 動画を再生（Watch v3 API が呼び出される）
3. プロジェクトルートの `./apitest` フォルダにJSONファイルが生成される

## 生成されるファイル形式

```
./apitest/
├── watch-v3-2026-06-02T10-30-45-123Z.json
├── watch-v3-2026-06-02T10-30-50-456Z.json
└── ...
```

### JSONファイルの構造

```json
{
  "timestamp": "2026-06-02T10:30:45.123Z",
  "url": "https://www.nicovideo.jp/api/watch/v3/sm12345678?actionTrackId=...",
  "response": {
    "data": {
      "video": { ... },
      "owner": { ... },
      "media": { ... },
      "comment": { ... },
      ...
    }
  }
}
```

## 複数API のダンプ

現在は Watch v3 API のみダンプしています。
将来的に以下のAPIにも対応可能です：

- DMS/DMC セッション確立 API
- コメント取得 API
- シリーズ情報 API

## トラブルシューティング

### ファイルが生成されない場合

1. `./apitest` フォルダが手動で作成されているか確認
   ```powershell
   mkdir apitest
   ```

2. 環境変数が正しく設定されているか確認
   ```powershell
   echo $env:DEBUG_API_DUMP
   ```

3. アプリケーションログを確認
   ```powershell
   cat "$env:APPDATA\NNDD\log\nndd.log"
   ```

### ファイルサイズが大きい場合

Watch v3 API レスポンスは数MB になることがあります。
複数の動画を再生すると、`apitest` フォルダが大きくなるため、
不要になったら削除してください。

## 注意事項

- APIダンプは **デバッグ目的** です
- 本番使用時はこの機能を無効にしてください（パフォーマンス低下の可能性）
- APIレスポンスに含まれるセッション情報などは **機密情報** です
