#!/usr/bin/env node
// デプロイのあと、本番が 200 を返すかを確かめる。CI の deploy job から呼ぶ。
// 反映に数秒かかることがあるので、失敗したら間隔を空けて試し直す。
// `/health` は D1 に触れない。`/grapnl/` の 200 は、ゲームの CI が R2 に置いた
// `grapnl/index.html` があることも前提にしている。
import { pathToFileURL } from 'node:url';
import { playUrl, siteOrigin } from '../src/index.ts';

const { AbortSignal, fetch: globalFetch, setTimeout } = globalThis;

// サイトの API_ORIGIN、roommate-sdk の既定値と同じ
const API_ORIGIN = 'https://api.roommate.hayashi-naoki.com';

export const DEFAULT_ATTEMPTS = 5;
export const DEFAULT_DELAY_MS = 3000;
const REQUEST_TIMEOUT_MS = 10000;

export const productionUrls = [`${API_ORIGIN}/health`, `${siteOrigin}/`, playUrl('grapnl')];

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function release(body) {
  try {
    await body?.cancel();
  } catch {
    // 本文を読めなくても、ステータスは見ている
  }
}

async function probe(urls, fetchImpl) {
  const results = await Promise.all(
    urls.map(async (url) => {
      try {
        const res = await fetchImpl(url, {
          redirect: 'manual',
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        await release(res.body);
        if (res.status === 200) return null;
        return { url, status: res.status };
      } catch (error) {
        return { url, error: errorMessage(error) };
      }
    }),
  );
  return results.filter((failure) => failure !== null);
}

/**
 * すべての URL が 200 になるまで試す。最後まで届かなければ、失敗した URL を返す。
 * @param {readonly string[]} urls
 * @param {{
 *   fetch?: typeof globalFetch,
 *   attempts?: number,
 *   delayMs?: number,
 *   sleep?: (ms: number) => Promise<void>,
 *   onAttempt?: (info: {
 *     attempt: number,
 *     failures: { url: string, status?: number, error?: string }[],
 *   }) => void,
 * }} [options]
 */
export async function checkProduction(urls, options = {}) {
  const fetchImpl = options.fetch ?? globalFetch;
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
  const wait = options.sleep ?? sleep;

  let failures = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    failures = await probe(urls, fetchImpl);
    options.onAttempt?.({ attempt, failures });
    if (failures.length === 0) return { ok: true };
    if (attempt < attempts) await wait(delayMs);
  }
  return { ok: false, failures };
}

function formatFailure(failure) {
  const detail = failure.status !== undefined ? String(failure.status) : failure.error;
  return `${failure.url} (${detail})`;
}

async function main() {
  const result = await checkProduction(productionUrls, {
    onAttempt({ attempt, failures }) {
      for (const failure of failures) {
        console.error(`試し ${attempt}/${DEFAULT_ATTEMPTS}: ${formatFailure(failure)}`);
      }
    },
  });
  if (!result.ok) {
    console.error('本番が 200 を返さなかった');
    process.exit(1);
  }
  for (const url of productionUrls) {
    console.log(`200 ${url}`);
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
