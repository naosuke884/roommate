import { exports } from 'cloudflare:workers';
import { expect } from 'vitest';

export interface TokenBody {
  playerId: string;
  token: string;
  expiresAt: number;
}

export function request(path: string, init: RequestInit & { token?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.token) headers.set('Authorization', `Bearer ${init.token}`);
  return exports.default.fetch(new Request(`https://api.example${path}`, { ...init, headers }));
}

let ipCounter = 0;

/** 呼ぶたびに別の IP から匿名 ID を発行する */
export async function issuePlayer(ip = `198.51.100.${++ipCounter % 250}`) {
  const res = await request('/players', { method: 'POST', headers: { 'CF-Connecting-IP': ip } });
  expect(res.status).toBe(201);
  return res.json<TokenBody>();
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}
