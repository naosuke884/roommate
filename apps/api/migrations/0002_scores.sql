-- day はゲームのコースの日付(YYYY-MM-DD)。hidden_at が入ったスコアは運営が隠したもの
CREATE TABLE scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game TEXT NOT NULL,
  day TEXT NOT NULL,
  player_id TEXT NOT NULL REFERENCES players (id),
  score INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  hidden_at INTEGER
);

CREATE INDEX scores_ranking ON scores (game, day, score DESC);
CREATE INDEX scores_player ON scores (player_id, game, day);
