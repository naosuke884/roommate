-- 今遊んでいる人数を、接続の数ではなくプレイヤーの数で数える。
-- 部屋(Durable Object)が、いるプレイヤーの ID を人の出入りと 1 分ごとに書き直す。
-- 行は一時的なもので、作り直しても 2 分ほどで元に戻るので、前の表は消す
DROP TABLE presence;
CREATE TABLE presence (
  room TEXT NOT NULL,
  player_id TEXT NOT NULL,
  game TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (room, player_id)
);
CREATE INDEX presence_game ON presence (game, updated_at);
