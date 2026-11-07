import { findGame } from '@roommate/catalog';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { anonymousName, parseScore } from '../src/scores.ts';
import { issuePlayer, request, today } from './helpers.ts';

const GAME = 'grapnl';

function submit(token: string, body: unknown, game = GAME) {
  return request(`/games/${game}/scores`, {
    method: 'POST',
    token,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /games/:slug/scores', () => {
  it('スコアを保存し、その日の自己ベストを返す', async () => {
    const { token } = await issuePlayer();
    const day = today();

    const first = await submit(token, { day, score: 300, durationMs: 60_000 });
    expect(first.status).toBe(201);
    expect(await first.json()).toEqual({ best: 300 });

    const lower = await submit(token, { day, score: 100, durationMs: 60_000 });
    expect(await lower.json()).toEqual({ best: 300 });
  });

  it('トークンが無ければ 401 を返す', async () => {
    const res = await request(`/games/${GAME}/scores`, { method: 'POST', body: '{}' });
    expect(res.status).toBe(401);
  });

  it('消したプレイヤーのトークンなら、保存せずに 401 を返す', async () => {
    const { playerId, token } = await issuePlayer();
    await env.DB.prepare('DELETE FROM players WHERE id = ?').bind(playerId).run();

    const res = await submit(token, { day: today(), score: 1, durationMs: 60_000 });
    expect(res.status).toBe(401);
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM scores WHERE player_id = ?')
      .bind(playerId)
      .first<{ n: number }>();
    expect(row?.n).toBe(0);
  });

  it('無いゲームには 404 を返す', async () => {
    const { token } = await issuePlayer();
    const res = await submit(token, { day: today(), score: 1, durationMs: 60_000 }, 'missing');
    expect(res.status).toBe(404);
  });

  it('速すぎるスコアは 400 で拒む', async () => {
    const { token } = await issuePlayer();
    const res = await submit(token, { day: today(), score: 100_000, durationMs: 10_000 });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'implausible_score' });
  });

  it('確かめる点数を超えたスコアは保留にし、ランキングに出さず、本人の自己ベストには数える', async () => {
    const game = findGame(GAME)!;
    const day = today();
    const { playerId, token } = await issuePlayer();
    const score = game.holdScoreAbove + 1;

    const res = await submit(token, { day, score, durationMs: 3_600_000 });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ best: score });

    const row = await env.DB.prepare('SELECT held_at FROM scores WHERE player_id = ?')
      .bind(playerId)
      .first<{ held_at: number | null }>();
    expect(row?.held_at).toEqual(expect.any(Number));

    const ranking = await request(`/games/${GAME}/rankings/${day}`);
    const { entries } = await ranking.json<{ entries: { name: string }[] }>();
    expect(entries.map((entry) => entry.name)).not.toContain(anonymousName(playerId));
    const me = await request(`/games/${GAME}/scores/me?day=${day}`, { token });
    expect(await me.json()).toEqual({ best: score, rank: null });
  });

  it('確かめる点数ちょうどのスコアは保留にしない', async () => {
    const game = findGame(GAME)!;
    const { playerId, token } = await issuePlayer();
    await submit(token, { day: today(), score: game.holdScoreAbove, durationMs: 3_600_000 });

    const row = await env.DB.prepare('SELECT held_at FROM scores WHERE player_id = ?')
      .bind(playerId)
      .first<{ held_at: number | null }>();
    expect(row?.held_at).toBeNull();
  });

  it('同じプレイヤーが短時間に送りすぎると 429 を返す', async () => {
    const { token } = await issuePlayer();
    const statuses: number[] = [];
    // 上限は 1 分ごとの窓で数えるので、途中で窓が切り替わっても 1 つの窓で上限を超えるだけ送る
    for (let i = 0; i < 21; i++) {
      const res = await submit(token, { day: today(), score: i, durationMs: 60_000 });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 201)).toBe(true);
    expect(statuses).toContain(429);
  });
});

describe('GET /games/:slug/scores/me', () => {
  it('day を省くと全期間の自己ベストを返す', async () => {
    const { token } = await issuePlayer();
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    await submit(token, { day: yesterday, score: 500, durationMs: 60_000 });
    await submit(token, { day: today(), score: 200, durationMs: 60_000 });

    const all = await request(`/games/${GAME}/scores/me`, { token });
    expect(await all.json()).toEqual({ best: 500 });
    const daily = await request(`/games/${GAME}/scores/me?day=${today()}`, { token });
    // 順位は、同じ日にほかのテストが送ったスコアで変わる
    expect(await daily.json()).toEqual({ best: 200, rank: expect.any(Number) });
  });

  it('隠したスコアは、全期間の自己ベストにも数えない', async () => {
    const me = await issuePlayer();
    const insert = env.DB.prepare(
      'INSERT INTO scores (game, day, player_id, score, duration_ms, created_at, hidden_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    await env.DB.batch([
      insert.bind(GAME, '2026-03-01', me.playerId, 300, 60_000, 1, null),
      insert.bind(GAME, '2026-03-02', me.playerId, 99_999, 60_000, 2, 3),
    ]);

    const res = await request(`/games/${GAME}/scores/me`, { token: me.token });
    expect(await res.json()).toEqual({ best: 300 });
  });

  it('day を指定すると、50 位より下でもその日の順位を返す', async () => {
    const day = '2026-02-01';
    const me = await issuePlayer();
    const others = await Promise.all(Array.from({ length: 51 }, () => issuePlayer()));
    const insert = env.DB.prepare(
      'INSERT INTO scores (game, day, player_id, score, duration_ms, created_at, hidden_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    await env.DB.batch([
      ...others.map((other, i) =>
        insert.bind(GAME, day, other.playerId, 1_000 + i, 60_000, 1, null),
      ),
      // 同点なら先に出した人が上。隠したスコアは数えない
      insert.bind(GAME, day, others[0]!.playerId, 500, 60_000, 1, null),
      insert.bind(GAME, day, me.playerId, 1_000, 60_000, 2, null),
      insert.bind(GAME, day, me.playerId, 99_999, 60_000, 3, 4),
    ]);
    // 保留中のスコアは、自己ベストには数えるが順位には数えない
    await env.DB.prepare(
      'INSERT INTO scores (game, day, player_id, score, duration_ms, created_at, held_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(GAME, day, me.playerId, 50_000, 60_000, 5, 5)
      .run();

    const res = await request(`/games/${GAME}/scores/me?day=${day}`, { token: me.token });
    // 1,001〜1,050 点の 50 人と、先に 1,000 点を出した 1 人の下
    expect(await res.json()).toEqual({ best: 50_000, rank: 52 });
  });

  it('その日のスコアが無ければ順位は null', async () => {
    const { token } = await issuePlayer();
    const res = await request(`/games/${GAME}/scores/me?day=2026-02-02`, { token });
    expect(await res.json()).toEqual({ best: null, rank: null });
  });

  it('スコアが無ければ null を返す', async () => {
    const { token } = await issuePlayer();
    const res = await request(`/games/${GAME}/scores/me`, { token });
    expect(await res.json()).toEqual({ best: null });
  });
});

describe('GET /games/:slug/rankings/:day', () => {
  it('プレイヤーごとの最高スコアを高い順に、匿名の名前で返す', async () => {
    const day = '2026-01-15';
    const a = await issuePlayer();
    const b = await issuePlayer();
    const insert = env.DB.prepare(
      'INSERT INTO scores (game, day, player_id, score, duration_ms, created_at, hidden_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    await env.DB.batch([
      insert.bind(GAME, day, a.playerId, 100, 60_000, 1, null),
      insert.bind(GAME, day, a.playerId, 400, 60_000, 2, null),
      insert.bind(GAME, day, b.playerId, 300, 60_000, 3, null),
      // 運営が隠したスコアは出さない
      insert.bind(GAME, day, b.playerId, 9_000, 60_000, 4, 5),
      // 別の日のスコアは出さない
      insert.bind(GAME, '2026-01-16', b.playerId, 999, 60_000, 6, null),
    ]);
    // 保留中のスコアは出さない
    await env.DB.prepare(
      'INSERT INTO scores (game, day, player_id, score, duration_ms, created_at, held_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(GAME, day, b.playerId, 50_000, 60_000, 7, 7)
      .run();

    const res = await request(`/games/${GAME}/rankings/${day}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      day,
      entries: [
        { rank: 1, name: anonymousName(a.playerId), score: 400 },
        { rank: 2, name: anonymousName(b.playerId), score: 300 },
      ],
    });
  });

  it('同点なら、その点を先に出した人を上にする', async () => {
    const day = '2026-01-20';
    const a = await issuePlayer();
    const b = await issuePlayer();
    const insert = env.DB.prepare(
      'INSERT INTO scores (game, day, player_id, score, duration_ms, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    // a はその日に先に送り始めたが、500 点を出したのは b より後
    await env.DB.batch([
      insert.bind(GAME, day, a.playerId, 100, 60_000, 1),
      insert.bind(GAME, day, b.playerId, 500, 60_000, 2),
      insert.bind(GAME, day, a.playerId, 500, 60_000, 3),
    ]);

    const res = await request(`/games/${GAME}/rankings/${day}`);
    const { entries } = await res.json<{ entries: { name: string }[] }>();
    expect(entries.map((entry) => entry.name)).toEqual([
      anonymousName(b.playerId),
      anonymousName(a.playerId),
    ]);
  });

  it('日付の形が違えば 400 を返す', async () => {
    const res = await request(`/games/${GAME}/rankings/yesterday`);
    expect(res.status).toBe(400);
  });
});

describe('parseScore', () => {
  const game = findGame(GAME)!;
  const now = Date.parse('2026-06-15T12:00:00Z');

  it('前後 1 日までのコースの日付を受け付ける', () => {
    expect(parseScore({ day: '2026-06-14', score: 1, durationMs: 60_000 }, game, now)).toEqual({
      day: '2026-06-14',
      score: 1,
      durationMs: 60_000,
    });
    expect(
      parseScore({ day: '2026-06-16', score: 1, durationMs: 60_000 }, game, now),
    ).not.toBeTypeOf('string');
  });

  it('離れた日付は拒む', () => {
    expect(parseScore({ day: '2026-06-12', score: 1, durationMs: 60_000 }, game, now)).toBe(
      'day_out_of_range',
    );
    expect(parseScore({ day: '2026-06-18', score: 1, durationMs: 60_000 }, game, now)).toBe(
      'day_out_of_range',
    );
  });

  it('整数でないスコアやありえないプレイ時間を拒む', () => {
    const day = '2026-06-15';
    expect(parseScore({ day, score: 1.5, durationMs: 60_000 }, game, now)).toBe('invalid_score');
    expect(parseScore({ day, score: -1, durationMs: 60_000 }, game, now)).toBe('invalid_score');
    expect(parseScore({ day, score: 1, durationMs: 10 }, game, now)).toBe('invalid_duration');
    expect(parseScore({ day, score: 1, durationMs: 3 * 3_600_000 }, game, now)).toBe(
      'invalid_duration',
    );
    expect(parseScore(null, game, now)).toBe('invalid_body');
  });

  it('上限ちょうどの速さは受け付ける', () => {
    const score = game.maxScorePerSecond * 60;
    expect(parseScore({ day: '2026-06-15', score, durationMs: 60_000 }, game, now)).not.toBeTypeOf(
      'string',
    );
  });
});
