import { describe, expect, it } from 'vitest';
import { Client, type ClientOptions, localDay } from './client.ts';

const API = 'https://api.example';
const NOW = new Date('2026-06-15T12:00:00');
const nowSeconds = Math.floor(NOW.getTime() / 1000);

interface Call {
  method: string;
  path: string;
  auth: string | null;
  body: unknown;
}

/** API の代わり。パスごとに応答を決め、呼ばれた順に記録する */
function fakeApi(routes: Record<string, (call: Call) => [number, unknown]>) {
  const calls: Call[] = [];
  const fetch = (async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const call = {
      method: init.method ?? 'GET',
      path: url.pathname,
      auth: new Headers(init.headers).get('Authorization'),
      body: init.body ? JSON.parse(init.body as string) : undefined,
    };
    calls.push(call);
    const route = routes[`${call.method} ${call.path}`];
    const [status, body] = route ? route(call) : [404, { error: 'not_found' }];
    return new Response(JSON.stringify(body), { status });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

const issued = { playerId: 'p1', token: 'new-token', expiresAt: nowSeconds + 30 * 86400 };

function client(
  api: ReturnType<typeof fakeApi>,
  storage: ClientOptions['storage'] = memoryStorage(),
) {
  return new Client({ apiOrigin: API, game: 'g', fetch: api.fetch, storage, now: () => NOW });
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('Client', () => {
  it('ID が無ければ発行して保存し、サーバーの自己ベストを読む', async () => {
    const api = fakeApi({
      'POST /players': () => [201, issued],
      'GET /games/g/scores/me': () => [200, { best: 120 }],
    });
    const storage = memoryStorage();
    const c = client(api, storage);

    expect(await c.token()).toBe('new-token');
    expect(c.isReady()).toBe(true);
    expect(c.bestScore()).toBe(120);
    expect(JSON.parse(storage.data.get('roommate.player')!)).toEqual(issued);
    expect(api.calls[1]!.auth).toBe('Bearer new-token');
  });

  it('保存した ID がまだ長く有効なら、そのまま使う', async () => {
    const stored = { playerId: 'p0', token: 'old', expiresAt: nowSeconds + 20 * 86400 };
    const api = fakeApi({ 'GET /games/g/scores/me': () => [200, { best: null }] });
    const c = client(api, memoryStorage({ 'roommate.player': JSON.stringify(stored) }));

    expect(await c.token()).toBe('old');
    expect(api.calls.map((call) => call.path)).toEqual(['/games/g/scores/me']);
  });

  it('期限が近ければ、同じ ID で発行し直す', async () => {
    const stored = { playerId: 'p0', token: 'old', expiresAt: nowSeconds + 86400 };
    const api = fakeApi({
      'POST /players/me/token': (call) => {
        expect(call.auth).toBe('Bearer old');
        return [200, { ...stored, token: 'refreshed', expiresAt: nowSeconds + 30 * 86400 }];
      },
      'GET /games/g/scores/me': () => [200, { best: null }],
    });
    const c = client(api, memoryStorage({ 'roommate.player': JSON.stringify(stored) }));
    expect(await c.token()).toBe('refreshed');
  });

  it('発行し直せなければ、新しい ID をもらう', async () => {
    const stored = { playerId: 'p0', token: 'old', expiresAt: nowSeconds + 86400 };
    const api = fakeApi({
      'POST /players/me/token': () => [401, { error: 'unauthorized' }],
      'POST /players': () => [201, issued],
      'GET /games/g/scores/me': () => [200, { best: null }],
    });
    const c = client(api, memoryStorage({ 'roommate.player': JSON.stringify(stored) }));
    expect(await c.token()).toBe('new-token');
  });

  it('期限切れの ID は使わない', async () => {
    const stored = { playerId: 'p0', token: 'old', expiresAt: nowSeconds - 1 };
    const api = fakeApi({
      'POST /players': () => [201, issued],
      'GET /games/g/scores/me': () => [200, { best: null }],
    });
    const c = client(api, memoryStorage({ 'roommate.player': JSON.stringify(stored) }));
    expect(await c.token()).toBe('new-token');
  });

  it('スコアは端末の日付と一緒に送り、自己ベストは送る前に手元で上げる', async () => {
    const api = fakeApi({
      'POST /players': () => [201, issued],
      'GET /games/g/scores/me': () => [200, { best: 100 }],
      'POST /games/g/scores': () => [201, { best: 300 }],
    });
    const storage = memoryStorage();
    const c = client(api, storage);
    await c.token();

    const sent = c.submitScore(300, 60_000);
    expect(c.bestScore()).toBe(300);
    await sent;

    const post = api.calls.find((call) => call.path === '/games/g/scores')!;
    expect(post.body).toEqual({ day: '2026-06-15', score: 300, durationMs: 60_000 });
    expect(post.auth).toBe('Bearer new-token');
    expect(storage.data.get('roommate.best.g')).toBe('300');
  });

  it('API に繋がらなくても、手元の自己ベストで続けられる', async () => {
    const api = {
      fetch: (async () => {
        throw new TypeError('offline');
      }) as typeof fetch,
    };
    const c = new Client({
      apiOrigin: API,
      game: 'g',
      fetch: api.fetch,
      storage: memoryStorage({ 'roommate.best.g': '50' }),
      now: () => NOW,
    });
    expect(c.bestScore()).toBe(50);
    await c.submitScore(80, 60_000);
    await settle();
    expect(c.isReady()).toBe(false);
    expect(c.bestScore()).toBe(80);
  });

  it('localStorage が例外を投げても止まらない', async () => {
    const throwing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {},
    };
    const api = fakeApi({
      'POST /players': () => [201, issued],
      'GET /games/g/scores/me': () => [200, { best: 5 }],
    });
    const c = client(api, throwing);
    expect(await c.token()).toBe('new-token');
    expect(c.bestScore()).toBe(5);
  });
});

describe('localDay', () => {
  it('端末の時間帯での日付を返す', () => {
    expect(localDay(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});
