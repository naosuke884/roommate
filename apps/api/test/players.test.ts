import { siteOrigin } from '@roommate/catalog';
import { env } from 'cloudflare:workers';
import { sign } from 'hono/jwt';
import { describe, expect, it } from 'vitest';
import { REFRESH_GRACE_SECONDS, TOKEN_TTL_SECONDS, issuePlayerToken } from '../src/auth.ts';
import { type TokenBody, issuePlayer as issue, request } from './helpers.ts';

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
    for (let i = 0; i < 11; i++) {
      const res = await request('/players', {
        method: 'POST',
        headers: { 'CF-Connecting-IP': ip },
      });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 201)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});

describe('GET /players/me', () => {
  it('有効なトークンなら ID を返す', async () => {
    const { playerId, token } = await issue();
    const res = await request('/players/me', { token });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ playerId });
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

describe('CORS', () => {
  it('許可した origin には Access-Control-Allow-Origin を返す', async () => {
    const origin = siteOrigin;
    const res = await request('/players', {
      method: 'OPTIONS',
      headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' },
    });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(origin);
  });

  it('許可していない origin には返さない', async () => {
    const res = await request('/players', {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' },
    });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});
