import { findGame } from '@roommate/catalog';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { anonymousName, parseScore } from '../src/scores.ts';
import { issuePlayer, request, today } from './helpers.ts';

const GAME = 'browser-game-1';

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

  it('同じプレイヤーが短時間に送りすぎると 429 を返す', async () => {
    const { token } = await issuePlayer();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await submit(token, { day: today(), score: i, durationMs: 60_000 });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 201)).toBe(true);
    expect(statuses[10]).toBe(429);
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
    expect(await daily.json()).toEqual({ best: 200 });
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
