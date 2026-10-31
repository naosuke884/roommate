import { playOrigin, siteOrigin } from '@roommate/catalog';
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

function get(path: string) {
  return exports.default.fetch(new Request(`https://api.example/${path}`));
}

describe('GET /health', () => {
  it('ok を返す', async () => {
    const res = await get('health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe('GET /games', () => {
  it('カタログのゲームを返す', async () => {
    const res = await get('games');
    expect(res.status).toBe(200);
    const body = await res.json<{ games: { slug: string }[] }>();
    expect(body.games.map((game) => game.slug)).toContain('browser-game-1');
  });
});

describe('CORS', () => {
  it('サイトと配信用 origin は通し、それ以外は通さない', async () => {
    for (const origin of [siteOrigin, playOrigin]) {
      const res = await exports.default.fetch(
        new Request('https://api.example/health', { headers: { Origin: origin } }),
      );
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe(origin);
    }

    const denied = await exports.default.fetch(
      new Request('https://api.example/health', { headers: { Origin: 'https://itch.io' } }),
    );
    expect(denied.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});

describe('存在しないパス', () => {
  it('404 を返す', async () => {
    const res = await get('missing');
    expect(res.status).toBe(404);
  });
});
