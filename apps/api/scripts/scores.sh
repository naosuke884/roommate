#!/usr/bin/env bash
# 運営用: 本番のスコアを見る・隠す。wrangler にログインした状態で使う
#   ./scripts/scores.sh top <game> <day>   その日の上位 20 件を ID 付きで出す
#   ./scripts/scores.sh hide <score-id>    スコアをランキングから隠す
set -euo pipefail
cd "$(dirname "$0")/.."

d1() { pnpm exec wrangler d1 execute roommate --remote --command "$1"; }

case "${1:-}" in
  top)
    game=${2:?game を指定する}
    day=${3:?day を YYYY-MM-DD で指定する}
    [[ $game =~ ^[a-z0-9-]+$ && $day =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || { echo "game か day の形が違う" >&2; exit 1; }
    d1 "SELECT id, player_id, score, duration_ms, hidden_at FROM scores WHERE game = '$game' AND day = '$day' ORDER BY score DESC LIMIT 20"
    ;;
  hide)
    id=${2:?score-id を指定する}
    [[ $id =~ ^[0-9]+$ ]] || { echo "score-id は数字" >&2; exit 1; }
    d1 "UPDATE scores SET hidden_at = $(date +%s%3N) WHERE id = $id"
    ;;
  *)
    sed -n '2,4p' "$0" >&2
    exit 1
    ;;
esac
