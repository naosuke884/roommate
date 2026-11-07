import { siteOrigin } from '@roommate/catalog';
import { env } from 'cloudflare:workers';
import { sign } from 'hono/jwt';
import { describe, expect, it } from 'vitest';
import {
  REFRESH_GRACE_SECONDS,
  TOKEN_TTL_SECONDS,
  issuePlayerToken,
  verificationSecrets,
  verifyPlayerToken,
} from '../src/auth.ts';
import { type TokenBody, issuePlayer as issue, request, today } from './helpers.ts';

describe('POST /players', () => {
  it('新しい ID を発行して保存し、30 日有効なトークンを返す', async () => {
    const before = Math.floor(Date.now() / 1000);
    const body = await issue();

    expect(body.playerId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.expiresAt - before).toBeGreaterThanOrEqual(TOKEN_TTL_SECONDS);
    const row = await env.DB.prepare('SELECT id FROM players WHERE id = ?')
      .bind(body.playerId)
      .first();
    expect(row).toEqual({ id: body.playerId });
  });

  it('呼ぶたびに別の ID を発行する', async () => {
    const a = await issue();
    const b = await issue();
    expect(a.playerId).not.toBe(b.playerId);
  });

  it('同じ IP から短時間に呼びすぎると 429 を返す', async () => {
    const ip = '203.0.113.99';
    const statuses: number[] = [];
    // 上限は 1 分ごとの窓で数えるので、途中で窓が切り替わっても 1 つの窓で上限を超えるだけ送る
    for (let i = 0; i < 21; i++) {
      const res = await request('/players', {
        method: 'POST',
        headers: { 'CF-Connecting-IP': ip },
      });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 201)).toBe(true);
    expect(statuses).toContain(429);
  });
});

describe('GET /players/me', () => {
  it('有効なトークンなら ID を返す', async () => {
    const { playerId, token } = await issue();
    const res = await request('/players/me', { token });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ playerId, name: null });
  });

  it('消したプレイヤーのトークンなら 401 を返す', async () => {
    const { playerId, token } = await issue();
    await env.DB.prepare('DELETE FROM players WHERE id = ?').bind(playerId).run();
    const res = await request('/players/me', { token });
    expect(res.status).toBe(401);
  });

  it('トークンが無ければ 401 を返す', async () => {
    const res = await request('/players/me');
    expect(res.status).toBe(401);
  });

  it('別の鍵で署名したトークンは受け付けない', async () => {
    const now = Math.floor(Date.now() / 1000);
    const forged = await sign(
      { iss: 'roommate', sub: 'attacker', iat: now, exp: now + 60 },
      'other-secret',
      'HS256',
    );
    const res = await request('/players/me', { token: forged });
    expect(res.status).toBe(401);
  });

  it('期限切れのトークンは受け付けない', async () => {
    const { playerId } = await issue();
    const longAgo = Math.floor(Date.now() / 1000) - TOKEN_TTL_SECONDS - 60;
    const { token } = await issuePlayerToken(playerId, env.JWT_SECRET, longAgo);
    const res = await request('/players/me', { token });
    expect(res.status).toBe(401);
  });
});

describe('PUT /players/me/name', () => {
  function putName(token: string, body: unknown) {
    return request('/players/me/name', {
      method: 'PUT',
      token,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('名前を保存し、GET /players/me で返す', async () => {
    const { playerId, token } = await issue();
    const res = await putName(token, { name: '  さくら  もち ' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: 'さくら もち' });
    const me = await request('/players/me', { token });
    expect(await me.json()).toEqual({ playerId, name: 'さくら もち' });
  });

  it('空にすると名前を外す', async () => {
    const { playerId, token } = await issue();
    await putName(token, { name: 'さくら' });
    const res = await putName(token, { name: '   ' });
    expect(await res.json()).toEqual({ name: null });
    const me = await request('/players/me', { token });
    expect(await me.json()).toEqual({ playerId, name: null });
  });

  it('使えない名前は 400 で拒み、前の名前を残す', async () => {
    const { playerId, token } = await issue();
    await putName(token, { name: 'さくら' });
    for (const name of ['あ'.repeat(13), 'a#b', 'a\u200bb', 42]) {
      const res = await putName(token, { name });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'invalid_name' });
    }
    const me = await request('/players/me', { token });
    expect(await me.json()).toEqual({ playerId, name: 'さくら' });
  });

  it('消したプレイヤーのトークンなら 401 を返す', async () => {
    const { playerId, token } = await issue();
    await env.DB.prepare('DELETE FROM players WHERE id = ?').bind(playerId).run();
    const res = await putName(token, { name: 'さくら' });
    expect(res.status).toBe(401);
  });

  it('トークンが無ければ 401 を返す', async () => {
    const res = await request('/players/me/name', { method: 'PUT', body: '{"name":"a"}' });
    expect(res.status).toBe(401);
  });
});

describe('POST /players/me/token', () => {
  it('同じ ID で新しいトークンを返す', async () => {
    const first = await issue();
    const res = await request('/players/me/token', { method: 'POST', token: first.token });
    expect(res.status).toBe(200);
    const body = await res.json<TokenBody>();
    expect(body.playerId).toBe(first.playerId);
    expect(body.expiresAt).toBeGreaterThanOrEqual(first.expiresAt);
  });

  it('期限切れでも猶予の間なら、同じ ID で新しいトークンを返す', async () => {
    const { playerId } = await issue();
    const issuedAt = Math.floor(Date.now() / 1000) - TOKEN_TTL_SECONDS - 90 * 86400;
    const { token } = await issuePlayerToken(playerId, env.JWT_SECRET, issuedAt);
    const res = await request('/players/me/token', { method: 'POST', token });
    expect(res.status).toBe(200);
    const body = await res.json<TokenBody>();
    expect(body.playerId).toBe(playerId);
    expect(body.expiresAt).toBeGreaterThan(Date.now() / 1000);
  });

  it('猶予も過ぎたトークンは受け付けない', async () => {
    const { playerId } = await issue();
    const issuedAt = Math.floor(Date.now() / 1000) - TOKEN_TTL_SECONDS - REFRESH_GRACE_SECONDS - 60;
    const { token } = await issuePlayerToken(playerId, env.JWT_SECRET, issuedAt);
    const res = await request('/players/me/token', { method: 'POST', token });
    expect(res.status).toBe(401);
  });

  it('別の鍵で署名したトークンは、猶予の間でも受け付けない', async () => {
    const { playerId } = await issue();
    const { token } = await issuePlayerToken(playerId, 'another-secret');
    const res = await request('/players/me/token', { method: 'POST', token });
    expect(res.status).toBe(401);
  });

  it('保存されていない ID のトークンは受け付けない', async () => {
    const { token } = await issuePlayerToken('unknown-player', env.JWT_SECRET);
    const res = await request('/players/me/token', { method: 'POST', token });
    expect(res.status).toBe(401);
  });
});

describe('DELETE /players/me', () => {
  async function postScore(token: string, game = 'grapnl') {
    const res = await request(`/games/${game}/scores`, {
      method: 'POST',
      token,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ day: today(), score: 10, durationMs: 60_000 }),
    });
    expect(res.status).toBe(201);
  }

  it('自分のスコアとプレイヤーの行を消し、ほかの人のスコアは残す', async () => {
    const me = await issue();
    const other = await issue();
    await postScore(me.token);
    await postScore(other.token);

    const res = await request('/players/me', { method: 'DELETE', token: me.token });
    expect(res.status).toBe(204);

    const count = (id: string) =>
      env.DB.prepare(
        'SELECT (SELECT COUNT(*) FROM scores WHERE player_id = ?1) + (SELECT COUNT(*) FROM players WHERE id = ?1) AS n',
      )
        .bind(id)
        .first<{ n: number }>();
    expect(await count(me.playerId)).toEqual({ n: 0 });
    expect(await count(other.playerId)).toEqual({ n: 2 });
  });

  it('消したあとは、そのトークンでスコアを保存できない', async () => {
    const me = await issue();
    await request('/players/me', { method: 'DELETE', token: me.token });
    const res = await request('/games/grapnl/scores', {
      method: 'POST',
      token: me.token,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ day: today(), score: 10, durationMs: 60_000 }),
    });
    expect(res.status).toBe(401);
  });

  it('すでに消えた ID でも 204 を返す', async () => {
    const me = await issue();
    await request('/players/me', { method: 'DELETE', token: me.token });
    const res = await request('/players/me', { method: 'DELETE', token: me.token });
    expect(res.status).toBe(204);
  });

  it('期限切れでも猶予の間なら消せる', async () => {
    const { playerId } = await issue();
    const issuedAt = Math.floor(Date.now() / 1000) - TOKEN_TTL_SECONDS - 90 * 86400;
    const { token } = await issuePlayerToken(playerId, env.JWT_SECRET, issuedAt);
    const res = await request('/players/me', { method: 'DELETE', token });
    expect(res.status).toBe(204);
    const row = await env.DB.prepare('SELECT 1 FROM players WHERE id = ?').bind(playerId).first();
    expect(row).toBeNull();
  });

  it('別の鍵で署名したトークンでは消せない', async () => {
    const { playerId } = await issue();
    const { token } = await issuePlayerToken(playerId, 'another-secret');
    const res = await request('/players/me', { method: 'DELETE', token });
    expect(res.status).toBe(401);
    const row = await env.DB.prepare('SELECT 1 FROM players WHERE id = ?').bind(playerId).first();
    expect(row).not.toBeNull();
  });

  it('トークンが無ければ 401 を返す', async () => {
    const res = await request('/players/me', { method: 'DELETE' });
    expect(res.status).toBe(401);
  });
});

describe('前の鍵', () => {
  // vitest.config.ts で JWT_SECRET_PREVIOUS を設定している
  const previous = () => env.JWT_SECRET_PREVIOUS!;

  it('前の鍵で署名したトークンも、ふつうの API で通る', async () => {
    const { playerId } = await issue();
    const { token } = await issuePlayerToken(playerId, previous());
    const res = await request('/players/me', { token });
    expect(res.status).toBe(200);
  });

  it('前の鍵のトークンで発行し直すと、同じ ID で今の鍵のトークンを返す', async () => {
    const { playerId } = await issue();
    const issuedAt = Math.floor(Date.now() / 1000) - TOKEN_TTL_SECONDS - 90 * 86400;
    const { token } = await issuePlayerToken(playerId, previous(), issuedAt);
    const res = await request('/players/me/token', { method: 'POST', token });
    expect(res.status).toBe(200);
    const body = await res.json<TokenBody>();
    expect(body.playerId).toBe(playerId);
    expect(await verifyPlayerToken(body.token, [env.JWT_SECRET])).toBe(playerId);
  });

  it('前の鍵のトークンで、自分のデータを消せる', async () => {
    const { playerId } = await issue();
    const { token } = await issuePlayerToken(playerId, previous());
    const res = await request('/players/me', { method: 'DELETE', token });
    expect(res.status).toBe(204);
  });

  it('前の鍵が空なら、今の鍵だけで確かめる', () => {
    expect(verificationSecrets({ JWT_SECRET: 'now', JWT_SECRET_PREVIOUS: '' })).toEqual(['now']);
    expect(verificationSecrets({ JWT_SECRET: 'now' })).toEqual(['now']);
    expect(verificationSecrets({ JWT_SECRET: 'now', JWT_SECRET_PREVIOUS: 'old' })).toEqual([
      'now',
      'old',
    ]);
  });
});

describe('CORS', () => {
  it('許可した origin には Access-Control-Allow-Origin を返す', async () => {
    const origin = siteOrigin;
    const res = await request('/players', {
      method: 'OPTIONS',
      headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' },
    });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(origin);
  });

  it('PUT の preflight を許す', async () => {
    const res = await request('/players/me/name', {
      method: 'OPTIONS',
      headers: { Origin: siteOrigin, 'Access-Control-Request-Method': 'PUT' },
    });
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('PUT');
  });

  it('DELETE の preflight を許す', async () => {
    const res = await request('/players/me', {
      method: 'OPTIONS',
      headers: { Origin: siteOrigin, 'Access-Control-Request-Method': 'DELETE' },
    });
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('DELETE');
  });

  it('許可していない origin には返さない', async () => {
    const res = await request('/players', {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' },
    });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});
