# AGENTS.md

## 作業の進め方

- issueはLinearで管理する（チーム: Hayashi Naoki `HAY`、プロジェクト: roommate）。GitHub Issuesは使わない

## 構成

- `apps/site`: ブランドサイト。Astro で静的に出力し、Workers の静的アセットとして配信する
- `apps/api`: API。Hono を Workers で動かす
- `apps/play`: ゲームの配信。R2 バケット `roommate-games` の `<slug>/<file>` を、配信用 Worker から `/<slug>/` で配信する
- `packages/roommate-sdk`: ゲームが読み込む `roommate-sdk.js`。macroquad の JS ローダーのプラグイン
- `crates/roommate-sdk`: `roommate-sdk.js` の関数を包む Rust の crate
- `packages/catalog`: ゲームのカタログ。サイトと配信の origin もここにある。ゲームのソースはこの repo に入れない

## ゲームの配信

- 新しいビルドは同じキーへ上書きする。バージョンごとのコピーは残さない
- `index.html` はキャッシュしない。`.wasm` と JS は、URL に空でない `?v=<commit>` が付いているときだけ長くキャッシュする
- `?v=` はキャッシュを分けるためだけで、R2 のキーには使わない。参照への付与はゲームの CI が行う（macroquad のローダーはファイル名が固定のため）
- ゲームはどこにも埋め込ませない(応答の CSP は `frame-ancestors 'none'`)。サイトのゲームページからは同じタブで配信用ドメインへ移る
- ゲームの CI が使うアップロード用トークンは、バケット `roommate-games` だけに書き込める権限にする。デプロイ用トークンとは分ける

## roommate-sdk

- ゲームは同じタグの crate と `roommate-sdk.js` を使う
  - crate: `roommate-sdk = { git = "https://github.com/naosuke884/roommate", tag = "roommate-sdk-v<version>" }`
  - JS: そのタグの `packages/roommate-sdk/dist/roommate-sdk.js` をゲームの `web/` に置き、`<script src="roommate-sdk.js" data-game="<slug>"></script>` で読む
- `dist/roommate-sdk.js` はビルドしたものを commit する。CI がビルドと同じかを確かめる
- 出すときは `crates/roommate-sdk/Cargo.toml` の version を上げて main に入れ、`roommate-sdk-v<version>` のタグを push する

## 開発

- `pnpm install` で依存と git hook が入る
- `pnpm dev` で開発サーバー、`pnpm test` でテスト、`pnpm typecheck` で型チェック
- push 前に `pnpm format:check`・`pnpm lint`・`pnpm turbo run build typecheck test` を通す(CI と同じ)
- pnpm のコマンドは repo の root で実行し、個別の package には `--filter` を使う

## コミット

- commit message は Conventional Commits の形にする(`<type>(<scope>): <要約>`)。要約は日本語で書く
- 形式は commitlint(`commitlint.config.js`)が lefthook の commit-msg hook で検査する。clone したら `pnpm install` で hook が入る
- 1 commit には 1 つの論理的な変更だけを入れる。機能追加・リファクタ・整形・依存の更新は別の commit に分ける
- どの commit の時点でもビルドとテストが通るようにする
- 1 つの変更に必要なもの(コード・テスト・ドキュメント)は同じ commit に入れる
