# Tailscale 連携 開発手順書

内蔵 HTTP サーバーを、外出先から Tailscale 経由で視聴できるようにする。
この文書は作業を中断・再開しても迷わないための手順書。決定事項が変わったら更新する。

- 作業ブランチ: `feature/tailscale` (`main` から作成)
- サイドカー用リポジトリ: `NNDD-Rebuild/nndd-re-tailscale` (public)
- GitHub Pages は `docs/` を公開するので、開発用文書は `dev-docs/` に置く。

## 1. 背景と現状

- 実体は Electron main の Express サーバー `src/main/server/NnddHttpServer.ts`。
- bind は `allowExternal ? 0.0.0.0 : 127.0.0.1`(L73)。既定ポート 12345。
- **認証なし。Host/Origin 検証なし。** LAN 公開時は同一ネットワークの誰でもライブラリ・動画・コメントを取得できる。
- 配信は Range 対応の progressive HTTP。HLS ではない。
- `ServerStats.getAccessUrls()` は LAN の IPv4 だけを列挙する。
- 設定 UI: `src/renderer/components/settings/general/HttpServerSection.tsx`。設定キー `httpServer.*`(`ConfigStore.ts`)。
- 外部ツール基盤: `src/main/util/BinaryInstaller.ts`(yt-dlp / ffmpeg の DL・SHA256 検証・更新)と `ExternalToolsSettings.tsx`。

## 2. 方針(決定事項)

1. 公開トンネル(ngrok / Cloudflare Tunnel / Funnel)は採用しない。無認証サーバーを公衆網に出さない。KonomiTV も Tailscale のみサポート。
2. 閲覧側にも Tailscale が必要という前提は変わらない。
3. 段階導入する。

| フェーズ | 内容 | 状態 |
|---|---|---|
| 1 (C-1) | 既存 Tailscale の IP(100.64.0.0/10)を検出して URL / QR に表示。bind を「Tailscale IP のみ」に限定できる選択肢を追加 | 未着手 |
| 2 | アクセス制御: トークン認証、Host ヘッダー検証 | 未着手 |
| 3 | (任意) `tailscale serve` 連携(C-2) | 未着手 |
| 4 | オプトインの独立端末: サイドカー(`tsnet`)を外部ツールとして DL・更新・削除・ログイン | 未着手 |

4. 独立端末(フェーズ 4)は **同梱しない**。設定画面でオンにしたときだけ取得する(インストーラを太らせない)。
5. サイドカーのビルドは別リポジトリ(`nndd-re-tailscale`)で行う。本体のリリースタグや `electron-updater` と分離するため。

## 3. フェーズ別手順

### フェーズ 1: Tailscale IP の検出と表示
- `src/main/server/ServerStats.ts` の `getAccessUrls()` に、100.64.0.0/10 のアドレスを `tailscale` 種別として追加。並び順は LAN より下でよい。
- MagicDNS 名は取得できる場合のみ表示(CLI が使えるときのみ。使えなければ IP のみ)。
- `NnddHttpServer.ts` の bind 選択を `loopback | lan | tailscale` に拡張する。`tailscale` は検出した Tailscale IP にのみ bind。未検出なら起動せずエラーを返す。
- `ConfigStore.ts` に設定追加(既存の `allowExternal` との互換を保つ。マイグレーション要否を確認)。
- `HttpServerSection.tsx` に選択 UI と案内文を追加。`docs/http-server-integration.md` と `docs/settings.md` を更新。
- IPC / 型を足す場合は `npm run check:ipc` を通す。

### フェーズ 2: アクセス制御
- アクセストークン(ランダム生成、設定で再生成可能)。ヘッダーまたは Cookie で受け付け、QR の URL に初回トークンを埋め込む。
- Host ヘッダー検証(許可: 検出した各 IP、MagicDNS 名、`localhost`)。DNS リバインディング対策。
- 既存クライアントの互換(旧 NNDD 互換 XML API、LAN ライブラリのリモート参照)を壊さない。トークンは「外部公開時のみ必須」など段階的に。
- `/health` などの除外パスを決める。

### フェーズ 3: Serve 連携(任意)
- `tailscale serve` を CLI から実行。**専用ポートを使い、自分が設定したエントリだけを off にする。`serve reset` は呼ばない。**
- 起動前に `tailscale serve status` を確認し、既存設定と衝突するなら中止してユーザーに知らせる。
- CLI のパスを OS ごとに解決(Windows: `Program Files\Tailscale`、macOS: `.app` 内、Linux: PATH)。見つからなければフェーズ 1 にフォールバック。
- プロキシ経由でも URL が崩れないよう `X-Forwarded-*` を扱う。`NnddHttpServer.ts` L590 の `req.socket.localAddress` ベースの URL 生成を見直す。

### フェーズ 4: 独立端末(サイドカー)
サイドカー側(別リポジトリ):
- Go 製。`tailscale.com/tsnet` で独立ノードを作り、`127.0.0.1:<port>` の RE サーバーへリバースプロキシする。
- 引数: `--state-dir`, `--hostname`, `--upstream`。Auth key は argv ではなく stdin で受け取る(プロセス一覧への漏洩防止)。
- 制御プロトコル(案): stdout に 1 行 1 JSON のイベント(`status` / `auth_url` / `ready` / `error`)、stdin にコマンド(`logout` / `stop`)。プロトコルにバージョンを持たせる。
- 受信リクエストの `Tailscale-*` ヘッダーを一度すべて除去し、`WhoIs` の結果から付け直す。RE 側は loopback からのみこのヘッダーを信頼する。
- ビルド対象: windows-amd64, darwin-amd64, darwin-arm64, linux-amd64。`-ldflags="-s -w"`。
- リリース資産: `nndd-re-tailscale-<os>-<arch>[.exe]` と `SHA256SUMS`。
- 上流 Tailscale 追従: 定期ジョブで新しい上流タグを検出し、再ビルドして Release を出す。

本体側:
- `BinaryInstaller` に `installTailscale()` を追加。`process.platform` / `process.arch` で資産名を決定、`SHA256SUMS` で検証、非 Windows は `chmod 755`。取得元は `nndd-re-tailscale` の `releases/latest/download/...`。
- `BinaryStatus` に `tailscale`(found / path / version)を追加。
- `ExternalToolsSettings.tsx` に項目を追加。DL・更新・削除は yt-dlp と同じ操作感にする。
- ログイン UI: 認証 URL の表示、Auth key 入力、端末名、ログアウト(tailnet からの端末削除)。バイナリ削除とログアウトは別操作にする。
- 状態ディレクトリは `userData` 配下。認証情報は `safeStorage` で保護する。
- macOS arm64 の署名・quarantine の挙動は実機で確認する。

## 4. 検証

CI(`.github/workflows/ci.yml`)と同じ確認をローカルで通してから push する。

```
npm ci
npm run tc:all
npm run check:ipc
npm run build
```

手動確認:
- 同一 PC / 別 PC(Tailscale 参加端末)から `/library` を開き、動画再生とシークができる(Range)。
- Tailscale 非参加端末、LAN 側からは到達できない(bind を `tailscale` にした場合)。
- 既存の LAN ライブラリ参照とヘッドレス起動(`--headless --allow-external`)が従来どおり動く。
- Windows / macOS / Linux で確認(CI は ubuntu のみ)。

## 5. 運用ルール

- ブランチは `<type>/<slug>`(例 `feature/tailscale`, `fix/xxx`)。コミット prefix(`feat:` / `fix:` / `docs:`)と揃える。
- コミットメッセージは既存に倣い日本語、`feat:` / `fix:` で始める。
- フェーズごとに PR を分ける。1 PR 1 目的。
- 新リポジトリ側にも同じ命名ルールを適用する。

## 6. リスクと未確認事項

- Tailscale の無料枠の端末数上限は未確認(独立端末は 1 台消費する)。
- tsnet サイドカーの実サイズは未測定(推定 25〜35MB/OS)。ビルドして測る。
- macOS arm64 での DL 実行ファイルの署名要件。
- Funnel の帯域制限は非公開。動画用途では使わない。
- Cloudflare Tunnel は CDN 経由の動画配信が規約上グレー。採用しない。
- トークン導入時の既存クライアント互換。
- 上流追従の自動化(Renovate か cron か)。

## 7. 未決事項

- フェーズ 3(Serve 連携)を実施するか。フェーズ 1・2 の後で需要を見て判断。
- サイドカーの端末名の既定値(`nndd-re` か `nndd-re-<PC 名>` か)。
- 認証トークンの有効範囲(LAN 公開時も必須にするか)。
