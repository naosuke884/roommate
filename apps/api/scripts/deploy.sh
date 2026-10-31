#!/usr/bin/env bash
# D1 を用意してマイグレーションを当ててから、Worker をデプロイする。CI から呼ぶ
set -euo pipefail
cd "$(dirname "$0")/.."

: "${JWT_SECRET:?JWT_SECRET を設定する}"

# 初回だけ DB を作る。以降は wrangler.jsonc の database_name で繋がる
if ! wrangler d1 info roommate >/dev/null 2>&1; then
  wrangler d1 create roommate
fi
wrangler d1 migrations apply DB --remote

secrets_file=$(mktemp)
trap 'rm -f "$secrets_file"' EXIT
node -e 'process.stdout.write(JSON.stringify({ JWT_SECRET: process.env.JWT_SECRET }))' >"$secrets_file"
wrangler deploy --secrets-file "$secrets_file"
