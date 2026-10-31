#!/usr/bin/env bash
# R2 バケットを用意してから、配信 Worker をデプロイする。CI から呼ぶ
set -euo pipefail
cd "$(dirname "$0")/.."

# 初回だけ作る。公開アクセス（r2.dev）は付けない。配信は Worker 経由だけにする。
# ゲームの CI が使うアップロード用トークンは、このバケットだけに書き込める権限にし、
# デプロイ用のトークンとは分ける。
if ! wrangler r2 bucket info roommate-games >/dev/null 2>&1; then
  wrangler r2 bucket create roommate-games
fi

wrangler deploy
