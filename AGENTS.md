# AGENTS.md

## 作業の進め方

- issueはLinearで管理する（チーム: Hayashi Naoki `HAY`、プロジェクト: roommate）。GitHub Issuesは使わない

## 構成

- `apps/site`: ブランドサイト。Astro で静的に出力し、Workers の静的アセットとして配信する
- `apps/api`: API。Hono を Workers で動かす
- `packages/catalog`: ゲームのカタログ。ゲームのソースはこの repo に入れない

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
