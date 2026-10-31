-- 匿名プレイヤー。後でアカウントに紐付けるときは、ここに列を足す
CREATE TABLE players (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);
