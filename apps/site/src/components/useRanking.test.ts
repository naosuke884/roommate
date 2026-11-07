import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Entry, useRanking } from './useRanking.ts';

const API = 'https://api.example';
const NOW = new Date('2026-06-15T12:00:00Z');
const URL_TODAY = `${API}/games/my%20game/rankings/2026-06-15`;

const entries: Entry[] = [
  { rank: 1, name: 'alice', score: 300 },
  { rank: 2, name: 'bob', score: 200 },
];

/** 応答を後から決められる fetch の代わり。呼ばれた順に URL と init を記録する */
function fakeFetch() {
  const pending: { resolve: (res: Response) => void; reject: (error: unknown) => void }[] = [];
  const fetch = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(
    () => new Promise((resolve, reject) => void pending.push({ resolve, reject })),
  );
  vi.stubGlobal('fetch', fetch);
  return {
    fetch,
    respond: (index: number, status: number, body: unknown) =>
      pending[index]!.resolve(new Response(JSON.stringify(body), { status })),
    fail: (index: number, error: unknown) => pending[index]!.reject(error),
  };
}

/** bfcache から復元されたときなどの pageshow を送る */
function pageshow(persisted: boolean) {
  // happy-dom には PageTransitionEvent が無い
  const event = new Event('pageshow');
  Object.defineProperty(event, 'persisted', { value: persisted });
  act(() => void window.dispatchEvent(event));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useRanking', () => {
  it('応答が来るまでは loading', () => {
    const { fetch } = fakeFetch();
    const { result } = renderHook(() => useRanking(API, 'my game'));

    expect(result.current).toEqual({ status: 'loading' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]![0]).toBe(URL_TODAY);
    expect(fetch.mock.calls[0]![1]).toMatchObject({ cache: 'default' });
  });

  it('読めたら UTC の日付と順位を返す', async () => {
    const api = fakeFetch();
    const { result } = renderHook(() => useRanking(API, 'my game'));

    api.respond(0, 200, { entries });

    await waitFor(() =>
      expect(result.current).toEqual({ status: 'ready', day: '2026-06-15', entries }),
    );
  });

  it('API がエラーを返したら error', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const api = fakeFetch();
    const { result } = renderHook(() => useRanking(API, 'my game'));

    api.respond(0, 500, { error: 'internal' });

    await waitFor(() => expect(result.current).toEqual({ status: 'error' }));
    expect(error).toHaveBeenCalled();
  });

  it('通信に失敗したら error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const api = fakeFetch();
    const { result } = renderHook(() => useRanking(API, 'my game'));

    api.fail(0, new TypeError('Failed to fetch'));

    await waitFor(() => expect(result.current).toEqual({ status: 'error' }));
  });

  it('bfcache から戻ったら、ブラウザのキャッシュを使わずに読み直す', async () => {
    const api = fakeFetch();
    const { result } = renderHook(() => useRanking(API, 'my game'));
    api.respond(0, 200, { entries });
    await waitFor(() => expect(result.current.status).toBe('ready'));

    pageshow(true);

    expect(api.fetch).toHaveBeenCalledTimes(2);
    expect(api.fetch.mock.calls[1]![0]).toBe(URL_TODAY);
    expect(api.fetch.mock.calls[1]![1]).toMatchObject({ cache: 'no-cache' });

    const played: Entry[] = [{ rank: 1, name: 'me', score: 999 }, ...entries];
    api.respond(1, 200, { entries: played });
    await waitFor(() =>
      expect(result.current).toEqual({ status: 'ready', day: '2026-06-15', entries: played }),
    );
  });

  it('読み直す前の読み込みは止め、エラーにしない', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const api = fakeFetch();
    const { result } = renderHook(() => useRanking(API, 'my game'));

    pageshow(true);
    expect(api.fetch.mock.calls[0]![1]!.signal!.aborted).toBe(true);

    const played: Entry[] = [{ rank: 1, name: 'me', score: 999 }];
    api.respond(1, 200, { entries: played });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    api.fail(0, new DOMException('aborted', 'AbortError'));

    await act(async () => {});
    expect(result.current).toEqual({ status: 'ready', day: '2026-06-15', entries: played });
    expect(error).not.toHaveBeenCalled();
  });

  it('bfcache からでない pageshow では読み直さない', () => {
    const api = fakeFetch();
    renderHook(() => useRanking(API, 'my game'));

    pageshow(false);

    expect(api.fetch).toHaveBeenCalledTimes(1);
  });
});
