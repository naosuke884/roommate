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
# 前の鍵は、鍵を替えてしばらくの間だけ設定する。未設定ならファイルに入れない。
# --secrets-file は書かなかった secret を消さないので、外すときは `wrangler secret delete` で消す
node -e '
  const secrets = { JWT_SECRET: process.env.JWT_SECRET };
  if (process.env.JWT_SECRET_PREVIOUS) secrets.JWT_SECRET_PREVIOUS = process.env.JWT_SECRET_PREVIOUS;
  process.stdout.write(JSON.stringify(secrets));
' >"$secrets_file"
wrangler deploy --secrets-file "$secrets_file"

# Worker の手前で、IP ごとに極端な連打を弾く
node scripts/waf-rate-limit.mjs
