import { describe, expect, it } from 'vitest';
import { Client, type ClientOptions, courseDay } from './client.ts';

const API = 'https://api.example';
const NOW = new Date('2026-06-15T12:00:00Z');
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
    // 204 は本文を持てない
    return new Response(status === 204 ? null : JSON.stringify(body), { status });
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
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size;
    },
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

  it('ID が使えないと言われたら、新しい ID をもらう', async () => {
    const stored = { playerId: 'p0', token: 'old', expiresAt: nowSeconds + 86400 };
    const api = fakeApi({
      'POST /players/me/token': () => [401, { error: 'unauthorized' }],
      'POST /players': () => [201, issued],
      'GET /games/g/scores/me': () => [200, { best: null }],
    });
    const c = client(api, memoryStorage({ 'roommate.player': JSON.stringify(stored) }));
    expect(await c.token()).toBe('new-token');
  });

  it.each([
    ['サーバーのエラー', () => [503, { error: 'unavailable' }] as [number, unknown]],
    ['送りすぎ', () => [429, { error: 'too_many_requests' }] as [number, unknown]],
    [
      '通信の失敗',
      () => {
        throw new TypeError('offline');
      },
    ],
  ])('%sで発行し直せなくても、期限内なら今の ID を使い続ける', async (_, refresh) => {
    const stored = { playerId: 'p0', token: 'old', expiresAt: nowSeconds + 86400 };
    const api = fakeApi({
      'POST /players/me/token': refresh,
      'POST /players': () => [201, issued],
      'GET /games/g/scores/me': () => [200, { best: null }],
    });
    const storage = memoryStorage({ 'roommate.player': JSON.stringify(stored) });
    const c = client(api, storage);

    expect(await c.token()).toBe('old');
    expect(api.calls.some((call) => call.path === '/players')).toBe(false);
    expect(JSON.parse(storage.data.get('roommate.player')!)).toEqual(stored);
  });

  it('期限切れでも猶予の間なら、同じ ID で発行し直す', async () => {
    const stored = { playerId: 'p0', token: 'old', expiresAt: nowSeconds - 90 * 86400 };
    const api = fakeApi({
      'POST /players/me/token': () => [
        200,
        { ...stored, token: 'refreshed', expiresAt: nowSeconds + 30 * 86400 },
      ],
      'POST /players': () => [201, issued],
      'GET /games/g/scores/me': () => [200, { best: null }],
    });
    const c = client(api, memoryStorage({ 'roommate.player': JSON.stringify(stored) }));
    expect(await c.token()).toBe('refreshed');
    expect(api.calls.some((call) => call.path === '/players')).toBe(false);
  });

  it('期限切れで発行し直せなければ、新しい ID をもらわずに次を待つ', async () => {
    const stored = { playerId: 'p0', token: 'old', expiresAt: nowSeconds - 1 };
    const api = fakeApi({
      'POST /players/me/token': () => [503, { error: 'unavailable' }],
      'POST /players': () => [201, issued],
    });
    const storage = memoryStorage({ 'roommate.player': JSON.stringify(stored) });
    const c = client(api, storage);
    expect(await c.token()).toBeUndefined();
    expect(api.calls.some((call) => call.path === '/players')).toBe(false);
    expect(JSON.parse(storage.data.get('roommate.player')!)).toEqual(stored);
  });

  it('猶予も過ぎた ID は使わない', async () => {
    const stored = { playerId: 'p0', token: 'old', expiresAt: nowSeconds - 400 * 86400 };
    const api = fakeApi({
      'POST /players': () => [201, issued],
      'GET /games/g/scores/me': () => [200, { best: null }],
    });
    const c = client(api, memoryStorage({ 'roommate.player': JSON.stringify(stored) }));
    expect(await c.token()).toBe('new-token');
    expect(api.calls.map((call) => call.path)).not.toContain('/players/me/token');
  });

  it('スコアはコースの日付と一緒に送り、自己ベストは送る前に手元で上げる', async () => {
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

  it('スコアの送信でトークンが通らなければ、ID をもらい直して送り直す', async () => {
    const stored = { playerId: 'p0', token: 'old', expiresAt: nowSeconds + 20 * 86400 };
    const api = fakeApi({
      'GET /games/g/scores/me': () => [200, { best: null }],
      'POST /players': () => [201, issued],
      'POST /games/g/scores': (call) =>
        call.auth === 'Bearer old' ? [401, { error: 'unauthorized' }] : [201, { best: 300 }],
    });
    const storage = memoryStorage({ 'roommate.player': JSON.stringify(stored) });
    const c = client(api, storage);
    await c.token();

    await c.submitScore(300, 60_000);

    const posts = api.calls.filter((call) => call.path === '/games/g/scores');
    expect(posts.map((call) => call.auth)).toEqual(['Bearer old', 'Bearer new-token']);
    expect(await c.token()).toBe('new-token');
    expect(JSON.parse(storage.data.get('roommate.player')!)).toEqual(issued);
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

  it('サーバーの自己ベストが手元より低ければ、サーバーに合わせる', async () => {
    const api = fakeApi({
      'POST /players': () => [201, issued],
      'GET /games/g/scores/me': () => [200, { best: 300 }],
    });
    const storage = memoryStorage({ 'roommate.best.g': '99999' });
    const c = client(api, storage);
    await c.token();

    expect(c.bestScore()).toBe(300);
    expect(storage.data.get('roommate.best.g')).toBe('300');
  });

  it('サーバーに自己ベストが無ければ、手元の自己ベストも消す', async () => {
    const api = fakeApi({
      'POST /players': () => [201, issued],
      'GET /games/g/scores/me': () => [200, { best: null }],
    });
    const storage = memoryStorage({ 'roommate.best.g': '99999' });
    const c = client(api, storage);
    await c.token();

    expect(c.bestScore()).toBeUndefined();
    expect(storage.data.has('roommate.best.g')).toBe(false);
  });

  it('まだ送れていないスコアは、サーバーの自己ベストに合わせても残す', async () => {
    const pending = [{ day: '2026-06-15', score: 500, durationMs: 60_000 }];
    const api = fakeApi({
      'POST /players': () => [201, issued],
      'GET /games/g/scores/me': () => [200, { best: 300 }],
      'POST /games/g/scores': () => [503, { error: 'unavailable' }],
    });
    const storage = memoryStorage({
      'roommate.best.g': '99999',
      'roommate.pending.g': JSON.stringify(pending),
    });
    const c = client(api, storage);
    await c.token();

    expect(c.bestScore()).toBe(500);
  });

  it('自己ベストを読んでいる間に送ったスコアは、読み終えても残す', async () => {
    let answer: (() => void) | undefined;
    const api = fakeApi({
      'POST /players': () => [201, issued],
      'GET /games/g/scores/me': () => [200, { best: 100 }],
      // 送れずに手元に残っても、自己ベストは下がらない
      'POST /games/g/scores': () => [503, { error: 'unavailable' }],
    });
    const fetch = (async (input: string, init?: RequestInit) => {
      if (new URL(input).pathname === '/games/g/scores/me') {
        await new Promise<void>((resolve) => (answer = resolve));
      }
      return api.fetch(input, init);
    }) as typeof globalThis.fetch;
    const c = new Client({
      apiOrigin: API,
      game: 'g',
      fetch,
      storage: memoryStorage(),
      now: () => NOW,
    });
    await settle();

    const sent = c.submitScore(400, 60_000);
    answer!();
    await sent;

    expect(c.bestScore()).toBe(400);
  });

  it('サーバーの自己ベストを読めなければ、手元の自己ベストを使う', async () => {
    const api = fakeApi({
      'POST /players': () => [201, issued],
      'GET /games/g/scores/me': () => [503, { error: 'unavailable' }],
    });
    const storage = memoryStorage({ 'roommate.best.g': '700' });
    const c = client(api, storage);
    await c.token();

    expect(c.bestScore()).toBe(700);
    expect(storage.data.get('roommate.best.g')).toBe('700');
  });

  it('送れなかったスコアは手元に残し、次に開いたときに送る', async () => {
    const storage = memoryStorage();
    const offline = {
      fetch: (async () => {
        throw new TypeError('offline');
      }) as typeof fetch,
    };
    const first = new Client({
      apiOrigin: API,
      game: 'g',
      fetch: offline.fetch,
      storage,
      now: () => NOW,
    });
    await first.submitScore(80, 60_000);
    expect(JSON.parse(storage.data.get('roommate.pending.g')!)).toEqual([
      { day: '2026-06-15', score: 80, durationMs: 60_000 },
    ]);

    const api = fakeApi({
      'POST /players': () => [201, issued],
      'GET /games/g/scores/me': () => [200, { best: null }],
      'POST /games/g/scores': () => [201, { best: 80 }],
    });
    const second = client(api, storage);
    await second.token();
    await settle();
    await settle();

    const posts = api.calls.filter((call) => call.path === '/games/g/scores');
    expect(posts.map((call) => call.body)).toEqual([
      { day: '2026-06-15', score: 80, durationMs: 60_000 },
    ]);
    expect(storage.data.has('roommate.pending.g')).toBe(false);
  });

  it('サーバーのエラーなら残し、受け付けられないスコアは捨てる', async () => {
    let status = 503;
    const api = fakeApi({
      'POST /players': () => [201, issued],
      'GET /games/g/scores/me': () => [200, { best: null }],
      'POST /games/g/scores': () => [status, { error: 'x' }],
    });
    const storage = memoryStorage();
    const c = client(api, storage);
    await c.token();

    await c.submitScore(10, 60_000);
    expect(JSON.parse(storage.data.get('roommate.pending.g')!)).toHaveLength(1);

    status = 400;
    await c.submitScore(20, 60_000);
    expect(storage.data.has('roommate.pending.g')).toBe(false);
  });

  it('手元に残すのは新しい 20 件まで', async () => {
    const storage = memoryStorage();
    const offline = (async () => {
      throw new TypeError('offline');
    }) as typeof fetch;
    const c = new Client({ apiOrigin: API, game: 'g', fetch: offline, storage, now: () => NOW });
    for (let score = 1; score <= 25; score++) await c.submitScore(score, 60_000);
    const pending = JSON.parse(storage.data.get('roommate.pending.g')!) as { score: number }[];
    expect(pending.map((entry) => entry.score)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 6),
    );
  });

  it('今日のランキングと自分の順位を読む', async () => {
    const entries = [{ rank: 1, name: '名無し#aaaa', score: 900 }];
    const api = fakeApi({
      'POST /players': () => [201, issued],
      'GET /games/g/scores/me': (call) => {
        expect(call.auth).toBe('Bearer new-token');
        return [200, { best: 300, rank: 57 }];
      },
      'GET /games/g/rankings/2026-06-15': () => [200, { day: '2026-06-15', entries }],
    });
    const c = client(api);
    expect(c.rankingState()).toEqual({ status: 'idle' });

    const loading = c.requestRanking();
    expect(c.rankingState()).toEqual({ status: 'loading' });
    await loading;

    expect(c.rankingState()).toEqual({ status: 'ready', day: '2026-06-15', entries, myRank: 57 });
    expect(api.calls.some((call) => call.path === '/games/g/scores/me')).toBe(true);
  });

  it('ランキングを読めなければ failed にする', async () => {
    const api = fakeApi({
      'POST /players': () => [201, issued],
      'GET /games/g/scores/me': () => [200, { best: null }],
      'GET /games/g/rankings/2026-06-15': () => [503, { error: 'unavailable' }],
    });
    const c = client(api);
    await c.requestRanking();
    expect(c.rankingState()).toEqual({ status: 'failed' });
  });

  it('ID が無くても、ランキングは自分の順位なしで読む', async () => {
    const api = fakeApi({
      'POST /players': () => [503, { error: 'unavailable' }],
      'GET /games/g/rankings/2026-06-15': () => [200, { day: '2026-06-15', entries: [] }],
    });
    const c = client(api);
    await c.requestRanking();
    expect(c.rankingState()).toEqual({
      status: 'ready',
      day: '2026-06-15',
      entries: [],
      myRank: null,
    });
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
      key: () => {
        throw new Error('denied');
      },
      get length(): number {
        throw new Error('denied');
      },
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

describe('Client.requestDelete', () => {
  const stored = { playerId: 'p0', token: 'old', expiresAt: nowSeconds + 20 * 86400 };

  function storageWithData() {
    return memoryStorage({
      'roommate.player': JSON.stringify(stored),
      'roommate.best.g': '300',
      'roommate.best.other': '50',
      'roommate.pending.other': JSON.stringify([{ day: '2026-06-15', score: 1, durationMs: 1 }]),
      unrelated: 'keep',
    });
  }

  it('サーバーのデータと、端末の roommate. のキーをすべて消す', async () => {
    const api = fakeApi({
      'GET /games/g/scores/me': () => [200, { best: 300 }],
      'DELETE /players/me': (call) => {
        expect(call.auth).toBe('Bearer old');
        return [204, null];
      },
    });
    const storage = storageWithData();
    const c = client(api, storage);
    await c.token();

    const deleting = c.requestDelete();
    expect(c.deleteState()).toBe('deleting');
    await deleting;

    expect(c.deleteState()).toBe('done');
    expect([...storage.data.keys()]).toEqual(['unrelated']);
    expect(c.isReady()).toBe(false);
    expect(c.bestScore()).toBeUndefined();
    expect(await c.token()).toBeUndefined();
  });

  it('消したあとのスコアは、保存も送信もしない', async () => {
    const api = fakeApi({
      'GET /games/g/scores/me': () => [200, { best: null }],
      'DELETE /players/me': () => [204, null],
      'POST /players': () => [201, issued],
    });
    const storage = storageWithData();
    const c = client(api, storage);
    await c.requestDelete();

    await c.submitScore(500, 60_000);
    await settle();

    expect(c.bestScore()).toBeUndefined();
    expect([...storage.data.keys()]).toEqual(['unrelated']);
    expect(api.calls.some((call) => call.path === '/games/g/scores')).toBe(false);
    expect(api.calls.some((call) => call.path === '/players')).toBe(false);
  });

  it('送っている途中のスコアが終わるのを待ってから消し、新しい ID をもらわない', async () => {
    let finishPost!: () => void;
    const order: string[] = [];
    const api = fakeApi({
      'GET /games/g/scores/me': () => [200, { best: null }],
      'POST /players': () => [201, issued],
      'DELETE /players/me': () => {
        order.push('delete');
        return [204, null];
      },
    });
    const fetch = (async (input: string, init: RequestInit = {}) => {
      if (init.method === 'POST' && new URL(input).pathname === '/games/g/scores') {
        await new Promise<void>((resolve) => (finishPost = resolve));
        order.push('score');
        return new Response(JSON.stringify({ best: 10 }), { status: 201 });
      }
      return api.fetch(input, init);
    }) as typeof globalThis.fetch;
    const storage = storageWithData();
    const c = new Client({ apiOrigin: API, game: 'g', fetch, storage, now: () => NOW });
    await c.token();

    void c.submitScore(10, 60_000);
    await settle();
    const deleting = c.requestDelete();
    await settle();
    expect(order).toEqual([]);
    finishPost();
    await deleting;

    expect(order).toEqual(['score', 'delete']);
    expect(c.deleteState()).toBe('done');
    expect(api.calls.some((call) => call.path === '/players')).toBe(false);
  });

  it('消せなければ failed にし、ID とスコアは残して送り続ける', async () => {
    const api = fakeApi({
      'GET /games/g/scores/me': () => [200, { best: 300 }],
      'DELETE /players/me': () => [503, { error: 'unavailable' }],
      'POST /games/g/scores': () => [201, { best: 400 }],
    });
    const storage = storageWithData();
    const c = client(api, storage);
    await c.requestDelete();

    expect(c.deleteState()).toBe('failed');
    expect(c.isReady()).toBe(true);
    expect(storage.data.get('roommate.best.g')).toBe('300');

    await c.submitScore(400, 60_000);
    expect(api.calls.some((call) => call.path === '/games/g/scores')).toBe(true);
  });

  it('ID の発行に失敗していても、保存してあるトークンで消す', async () => {
    const expired = { ...stored, expiresAt: nowSeconds - 1 };
    const api = fakeApi({
      'POST /players/me/token': () => [503, { error: 'unavailable' }],
      'DELETE /players/me': (call) => {
        expect(call.auth).toBe('Bearer old');
        return [204, null];
      },
    });
    const storage = memoryStorage({ 'roommate.player': JSON.stringify(expired) });
    const c = client(api, storage);
    await c.requestDelete();

    expect(c.deleteState()).toBe('done');
    expect(storage.data.size).toBe(0);
  });

  it('トークンが無ければ、端末のキーだけ消す', async () => {
    const api = fakeApi({ 'POST /players': () => [503, { error: 'unavailable' }] });
    const storage = memoryStorage({ 'roommate.best.g': '10' });
    const c = client(api, storage);
    await c.requestDelete();

    expect(c.deleteState()).toBe('done');
    expect(storage.data.size).toBe(0);
    expect(api.calls.some((call) => call.method === 'DELETE')).toBe(false);
  });
});

describe('Client の名前', () => {
  const stored = { playerId: 'p0', token: 'old', expiresAt: nowSeconds + 20 * 86400 };
  const withPlayer = (extra: Record<string, string> = {}) =>
    memoryStorage({ 'roommate.player': JSON.stringify(stored), ...extra });

  it('名前が無く、まだ聞いていなければ聞く', async () => {
    const api = fakeApi({ 'GET /players/me': () => [200, { playerId: 'p0', name: null }] });
    const c = client(api, withPlayer());
    expect(await c.shouldAskName()).toBe(true);
    expect(c.name()).toBeNull();
  });

  it('名前があれば聞かない', async () => {
    const api = fakeApi({ 'GET /players/me': () => [200, { playerId: 'p0', name: 'あおい' }] });
    const c = client(api, withPlayer());
    expect(await c.shouldAskName()).toBe(false);
    expect(c.name()).toBe('あおい');
  });

  it('一度聞いたら、名前が無くても次からは聞かない', async () => {
    const api = fakeApi({ 'GET /players/me': () => [200, { playerId: 'p0', name: null }] });
    const storage = withPlayer();
    client(api, storage).markNameAsked();
    expect(await client(api, storage).shouldAskName()).toBe(false);
    expect(api.calls.filter((call) => call.path === '/players/me')).toEqual([]);
  });

  it('名前を読めなければ聞かない', async () => {
    const api = fakeApi({ 'GET /players/me': () => [500, {}] });
    expect(await client(api, withPlayer()).shouldAskName()).toBe(false);
  });

  it('名前を付けると保存し、聞いたことも覚える', async () => {
    const api = fakeApi({ 'PUT /players/me/name': (call) => [200, call.body] });
    const storage = withPlayer();
    const c = client(api, storage);
    expect(await c.setName('あおい')).toBe('saved');
    expect(c.name()).toBe('あおい');
    expect(storage.data.get('roommate.name-asked')).toBe('1');
    const put = api.calls.find((call) => call.method === 'PUT')!;
    expect(put.auth).toBe('Bearer old');
    expect(put.body).toEqual({ name: 'あおい' });
  });

  it('受け付けられない名前なら invalid、通信できなければ failed を返す', async () => {
    const invalid = fakeApi({ 'PUT /players/me/name': () => [400, { error: 'invalid_name' }] });
    expect(await client(invalid, withPlayer()).setName('a#b')).toBe('invalid');
    const down = fakeApi({ 'PUT /players/me/name': () => [503, {}] });
    expect(await client(down, withPlayer()).setName('あおい')).toBe('failed');
  });

  it('トークンが通らなければ、ID をもらい直して付け直す', async () => {
    const api = fakeApi({
      'POST /players': () => [201, issued],
      'PUT /players/me/name': (call) =>
        call.auth === 'Bearer new-token' ? [200, call.body] : [401, { error: 'unauthorized' }],
    });
    const c = client(api, withPlayer());
    expect(await c.setName('あおい')).toBe('saved');
    expect(await c.token()).toBe('new-token');
  });

  it('消したあとは聞かず、付けもしない', async () => {
    const api = fakeApi({
      'DELETE /players/me': () => [204, null],
      'GET /players/me': () => [200, { playerId: 'p0', name: null }],
    });
    const storage = withPlayer({ 'roommate.name-asked': '1' });
    const c = client(api, storage);
    await c.requestDelete();
    expect(storage.data.has('roommate.name-asked')).toBe(false);
    expect(await c.shouldAskName()).toBe(false);
    expect(await c.setName('あおい')).toBe('failed');
  });
});

describe('courseDay', () => {
  it('端末の時間帯にかかわらず UTC の日付を返す', () => {
    expect(courseDay(new Date('2026-01-05T23:30:00+09:00'))).toBe('2026-01-05');
    // 日本時間の 0〜9 時は、まだ前日のコース
    expect(courseDay(new Date('2026-01-06T08:59:00+09:00'))).toBe('2026-01-05');
    expect(courseDay(new Date('2026-01-06T09:00:00+09:00'))).toBe('2026-01-06');
  });
});
