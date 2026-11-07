-- 部屋ごとの、今つながっている人数。部屋(Durable Object)が人の出入りと 1 分ごとに書く。
-- 部屋が止まって書かなくなった行は、updated_at が古いので数えない。game は部屋のキーの「:」より前
CREATE TABLE presence (
  room TEXT PRIMARY KEY,
  game TEXT NOT NULL,
  players INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX presence_game ON presence (game, updated_at);
