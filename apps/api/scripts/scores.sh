#!/usr/bin/env bash
# 運営用: 本番のスコアを見る・隠す・消す。wrangler にログインした状態で使う
#   ./scripts/scores.sh top <game> <day>         その日の上位 20 件を ID 付きで出す
#   ./scripts/scores.sh hide <score-id>          スコアをランキングから隠す
#   ./scripts/scores.sh find <name>              ランキングの名前(名無し#1a2b の 1a2b)からプレイヤー ID を探す
#   ./scripts/scores.sh hide-player <player-id>  その人のスコアをまとめてランキングから隠す
#   ./scripts/scores.sh delete-player <player-id> その人のスコアとプレイヤーの行を消す(削除依頼のとき)
set -euo pipefail
cd "$(dirname "$0")/.."

d1() { pnpm exec wrangler d1 execute roommate --remote --command "$1"; }

player_id() {
  [[ $1 =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] || { echo "player-id は UUID" >&2; exit 1; }
}

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
  find)
    name=${2:?名前の # の後ろ 4 文字を指定する}
    name=${name#*#}
    [[ $name =~ ^[0-9a-f]{4}$ ]] || { echo "名前は 16 進の 4 文字" >&2; exit 1; }
    d1 "SELECT id, created_at FROM players WHERE id LIKE '$name%'"
    ;;
  hide-player)
    id=${2:?player-id を指定する}
    player_id "$id"
    d1 "UPDATE scores SET hidden_at = $(date +%s%3N) WHERE player_id = '$id' AND hidden_at IS NULL"
    ;;
  delete-player)
    id=${2:?player-id を指定する}
    player_id "$id"
    read -r -p "$id のスコアとプレイヤーを消す。元に戻せない。続けるなら yes: " answer
    [[ $answer == yes ]] || { echo "やめた" >&2; exit 1; }
    d1 "DELETE FROM scores WHERE player_id = '$id'; DELETE FROM players WHERE id = '$id'"
    ;;
  *)
    sed -n '2,7p' "$0" >&2
    exit 1
    ;;
esac
