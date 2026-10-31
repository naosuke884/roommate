import { Hono } from 'hono';
import { issuePlayerToken, requirePlayer, requireRefreshablePlayer } from './auth.ts';

export const players = new Hono<{ Bindings: Env }>();

// 新しい匿名 ID を発行する。ID はクライアントに決めさせない
players.post('/', async (c) => {
  const ip = c.req.header('CF-Connecting-IP') ?? 'unknown';
  const { success } = await c.env.PLAYER_ISSUE_LIMITER.limit({ key: ip });
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

players.get('/me', requirePlayer, (c) => c.json({ playerId: c.get('playerId') }));
