import { type Game, findGame } from '@roommate/catalog';
import { Hono } from 'hono';
import { requirePlayer } from './auth.ts';

const RANKING_SIZE = 50;
const MIN_DURATION_MS = 1_000;
const MAX_DURATION_MS = 2 * 60 * 60 * 1_000;
const DAY_MS = 24 * 60 * 60 * 1_000;

type AppEnv = { Bindings: Env; Variables: { game: Game; playerId: string } };

export const scores = new Hono<AppEnv>();

scores.use('/games/:slug/*', async (c, next) => {
  const game = findGame(c.req.param('slug'));
  if (!game) {
    return c.json({ error: 'game_not_found' }, 404);
  }
  c.set('game', game);
  await next();
});

scores.post('/games/:slug/scores', requirePlayer, async (c) => {
  const game = c.get('game');
  const playerId = c.get('playerId');

  const { success } = await c.env.SCORE_LIMITER.limit({ key: playerId });
  if (!success) {
    return c.json({ error: 'too_many_requests' }, 429);
  }

  const body = await c.req.json<unknown>().catch(() => undefined);
  const input = parseScore(body, game, Date.now());
  if (typeof input === 'string') {
    return c.json({ error: input }, 400);
  }

  await c.env.DB.prepare(
    'INSERT INTO scores (game, day, player_id, score, duration_ms, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(game.slug, input.day, playerId, input.score, input.durationMs, Date.now())
    .run();

  return c.json({ best: await bestScore(c.env.DB, game.slug, playerId, input.day) }, 201);
});

// 自己ベスト。day を省くと全期間
scores.get('/games/:slug/scores/me', requirePlayer, async (c) => {
  const day = c.req.query('day');
  if (day !== undefined && !isDay(day)) {
    return c.json({ error: 'invalid_day' }, 400);
  }
  return c.json({ best: await bestScore(c.env.DB, c.get('game').slug, c.get('playerId'), day) });
});

scores.get('/games/:slug/rankings/:day', async (c) => {
  const day = c.req.param('day');
  if (!isDay(day)) {
    return c.json({ error: 'invalid_day' }, 400);
  }
  const { results } = await c.env.DB.prepare(
    `SELECT player_id, MAX(score) AS score FROM scores
     WHERE game = ? AND day = ? AND hidden_at IS NULL
     GROUP BY player_id
     ORDER BY score DESC, MIN(created_at) ASC
     LIMIT ?`,
  )
    .bind(c.get('game').slug, day, RANKING_SIZE)
    .all<{ player_id: string; score: number }>();

  const entries = results.map((row, i) => ({
    rank: i + 1,
    name: anonymousName(row.player_id),
    score: row.score,
  }));
  c.header('Cache-Control', 'public, max-age=30');
  return c.json({ day, entries });
});

interface ScoreInput {
  day: string;
  score: number;
  durationMs: number;
}

/** 受け付けられるならその値を、だめなら理由を返す */
export function parseScore(body: unknown, game: Game, now: number): ScoreInput | string {
  if (typeof body !== 'object' || body === null) return 'invalid_body';
  const { day, score, durationMs } = body as Record<string, unknown>;

  if (typeof day !== 'string' || !isDay(day)) return 'invalid_day';
  // コースの日付はクライアントの時間帯で決まるので、サーバーの日付の前後 1 日まで認める
  const dayStart = Date.parse(`${day}T00:00:00Z`);
  if (dayStart < now - 2 * DAY_MS || dayStart > now + DAY_MS) return 'day_out_of_range';

  if (!Number.isSafeInteger(score) || (score as number) < 0) return 'invalid_score';
  if (
    !Number.isSafeInteger(durationMs) ||
    (durationMs as number) < MIN_DURATION_MS ||
    (durationMs as number) > MAX_DURATION_MS
  ) {
    return 'invalid_duration';
  }
  if ((score as number) / ((durationMs as number) / 1_000) > game.maxScorePerSecond) {
    return 'implausible_score';
  }
  return { day, score: score as number, durationMs: durationMs as number };
}

function isDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

async function bestScore(db: D1Database, game: string, playerId: string, day?: string) {
  const row = await db
    .prepare(
      `SELECT MAX(score) AS best FROM scores
       WHERE game = ? AND player_id = ? AND (?3 IS NULL OR day = ?3)`,
    )
    .bind(game, playerId, day ?? null)
    .first<{ best: number | null }>();
  return row?.best ?? null;
}

/** ランキングに出す匿名の名前。ID の先頭 4 文字を使う */
export function anonymousName(playerId: string): string {
  return `名無し#${playerId.slice(0, 4)}`;
}
