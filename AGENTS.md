# AGENTS.md

## 作業の進め方

- issueはLinearで管理する（チーム: Hayashi Naoki `HAY`、プロジェクト: roommate）。GitHub Issuesは使わない

## コミット

- commit message は Conventional Commits の形にする(`<type>(<scope>): <要約>`)。要約は日本語で書く
- 形式は commitlint(`commitlint.config.js`)が lefthook の commit-msg hook で検査する。clone したら `pnpm install` で hook が入る
