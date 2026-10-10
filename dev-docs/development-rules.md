# NNDD-RE 開発ルール

Claude Code など、AI に作業を頼むときの前提です。人が作業するときも同じルールで進めます。(`CLAUDE.md` は .gitignore の対象なので、この内容は `dev-docs/` に置いています。AI に自動で読ませたい場合は、各自のローカルの `CLAUDE.md` にコピーしてください。)

## ブランチ
- `<type>/<短い英語スラッグ>` で切る。type はコミットの prefix と揃える: `feature/` `fix/` `docs/` `refactor/` `chore/` `test/`。
  - 例: `feature/tailscale`、`fix/comment-ng-list`
- 小文字・ハイフン区切り。日本語・空白・日付は使わない。切り元は原則 `main` の最新。
- 履歴の書き換え (rebase / amend / filter-branch) と force push は、**明示的に許可されたときだけ**行う。行うときは `--force-with-lease` で、事前に確認したハッシュを指定する。

## コミット
- メッセージは日本語。`feat:` / `fix:` / `docs:` / `refactor:` / `chore:` / `ci:` で始める。1 コミット 1 目的。
- 作者・コミッターは **`NNDD-Rebuild <nndd-re@nks-s.jp>`**。Claude などの名義、`Co-Authored-By`、セッション URL の表記は付けない。
- 署名する場合は、NNDD-Rebuild のアカウントに登録した鍵を使う (環境の既定の署名ヘルパーは使わない)。

## プルリクエスト
- タイトル・本文は日本語。Claude などの署名・リンクは入れない。
- PR は頼まれたときだけ作る。マージは人が行う (squash マージにすると GitHub が署名する)。
- 本文は「概要 / 変更内容 / 動作確認 (確認済み・未確認を分ける) / マージ後のお願い」の構成にする。**確認していないことを「確認済み」と書かない。**

## 出す前の確認
CI (`.github/workflows/ci.yml`) と同じ確認を通す。

```
npm ci
npm run tc:all
npm run check:ipc
npm run build
```

## コードの注意点
- 設定画面は `src/renderer/components/settings/common.tsx` の共通部品 (`Section` `Card` `Row` `CheckRow` `RadioGroup` `CommitInput` `NumberCommitInput` `Btn` など) で書く。各タブで個別に Tailwind を書かない。
- renderer から `CONFIG_SET` できるのは `DEFAULT_CONFIG` に存在するキーだけ (`isIpcConfigKey`)。新しい設定は既定値 (省略可能な値は `undefined`) を `DEFAULT_CONFIG` に置く。
- **秘密情報は ConfigStore に置かない。** `httpServer` などは GitHub Gist バックアップの同期対象 (`BackupManager.SYNCABLE_CONFIG_KEYS`)。秘密情報は `SecretStore` (`safeStorage`)。端末固有の設定 (`bindMode` / `allowedHosts`) はバックアップに含めない。
- `bindMode` は既定値を持たせない (旧設定 `allowExternal` からの導出のため)。

## Tailscale 連携
- 設計・判断・実装メモ・リリース手順は [tailscale-integration.md](tailscale-integration.md) にある。まずこれを読む。
- アプリ側に認証は持たない。アクセスの絞り込みは Tailscale の ACL に任せる。Host / Origin 検証は常時有効 (外さない)。
- サイドカー (`NNDD-Rebuild/nndd-re-tailscale`) は、`sidecarPin.ts` にピン留めしたバージョンと SHA256 のものだけを取得・実行する。`latest` を使わない・検証を緩めない (fail-closed)。
- サイドカーのリリースは Actions の `release` を **Run workflow (タグ名を入力)** で作る。画面から先にリリースを作らない。ピン更新は `node scripts/update-sidecar-pin.mjs <タグ>`。
- 毎週月曜に、サイドカー側 (日本時間 5:00) と本体側 (6:00) が更新の PR を自動で作る。マージは人が行い、自動マージにしない。
