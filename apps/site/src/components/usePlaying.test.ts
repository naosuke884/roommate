import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PLAYING_REFRESH_MS, usePlaying } from './usePlaying.ts';

const API = 'https://api.example';

function stubFetch(...counts: number[]) {
  const fetch = vi.fn<(input: string) => Promise<Response>>(() =>
    Promise.resolve(
      new Response(JSON.stringify({ playing: counts.shift() ?? 0 }), { status: 200 }),
    ),
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

/** fetch の応答と state の更新を済ませる。setInterval を偽物にしているので waitFor は使えない */
const settle = () => act(async () => {});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('usePlaying', () => {
  it('人数を読み、一定の間隔で読み直す', async () => {
    const fetch = stubFetch(3, 5);
    const { result } = renderHook(() => usePlaying(API, 'my game'));
    expect(result.current).toBeNull();
    await settle();
    expect(result.current).toBe(3);
    expect(fetch).toHaveBeenCalledWith(`${API}/games/my%20game/presence`, expect.anything());

    act(() => void vi.advanceTimersByTime(PLAYING_REFRESH_MS));
    await settle();
    expect(result.current).toBe(5);
  });

  it('読めなければ null のまま', async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response('{}', { status: 500 })));
    vi.stubGlobal('fetch', fetch);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => usePlaying(API, 'g'));
    await settle();
    expect(fetch).toHaveBeenCalled();
    expect(result.current).toBeNull();
  });

  it('外したら読み直さない', () => {
    const fetch = stubFetch(1);
    const { unmount } = renderHook(() => usePlaying(API, 'g'));
    unmount();
    act(() => void vi.advanceTimersByTime(PLAYING_REFRESH_MS * 2));
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
