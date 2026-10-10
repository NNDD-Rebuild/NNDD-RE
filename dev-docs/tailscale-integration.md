# Tailscale 連携 開発手順書

内蔵 HTTP サーバーを、外出先から Tailscale 経由で視聴できるようにする。
作業を中断・再開しても迷わないための手順書。決定事項が変わったら更新する。

- 作業ブランチ: `feature/tailscale`(PR: NNDD-Rebuild/NNDD-RE#6)
- サイドカー用リポジトリ: [NNDD-Rebuild/nndd-re-tailscale](https://github.com/NNDD-Rebuild/nndd-re-tailscale)(public, MPL-2.0)
- GitHub Pages は `docs/` を公開するので、開発用文書は `dev-docs/` に置く。

## 1. 方針(決定事項)

1. 公開トンネル(ngrok / Cloudflare Tunnel / Funnel)は採用しない。無認証のサーバーを公衆網に出さない。KonomiTV も Tailscale のみサポート。
2. **アプリ側に認証(アクセストークン)は持たない。** アクセスできる端末は Tailscale の ACL(管理画面)で絞る。ACL はネットワーク層で効き、端末・ユーザー・ポート単位で、いつでも変えられる。LAN 内は従来どおり無認証(信頼できるネットワークとして公開)。
3. **Host / Origin 検証は全モードで常時適用する**(DNS リバインディング・CSRF 対策。ACL では防げない)。
4. 待受範囲は 3 つだけにする。

| 待受範囲 | 内容 |
|---|---|
| このPCのみ(`loopback`) | 既定。127.0.0.1 |
| LAN公開(`lan`) | 0.0.0.0。**PC に Tailscale が入っていれば、同じ設定で Tailscale 経由(100.x.x.x)でも届く。** 画面に Tailscale の URL も表示 |
| Tailscale(`tailscale-node`) | PC に Tailscale を入れない人向け。**LAN公開に加えて**、RE 専用の端末(tsnet サイドカー)として tailnet に参加。LAN 内の IP でも入れる(サイドカーは 127.0.0.1 へ転送) |

5. 次の機能は作らない(検討の結果、削除した): アクセストークン認証 / 「Tailscale の IP にだけバインド」/ `tailscale serve` による HTTPS 公開 / サイドカーの HTTPS(443)公開・一時的な端末。tailnet 内は WireGuard で暗号化されるので HTTP でも盗聴の心配はなく、動画の再生に HTTPS は不要。
6. 閲覧側にも Tailscale が必要という前提は変わらない。
7. サイドカーは同梱せず、設定画面でオンにしたときだけ取得する。ブランチは `<type>/<slug>`、コミットは `feat:` / `fix:` と揃える。

## 2. 実装の要点

### Host / Origin 検証(`src/main/server/accessControl.ts`)
- 許可する Host: IP リテラル、`localhost`、ドットなしの単一ラベル名、`*.local`、`*.ts.net`、PC 名、設定 `httpServer.allowedHosts`。攻撃者のページは自分の公開ドメイン(ドット付き)経由でしか届かないことを利用する。
- Origin ヘッダーがある場合は Host と同一オリジンのみ許可する。
- ボディ解析より前に置く。

### 待受範囲(`NnddHttpServer.ts`, `ServerStats.ts`, `ConfigStore.ts`)
- `httpServer.bindMode`(`loopback | lan | tailscale-node`)。**既定値は持たせない(`undefined`)**: 既定値があると旧設定 `allowExternal=true` からの導出(`resolveBindMode`)が効かなくなる。キー自体は `CONFIG_SET` の許可判定(DEFAULT_CONFIG に存在するキーのみ通す)のために `DEFAULT_CONFIG` へ `undefined` で置く。UI は `bindMode` と `allowExternal` を同期して書く。
- `--allow-external` は「このPCのみ」を LAN 公開に引き上げる。
- 設定画面の LAN 公開では、`os.networkInterfaces()` から Tailscale の IP(100.64.0.0/10。NIC 名が `tailscale` / `utun` のものを優先。IPv4 のみ)を検出して URL を表示する。
- 旧 XML API の `videoUrl` は、検証済みの Host ヘッダーから作る。

### Tailscale(サイドカー)
- サイドカー(`nndd-re-tailscale`): Go + tsnet。転送先は loopback の IP リテラルのみ。`WhoIs` で接続元を確認し、`Tailscale-User-Login` / `Tailscale-Node-Name` を付け直し、起動ごとの共有シークレット(`X-Nndd-Sidecar-Secret`)を付与する。Auth key・共有シークレットは stdin で渡す(argv に載せない)。stdin EOF で停止。制御プロトコルは v1(同リポジトリの README)。
- 本体: `TailscaleSidecar`(子プロセス管理)/ `SidecarInstaller`(取得・検証・削除)/ `sidecarPin.ts`(ピン)。
  - **取得は `sidecarPin.ts` にピン留めしたバージョン + SHA256 だけ**。未設定なら取得も実行も拒否(fail-closed)。起動のたびにハッシュを再照合する。`latest` は使わない。
  - 共有シークレットが一致したリクエストだけ、サイドカーが付けた `X-Forwarded-For` を接続元として信頼する(`createSidecarTrust`)。loopback から来た、というだけでは信頼しない。
  - 起動(`exposure.start`)は待たずに IPC を返す。サイドカーは異常終了時に最大 5 回再起動する。アプリ終了時に止める(`shutdownHttpServer`)。
- 秘密情報(Auth key)は `SecretStore`(`safeStorage`)に置く。**`httpServer` は GitHub Gist バックアップの同期対象なので、秘密情報を ConfigStore に置かない。** 公開範囲に関わる設定(`bindMode` / `allowedHosts`)は端末固有なので、バックアップに含めず、復元でもローカルの値を保持する。
- ACL の例(RE の端末を `tag:nndd-re` にして、自分の端末だけに許可): `{ "action": "accept", "src": ["autogroup:member"], "dst": ["tag:nndd-re:80"] }`。タグ付きの Auth key を「外部ツール」で入力する。tailnet の既定の ACL は「全員を許可」なので、1 人で使う分には問題ないが、共有する場合は絞ること。

## 3. 検証

CI(`.github/workflows/ci.yml`)と同じ確認をローカルで通してから push する。

```
npm ci
npm run tc:all
npm run check:ipc
npm run build
```

実施済み(サンドボックス): 上記 3 つ、Host / Origin ガードと共有シークレット信頼の結合テスト(使い捨てスクリプト)、偽のサイドカーでのプロセス管理(ピン未設定・ハッシュ不一致・バージョン違い・正常系・プロトコル不一致・クラッシュ時の再起動・ログアウト)、実リリース `v0.1.0`(linux/amd64)の取得 → SHA256 検証 → 改ざん検知 → 再取得 → 実バイナリ起動(プロトコル v1 の hello を受理、`needs_login` へ遷移)。

**未確認(実機で確認する)**: Tailscale へのログイン・接続・他端末からの再生、Windows / macOS での取得と起動、設定画面の見た目。

## 4. サイドカーのリリースと追従

### リリース
- Actions の `release` を **Run workflow(タグ名を入力)** で作る。`main` の最新コミットから、4 ターゲット(linux/amd64、windows/amd64、darwin/amd64、darwin/arm64)をビルドし、`SHA256SUMS` 付きの prerelease を作る。
- 画面から先にリリース(タグ)を作らない。タグ push でも workflow が動いて `gh release create` が衝突する(修正ブランチ `fix/release-existing` は既存リリースへの添付に対応)。
- ピンの更新: `node scripts/update-sidecar-pin.mjs v0.1.0`。各バイナリを取得して自前でハッシュを計算し、`SHA256SUMS` と突き合わせてから `sidecarPin.ts` を書き換える。差分(バージョンと 4 つのハッシュだけ)をレビューしてコミットする。`v0.1.0` は設定済み。

### 自動追従(PR を作るところまで。マージは人)
- サイドカー側 `update-tailscale.yml`: 毎週月曜 日本時間 5:00(`0 20 * * 0` UTC)に `tailscale.com@latest` を確認し、更新があれば gofmt / vet / test / 4 ターゲットのビルドを通して `chore/update-tailscale-<ver>` の PR を作る。マージ後に release を手動実行する。
- 本体側 `update-sidecar-pin.yml`: 毎週月曜 日本時間 6:00(`0 21 * * 0` UTC)にサイドカーの最新リリース(prerelease なので一覧の先頭を取る)を確認し、ピンと違えば `scripts/update-sidecar-pin.mjs` で更新して tc:all / check:ipc を通し、`chore/update-sidecar-<tag>` の PR を作る。
- **自動マージはしない**: ピンは利用者の PC で実行されるバイナリを決める。CI ではログイン・接続の動作確認ができない。
- 両リポジトリで Settings → Actions → General →「Allow GitHub Actions to create and approve pull requests」を有効にする。`GITHUB_TOKEN` が作った PR では他の workflow が動かないため、検証は各 workflow の中で行っている。Actions が作るコミットは `github-actions[bot]`(署名なし)だが、GitHub の Web で squash マージすれば、マージコミットは GitHub が署名する。
- プロトコルを非互換に変えるリリースは、人が本体の `SIDECAR_PROTOCOL` と同時に直す(自動では行わない)。

## 5. リスクと未確認事項

- 検証後・実行前のバイナリ差し替えは防げない(同一ユーザー権限の攻撃者に限る。その権限があれば本体自体を改変できる)。
- リリース workflow の GitHub Actions はタグ指定(コミット SHA への固定は未実施)。
- Tailscale の無料枠の端末数・ユーザー数の上限は、現行値を公式で確認する(サイドカーは 1 台消費する)。
- tsnet サイドカーの実サイズは 20〜22MB/OS(`-s -w -trimpath`、実測)。
- LAN 公開は無認証のまま(従来どおり)。tailnet の ACL を既定のまま(全員許可)にして他人と共有する場合は、`/api/ipc` の一部の読み取り系(ニコニコ API を呼ぶもの)に他人の端末から届く。ACL で絞ること。
- macOS arm64 での、取得した実行ファイルの署名要件(実機で確認)。
