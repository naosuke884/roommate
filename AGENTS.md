# AGENTS.md

## 作業の進め方

- issueはLinearで管理する（チーム: Hayashi Naoki `HAY`、プロジェクト: roommate）。GitHub Issuesは使わない

## コミット

- commit message は Conventional Commits の形にする(`<type>(<scope>): <要約>`)。要約は日本語で書く
- 形式は commitlint(`commitlint.config.js`)が lefthook の commit-msg hook で検査する。clone したら `pnpm install` で hook が入る
- 1 commit には 1 つの論理的な変更だけを入れる。機能追加・リファクタ・整形・依存の更新は別の commit に分ける
- どの commit の時点でもビルドとテストが通るようにする
- 1 つの変更に必要なもの(コード・テスト・ドキュメント)は同じ commit に入れる
