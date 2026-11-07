import { describe, expect, it, vi } from 'vitest';
import { findGame, playUrl, siteOrigin } from '../src/index.ts';
import {
  DEFAULT_ATTEMPTS,
  DEFAULT_DELAY_MS,
  checkProduction,
  productionUrls,
} from './check-production.mjs';

function response(status) {
  return { status, body: { cancel: async () => {} } };
}

describe('productionUrls', () => {
  it('デプロイ後に 200 を確かめる URL である', () => {
    expect(findGame('grapnl')).toBeDefined();
    expect(productionUrls).toEqual([
      'https://api.roommate.hayashi-naoki.com/health',
      `${siteOrigin}/`,
      playUrl('grapnl'),
    ]);
  });
});

describe('checkProduction', () => {
  it('すべて 200 なら成功し、試し直さない', async () => {
    const fetchImpl = vi.fn(async () => response(200));
    const sleep = vi.fn(async () => {});
    const onAttempt = vi.fn();

    const result = await checkProduction(['https://example.test/a', 'https://example.test/b'], {
      fetch: fetchImpl,
      sleep,
      onAttempt,
      attempts: 3,
    });

    expect(result).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual' });
    expect(fetchImpl.mock.calls[0]?.[1].signal.aborted).toBe(false);
    expect(sleep).not.toHaveBeenCalled();
    expect(onAttempt).toHaveBeenCalledTimes(1);
    expect(onAttempt.mock.calls[0]?.[0].failures).toEqual([]);
  });

  it('200 以外は失敗として間隔を空けて試し直す', async () => {
    const statuses = [503, 308, 200];
    const fetchImpl = vi.fn(async () => response(statuses.shift() ?? 500));
    const sleep = vi.fn(async () => {});
    const onAttempt = vi.fn();

    const result = await checkProduction(['https://example.test/'], {
      fetch: fetchImpl,
      sleep,
      onAttempt,
      attempts: 3,
      delayMs: 25,
    });

    expect(result).toEqual({ ok: true });
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(25);
    expect(onAttempt.mock.calls.map((call) => call[0])).toEqual([
      { attempt: 1, failures: [{ url: 'https://example.test/', status: 503 }] },
      { attempt: 2, failures: [{ url: 'https://example.test/', status: 308 }] },
      { attempt: 3, failures: [] },
    ]);
  });

  it('回数を使い切ったら失敗した URL だけを返す', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (url.endsWith('/ok')) return response(200);
      if (url.endsWith('/missing')) return response(404);
      throw new Error('network');
    });
    const sleep = vi.fn(async () => {});

    const result = await checkProduction(
      ['https://example.test/ok', 'https://example.test/missing', 'https://example.test/down'],
      { fetch: fetchImpl, sleep, attempts: 2, delayMs: 10 },
    );

    expect(result).toEqual({
      ok: false,
      failures: [
        { url: 'https://example.test/missing', status: 404 },
        { url: 'https://example.test/down', error: 'network' },
      ],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(6);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('Error でない失敗も文字列にする', async () => {
    const result = await checkProduction(['https://example.test/'], {
      fetch: async () => {
        throw 'down';
      },
      sleep: async () => {},
      attempts: 1,
    });

    expect(result).toEqual({
      ok: false,
      failures: [{ url: 'https://example.test/', error: 'down' }],
    });
  });

  it('本文を読めなくても 200 なら成功する', async () => {
    const result = await checkProduction(['https://example.test/'], {
      fetch: async () => ({
        status: 200,
        body: {
          cancel: async () => {
            throw new Error('cancel');
          },
        },
      }),
      attempts: 1,
    });

    expect(result).toEqual({ ok: true });
  });

  it('既定では数秒間隔で何度か試す', async () => {
    let calls = 0;
    const sleep = vi.fn(async () => {});
    const result = await checkProduction(['https://example.test/'], {
      fetch: async () => {
        calls += 1;
        return response(calls < DEFAULT_ATTEMPTS ? 503 : 200);
      },
      sleep,
    });

    expect(result).toEqual({ ok: true });
    expect(calls).toBe(DEFAULT_ATTEMPTS);
    expect(DEFAULT_ATTEMPTS).toBeGreaterThan(1);
    expect(DEFAULT_DELAY_MS).toBeGreaterThanOrEqual(1000);
    expect(sleep).toHaveBeenCalledTimes(DEFAULT_ATTEMPTS - 1);
    expect(sleep.mock.calls.every((call) => call[0] === DEFAULT_DELAY_MS)).toBe(true);
  });
});
