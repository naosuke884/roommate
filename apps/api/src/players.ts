import { Hono } from 'hono';
import { issuePlayerToken, requirePlayer, requireRefreshablePlayer } from './auth.ts';
import { issueLimitKey } from './limits.ts';
import { parseName } from './names.ts';

export const players = new Hono<{ Bindings: Env }>();

// 新しい匿名 ID を発行する。ID はクライアントに決めさせない
players.post('/', async (c) => {
  const ip = c.req.header('CF-Connecting-IP') ?? 'unknown';
  const { success } = await c.env.PLAYER_ISSUE_LIMITER.limit({ key: issueLimitKey(ip) });
  if (!success) {
    return c.json({ error: 'too_many_requests' }, 429);
  }

  const playerId = crypto.randomUUID();
  await c.env.DB.prepare('INSERT INTO players (id, created_at) VALUES (?, ?)')
    .bind(playerId, Date.now())
    .run();
  return c.json(await issuePlayerToken(playerId, c.env.JWT_SECRET), 201);
});

// トークンと引き換えに、同じ ID で発行し直す。期限切れでも猶予の間は引き換えられる
players.post('/me/token', requireRefreshablePlayer, async (c) => {
  const playerId = c.get('playerId');
  const row = await c.env.DB.prepare('SELECT 1 FROM players WHERE id = ?').bind(playerId).first();
  if (!row) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  return c.json(await issuePlayerToken(playerId, c.env.JWT_SECRET));
});

players.get('/me', requirePlayer, async (c) => {
  const playerId = c.get('playerId');
  const row = await c.env.DB.prepare('SELECT name FROM players WHERE id = ?')
    .bind(playerId)
    .first<{ name: string | null }>();
  if (!row) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  return c.json({ playerId, name: row.name });
});

// ランキングに出す名前を付ける・変える。空にすると「名無し」に戻す
players.put('/me/name', requirePlayer, async (c) => {
  const playerId = c.get('playerId');
  const { success } = await c.env.NAME_LIMITER.limit({ key: playerId });
  if (!success) {
    return c.json({ error: 'too_many_requests' }, 429);
  }

  const body = await c.req.json<unknown>().catch(() => undefined);
  const name = parseName(body);
  if (name === undefined) {
    return c.json({ error: 'invalid_name' }, 400);
  }
  // 運営が消したプレイヤーのトークンは、期限まで署名が通る。行が無ければ 401 を返し、ID をもらい直させる
  const { meta } = await c.env.DB.prepare('UPDATE players SET name = ? WHERE id = ?')
    .bind(name, playerId)
    .run();
  if (meta.changes === 0) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  return c.json({ name });
});

// 本人が自分の ID と全ゲームのスコアを消す。発行し直せる間のトークンなら、期限切れでも消せる。
// すでに消えた ID でも 204 を返し、応答が届かずに送り直したときも成功にする
players.delete('/me', requireRefreshablePlayer, async (c) => {
  const playerId = c.get('playerId');
  // scores は players を参照するので、scores から先に消す
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM scores WHERE player_id = ?').bind(playerId),
    c.env.DB.prepare('DELETE FROM players WHERE id = ?').bind(playerId),
  ]);
  return c.body(null, 204);
});

/** スコアも名前も無い ID を消すまでの日数。遊び始めたばかりの人の ID は消さない */
export const UNUSED_PLAYER_DAYS = 7;

/**
 * 発行してから `UNUSED_PLAYER_DAYS` 日たっても、スコアも名前も無い ID を消す。
 * 発行は誰でもできるので、使われない行が溜まり続けないようにする。
 * 消した ID のトークンは 401 になり、SDK は新しい ID をもらい直す。失うものは無い
 */
export async function deleteUnusedPlayers(db: D1Database, now = Date.now()): Promise<number> {
  const { meta } = await db
    .prepare(
      `DELETE FROM players
       WHERE created_at < ? AND name IS NULL
         AND NOT EXISTS (SELECT 1 FROM scores WHERE scores.player_id = players.id)`,
    )
    .bind(now - UNUSED_PLAYER_DAYS * 24 * 60 * 60 * 1000)
    .run();
  return meta.changes;
}
