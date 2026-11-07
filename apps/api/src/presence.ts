import { findGame } from '@roommate/catalog';
import { Hono } from 'hono';
import { PRESENCE_REFRESH_MS } from './room.ts';

// 部屋は人がいる間 PRESENCE_REFRESH_MS ごとに書き直す。2 回ぶん書かれていない行は、止まった部屋として数えない
const STALE_MS = PRESENCE_REFRESH_MS * 2 + 30_000;

export const presence = new Hono<{ Bindings: Env }>();

// 今そのゲームを開いている人数。ゲームが繋いでいる部屋の人数を足す
presence.get('/games/:slug/presence', async (c) => {
  const game = findGame(c.req.param('slug'));
  if (!game) {
    return c.json({ error: 'game_not_found' }, 404);
  }
  const row = await c.env.DB.prepare(
    'SELECT COALESCE(SUM(players), 0) AS playing FROM presence WHERE game = ? AND updated_at > ?',
  )
    .bind(game.slug, Date.now() - STALE_MS)
    .first<{ playing: number }>();
  c.header('Cache-Control', 'public, max-age=15');
  return c.json({ playing: row?.playing ?? 0 });
});
