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

  // 運営が消したプレイヤーのトークンは、期限まで署名が通る。保存せずに 401 を返し、ID をもらい直させる
  const { meta } = await c.env.DB.prepare(
    `INSERT INTO scores (game, day, player_id, score, duration_ms, created_at)
     SELECT ?1, ?2, ?3, ?4, ?5, ?6 WHERE EXISTS (SELECT 1 FROM players WHERE id = ?3)`,
  )
    .bind(game.slug, input.day, playerId, input.score, input.durationMs, Date.now())
    .run();
  if (meta.changes === 0) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  return c.json({ best: await bestScore(c.env.DB, game.slug, playerId, input.day) }, 201);
});

// 自己ベスト。day を省くと全期間
scores.get('/games/:slug/scores/me', requirePlayer, async (c) => {
  const day = c.req.query('day');
  if (day !== undefined && !isDay(day)) {
    return c.json({ error: 'invalid_day' }, 400);
  }
  const game = c.get('game').slug;
  const playerId = c.get('playerId');
  const best = await bestScore(c.env.DB, game, playerId, day);
  if (day === undefined) {
    return c.json({ best });
  }
  // day を指定したときは、ランキングでのその日の順位も返す。50 位より下でも返す
  return c.json({ best, rank: await rankOf(c.env.DB, game, day, playerId) });
});

scores.get('/games/:slug/rankings/:day', async (c) => {
  const day = c.req.param('day');
  if (!isDay(day)) {
    return c.json({ error: 'invalid_day' }, 400);
  }
  const { results } = await c.env.DB.prepare(
    `${DAILY_BEST}
     SELECT player_id, score FROM best
     ORDER BY score DESC, created_at ASC
     LIMIT ?3`,
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

/**
 * その日のプレイヤーごとの最高点(隠したものを除く)を `best` として持つ。?1 は game、?2 は day。
 * 同点なら、その点を先に出した人を上にするので、最高点を出した時刻も持つ
 */
const DAILY_BEST = `WITH ranked AS (
  SELECT player_id, score, created_at,
    ROW_NUMBER() OVER (PARTITION BY player_id ORDER BY score DESC, created_at ASC) AS nth
  FROM scores
  WHERE game = ?1 AND day = ?2 AND hidden_at IS NULL
), best AS (SELECT player_id, score, created_at FROM ranked WHERE nth = 1)`;

/** ランキングでの順位。その日のスコアが無ければ null */
async function rankOf(db: D1Database, game: string, day: string, playerId: string) {
  const row = await db
    .prepare(
      `${DAILY_BEST}
       SELECT (
         SELECT COUNT(*) FROM best AS other
         WHERE other.score > me.score OR (other.score = me.score AND other.created_at < me.created_at)
       ) + 1 AS rank
       FROM best AS me WHERE me.player_id = ?3`,
    )
    .bind(game, day, playerId)
    .first<{ rank: number }>();
  return row?.rank ?? null;
}

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
  // コースの日付はゲームが送る。時計のずれや日付の変わり目を見込み、サーバーの日付の前後 1 日まで認める
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
