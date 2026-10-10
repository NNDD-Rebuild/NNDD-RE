# Tailscale 連携 開発手順書

内蔵 HTTP サーバーを、外出先から Tailscale 経由で視聴できるようにする。
作業を中断・再開しても迷わないための手順書。決定事項が変わったら更新する。

- 作業ブランチ: `feature/tailscale` (`main` から作成)
- サイドカー用リポジトリ: `NNDD-Rebuild/nndd-re-tailscale` (public, 作成は未完了。§7 参照)
- GitHub Pages は `docs/` を公開するので、開発用文書は `dev-docs/` に置く。
- 行番号は変わりやすいので、関数名・ファイル名で参照する(確認時点の行番号は括弧内)。

## 1. 背景と現状

- 実体は Electron main の Express サーバー `src/main/server/NnddHttpServer.ts`。
- bind は `allowExternal ? '0.0.0.0' : '127.0.0.1'`(L73)。`allowExternal` は constructor で確定する(L66)。既定ポート 12345。
- **認証なし。Host/Origin 検証なし。CORS 設定なし。** LAN 公開時は同一ネットワークの誰でもライブラリ・動画・コメントを取得できる。loopback bind のままでも、ブラウザ経由の DNS リバインディングや任意 Web ページからのリクエストは成立しうる。
- `POST /api/ipc`(`webPlayerBridge.ts`)は ALLOWED ホワイトリスト方式だが、`VIDEO_GET_WATCH_INFO` 等の `anyArgs` チャンネル(L40-44)はホスト側のニコニコ API をログイン Cookie で呼ぶ可能性がある(要確認)。**認証導入前は、到達できる端末すべてがこれを叩ける。**
- 配信は Range 対応の progressive HTTP。HLS ではない。
- `ServerStats.getAccessUrls(port, allowExternal)`(L107)は `string[]` を返し、種別を持たない。`VIRTUAL_NIC` 正規表現に `tailscale` が含まれ、現状 Tailscale の NIC は「仮想」扱いで後ろに並ぶ。IPv4 のみ。
- 呼び出し側: `NnddHttpServer.ts` のラッパー(L120)と `urls` 出力(L411-420)、`headlessDashboard.ts`(L31)、renderer 側の型。
- 設定 UI: `HttpServerSection.tsx`。設定キー `httpServer.*`(`ConfigStore.ts` L294-303 型、L494-501 既定値)。`allowExternal` は boolean。
- 起動オプション: `util/headless.ts` の `--headless` / `--allow-external` / `--port`(`forceAllowExternal`)。起動/停止 IPC は `ipc/handlers/http.ts`。
- 他 NNDD を参照するクライアント: `LanLibraryClient.ts` は `http://${address}:${port}/NNDDServer` に認証なしで fetch する。旧 NNDD(Flex/AIR)本家クライアントは Cookie やヘッダーを付けられない。
- 旧 XML API の `videoUrl` は `req.socket.localAddress` ベース(`buildNNDDREVideoByIdXml` 内、L589)。
- 外部ツール基盤: `util/BinaryInstaller.ts`(yt-dlp / ffmpeg の DL・更新)と `ExternalToolsSettings.tsx`。
  - **SHA256 検証は fail-open**: `fetchExpectedSha256`(L295-306)は、チェックサムが見つからない/取得失敗の場合に `skip verification` で続行する。
  - チェックサムのファイル名が配布元ごとに異なる(yt-dlp: `SHA2-256SUMS`、ffmpeg: `checksums.sha256`)。

## 2. 方針(決定事項)

1. 公開トンネル(ngrok / Cloudflare Tunnel / Funnel)は採用しない。無認証サーバーを公衆網に出さない。KonomiTV も Tailscale のみサポート。
2. 閲覧側にも Tailscale が必要という前提は変わらない。
3. **認証とアクセス制御を先に入れる。** Tailscale 公開機能は、その後で出す(同時リリースでも可。先行は不可)。
4. 「tailnet 内は信頼できる」は前提にしない。家族や他人の端末がいる共有 tailnet でも安全にする。
5. 独立端末(サイドカー)は同梱しない。設定画面でオンにしたときだけ取得する。ただし着手判断は §8 の基準で行う。
6. サイドカーのビルドは別リポジトリで行う。本体のリリースタグや `electron-updater` と分離するため。

## 3. フェーズ

| フェーズ | 内容 | 状態 |
|---|---|---|
| 1 | アクセス制御: Host 検証(全モード)、トークン + Cookie 認証、ログのマスク | 未着手 |
| 2 | 既存 Tailscale の検出と表示、bind モード `loopback / lan / tailscale` | 未着手 |
| 3 | (任意) `tailscale serve` 連携 | 未着手 |
| 4 | (任意) 独立端末: tsnet サイドカー | 未着手。§8 の基準で着手判断 |

### フェーズ 1: アクセス制御

**Host 検証(全モードで常時適用。loopback でも)**
- 許可: `localhost`、`127.0.0.1`、検出した各 LAN / Tailscale IP、MagicDNS 名。`Host` の `:port` と IPv6 の `[...]` 形式を正規化する。
- 許可リストは bind モード変更・IP 変更時に更新する。旧 XML API の `localAddr` と同じ情報源を使う。
- 「外部公開時のみ必須」にしない。loopback モードの DNS リバインディング対策も兼ねる。

**トークン認証**
- ランダム生成(十分な長さ)、設定画面で再生成可能。比較は `crypto.timingSafeEqual`。失敗時のレート制限を入れる。
- 保存先は `ConfigStore` ではなく `safeStorage` で保護する。
- `<video>` / `<img>` はヘッダーを付けられない(`/api/video/:id/stream`、`/thumb`、`/api/local-media`、`express.static` 等)。**Cookie 方式が必須。**
  - QR の URL に初回トークンを載せる → アクセス時に Cookie へ引き換えて、直ちにリダイレクトして URL から消す(Referer 漏洩対策)。
  - Cookie は `HttpOnly`、`SameSite=Lax` 以上。HTTP では `Secure` を付けられない点を明記する(`tailscale serve` の HTTPS 経由なら付けられる)。
- ログのマスク: `req.url` を出力している箇所(L135)とアクセスログで `token` クエリを伏せる。

**除外パスの確定**
- 除外は `/health` のみ。`/status` と `/api/status` は URL と QR を返すので**認証対象**。
- `POST /api/ipc` は認証対象に加え、Origin 検証を入れる。

**認証の適用範囲(決定)**
- 対象は NNDD-RE 本体のみ。**旧 NNDD(本家)クライアントとの互換は考慮しない。**
- `loopback` モード: Host 検証のみ(トークンなし。従来どおり)。
- `lan` モード: 現状どおり**認証なし**(Host 検証のみ)。もともと認証が無いので、LAN モードにオプトアウトの概念は不要。警告 UI も出さない(Tailscale 自体を初心者は触らない前提)。将来の任意機能として「LAN でもトークンを要求する」トグルを検討する。
- `tailscale` モード(および Serve / サイドカー経由): **トークン必須**。
- 判定は `remoteAddress` ではなく、bind モードに基づく。
- `/NNDDServer*` は RE 同士の LAN ライブラリ参照(`LanLibraryClient.ts`)が使う。`tailscale` モードの接続先に対して使えるよう、`LanLibraryClient.ts` に接続先のトークン設定欄を追加する。
- Host 検証は LAN モードでも適用する。`.local`(mDNS)名など、ユーザーが LAN で使う名前を弾かないよう許可リストを設計する(要確認)。

### フェーズ 2: Tailscale の検出と bind モード

**bind モード**
- 新キー `httpServer.bindMode: 'loopback' | 'lan' | 'tailscale'` を追加する。`allowExternal` は後方互換のため残し、`bindMode` が無い設定からは `allowExternal` で導出する(マイグレーション)。優先順位を明記する。
- `--allow-external` は `bindMode=lan` を強制する。`--headless` の既存動作を変えない。ヘッドレスで `tailscale` を指定する CLI 引数が必要かを決める。
- `ConfigStore.ts` の型・既定値(L294-303、L494-501)を更新する。

**Tailscale IP の取得**
- `os.networkInterfaces()` から 100.64.0.0/10 を検出する(IPv4)。IPv6(`fd7a:`)は対象外と明記する。
- `getAccessUrls` の戻り値を `{ url, kind: 'loopback' | 'lan' | 'tailscale' }[]` に変更する。引数も bool 2 値から bind モードに変更する。呼び出し側(`NnddHttpServer.ts` L120・L411-420、`headlessDashboard.ts` L31、renderer の型)を洗い出して更新する。
- 並び順は LAN の下でよい。`VIRTUAL_NIC` の `tailscale` 扱いを整理する。

**起動ポリシー**
- OS 起動直後は Tailscale が未接続で IP が無い。`tailscale` モードで IP 未検出のとき、`--headless` 自動起動が失敗し続けないよう、再試行/待機のポリシーを決める(例: 一定間隔で再検出し、検出できたら bind)。
- IP 変更・再接続時は再 bind する。bind モード変更時はサーバー再起動が必要(`ipc/handlers/http.ts` の再起動経路)。

**UI・文書**
- `HttpServerSection.tsx`: 既存の `allowExternal` トグルと整合させて、bind モード選択に置き換える。URL/QR 表示に kind を表示。
- HTTP の 100.x は secure context にならず、一部ブラウザ API が制限される点を注記する(フェーズ 3 の HTTPS で解消)。
- `docs/http-server-integration.md`、`docs/settings.md`、`headlessDashboard.ts` の表示を更新する。

### フェーズ 3: Serve 連携(任意)
- `tailscale serve` を CLI から実行。**専用ポートを使い、自分が設定したエントリだけを off にする。`serve reset` は呼ばない。**
- 起動前に `tailscale serve status` を確認し、既存設定と衝突するなら中止して知らせる。
- CLI パスを OS ごとに解決(Windows: `Program Files\Tailscale`、macOS: `.app` 内、Linux: PATH)。見つからなければフェーズ 2 にフォールバック。
- Host 検証の許可リストに MagicDNS 名を追加する。
- プロキシ経由だと全リクエストが loopback に見える。`app.set('trust proxy')` は未設定なので `req.ip` が潰れ、接続台数集計(`NnddHttpServer.ts` L128)が 1 台になる。信頼する範囲を限定して `X-Forwarded-*` を扱う(安易に有効化すると IP 偽装が可能)。
- `Tailscale-User-Login` ヘッダーを使う場合は、フェーズ 4 と同じ共有シークレット方式で信頼を担保する。
- `buildNNDDREVideoByIdXml` の `req.socket.localAddress` ベースの URL 生成を見直す。

### フェーズ 4: 独立端末(サイドカー)

**サイドカー側(別リポジトリ)**
- Go 製。`tailscale.com/tsnet` で独立ノードを作り、`127.0.0.1:<port>` の RE サーバーへリバースプロキシする。
- 引数: `--state-dir`, `--hostname`, `--upstream`。Auth key は argv ではなく stdin で受け取る。
- 制御プロトコル(案): stdout に 1 行 1 JSON のイベント(`status` / `auth_url` / `ready` / `error`)、stdin にコマンド(`logout` / `stop`)。プロトコルにバージョンを持たせる。
- **信頼の担保**: 起動ごとにランダムな共有シークレットを RE 本体が生成し、stdin で渡す。サイドカーは転送するリクエストにこのシークレットをヘッダーで付ける。RE 側はシークレットが合う場合のみ `Tailscale-*` ヘッダーを信頼する。**loopback から来た、というだけでは信頼しない**(同一 PC のプロセスやブラウザが loopback になるため)。可能なら Unix ドメインソケット / 名前付きパイプを検討する。
- 受信リクエストの `Tailscale-*` ヘッダーはサイドカーがすべて除去し、`WhoIs` の結果から付け直す。
- ビルド対象: windows-amd64, darwin-amd64, darwin-arm64, linux-amd64。`-ldflags="-s -w"`。
- リリース資産: `nndd-re-tailscale-<os>-<arch>[.exe]` と `SHA256SUMS`。

**本体側**
- `BinaryInstaller` に `installTailscale()` を追加する。`process.platform` / `process.arch` で資産名を決める。
- **サプライチェーン対策(必須)**:
  - 取得元は `releases/latest/download` ではなく、**本体にバージョンと SHA256 を埋め込んでピン留めする**。`SHA256SUMS` が同じリリースにあるだけでは改ざん検知にならない。
  - **検証は fail-closed**。ハッシュが取れない・一致しない場合は配置も実行もしない。既存の `fetchExpectedSha256` の fail-open をそのまま流用しない。
  - 署名(minisign / cosign)の検証を追加するかを検討する。
  - 上流追従の自動ビルドは、ビルド済みを即 `latest` にしない。本体側のピン更新(PR)を経由させる。
- `BinaryStatus` に `tailscale`(found / path / version)を追加。`ExternalToolsSettings.tsx` に項目を追加する。
- ログイン UI: 認証 URL の表示、Auth key 入力、端末名、ログアウト(tailnet からの端末削除)。バイナリ削除とログアウトは別操作。
- **Auth key**: 使い捨て・期限付き・非 reusable を推奨する。UI で入力した key は保存せず、使用後に破棄する。
- **状態ディレクトリ**: `userData` 配下に置く。tsnet が書くノード鍵ファイルは `safeStorage` では暗号化できない(tsnet 自身が保存する)。OS のファイル権限(0700)で守る。`safeStorage` で保護できるのは、RE 側が保持する Auth key / アクセストークン等。
- ACL / タグ(例 `tag:nndd-re`)で到達できる端末を絞る運用をドキュメント化する。
- プロセス監視: クラッシュ時の再起動、アプリ終了時の停止、ゾンビ化防止。
- macOS arm64 の署名・quarantine の挙動は実機で確認する。

## 4. 検証

CI(`.github/workflows/ci.yml`)と同じ確認をローカルで通してから push する。

```
npm ci
npm run tc:all
npm run check:ipc
npm run build
```

手動確認(CI は ubuntu のみのため、Win / Mac は実機で):
- Tailscale 参加端末から `/library` を開き、動画再生とシーク(Range)ができる。
- 非参加端末・LAN 側からは到達できない(`tailscale` モード)。
- トークン無し / 誤トークン、Host 不一致、`POST /api/ipc` の認証失敗(403)が拒否される。
- 旧 XML API(`videoUrl` が bind モードに応じた IP を返す)と `LanLibraryClient` の疎通。
- `--headless --allow-external` が従来どおり動く。Tailscale 未接続での起動と、後からの接続。
- ログにトークンが出ない。

## 5. 運用ルール

- ブランチは `<type>/<slug>`(例 `feature/tailscale`, `fix/xxx`)。コミット prefix(`feat:` / `fix:` / `docs:`)と揃える。コミットメッセージは既存に倣い日本語。
- フェーズごとに PR を分ける。1 PR 1 目的。
- 新リポジトリ側にも同じ命名ルールを適用する。

## 6. リスクと未確認事項

- Tailscale の無料枠の端末数・ユーザー数の上限は、現行値を公式で確認する(独立端末は 1 台消費する)。
- tsnet サイドカーの実サイズは未測定(推定 25〜35MB/OS)。ビルドして測る。
- macOS arm64 での DL 実行ファイルの署名要件。
- Funnel の帯域制限は非公開。動画用途では使わない。
- Cloudflare Tunnel は CDN 経由の動画配信が規約上グレー。採用しない。
- `anyArgs` チャンネルがログイン Cookie で何を呼べるか(要確認)。

## 7. リポジトリ作成の状況

- `NNDD-Rebuild/nndd-re-tailscale`(public)の作成は、このセッションの GitHub 権限では 404 で失敗した。GitHub 上で作成した後に、セッションへ追加する。
- ライセンスは本体(`package.json` の `license: MPL-2.0`)に合わせて MPL-2.0 を第一候補とする。サイドカーは Tailscale(BSD-3-Clause)の依存を含むため、配布物に Tailscale の著作権表示とライセンス文(`THIRD_PARTY_NOTICES`)を同梱する。

## 8. フェーズ 4 の着手判断基準

フェーズ 1〜3 は既存の Tailscale を使い、多くの利用者を満たせる。フェーズ 4 は工数が他の数倍になる(別リポジトリ、4 OS/arch のクロスビルド、macOS 署名・notarize、上流追従、制御プロトコル、プロセス監視、ログイン UI、実機テスト)。次のいずれかが確認できたら着手する。

- 「Tailscale を PC に入れたくない」という要望がある。
- RE 専用の端末名・タグ・ACL で管理したい要望がある。
- フェーズ 1〜3 の運用で、既存 Tailscale 利用では解決できない問題が出た。

## 9. 未決事項

- フェーズ 3 を実施するか(フェーズ 1・2 の後で判断)。
- サイドカーの端末名の既定値(`nndd-re` か `nndd-re-<PC 名>`)。
- LAN モードでトークンを任意で要求するトグルを作るか(将来)。
- LAN モードの Host 検証で許可する名前の範囲(`.local` 等)。
