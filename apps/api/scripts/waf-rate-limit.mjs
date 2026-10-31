#!/usr/bin/env node
// API のホスト名に、IP ごとの rate limiting ルールを 1 つ入れる。CI のデプロイから呼ぶ。
// zone にある他のルールは残し、description が同じルールだけを置き換える。
//   CLOUDFLARE_API_TOKEN が要る(zone の Zone: Read と Zone WAF: Edit)
//   --dry-run を付けると、送る内容を出すだけにする

const ZONE = 'hayashi-naoki.com';
const HOST = 'api.roommate.hayashi-naoki.com';
const DESCRIPTION = 'roommate-api: IP ごとの rate limiting';

// 無料プランでは period と mitigation_timeout は 10 秒に固定
export const rule = {
  description: DESCRIPTION,
  expression: `(http.host eq "${HOST}")`,
  action: 'block',
  ratelimit: {
    characteristics: ['cf.colo.id', 'ip.src'],
    period: 10,
    requests_per_period: 100,
    mitigation_timeout: 10,
  },
  enabled: true,
};

/** 既存のルールから同じ description のものを除き、このルールを足す */
export function mergeRules(existing) {
  const others = existing
    .filter((r) => r.description !== DESCRIPTION)
    // 読み取り専用の項目は送り返さない
    .map((r) => {
      const copy = { ...r };
      delete copy.version;
      delete copy.last_updated;
      return copy;
    });
  return [...others, rule];
}

async function api(path, init = {}) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
  });
  const body = await res.json();
  return { status: res.status, body };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  if (!process.env.CLOUDFLARE_API_TOKEN) throw new Error('CLOUDFLARE_API_TOKEN を設定する');

  const zones = await api(`/zones?name=${ZONE}`);
  const zoneId = zones.body.result?.[0]?.id;
  if (!zoneId) throw new Error(`zone ${ZONE} が見つからない: ${JSON.stringify(zones.body.errors)}`);

  const path = `/zones/${zoneId}/rulesets/phases/http_ratelimit/entrypoint`;
  const current = await api(path);
  // まだルールセットが無ければ 404 になる
  if (current.status !== 200 && current.status !== 404) {
    throw new Error(`ルールを読めない: ${JSON.stringify(current.body.errors)}`);
  }
  const rules = mergeRules(current.body.result?.rules ?? []);

  if (dryRun) {
    console.log(JSON.stringify({ rules }, null, 2));
    return;
  }
  const updated = await api(path, { method: 'PUT', body: JSON.stringify({ rules }) });
  if (!updated.body.success) {
    throw new Error(`ルールを入れられない: ${JSON.stringify(updated.body.errors)}`);
  }
  console.log(`${HOST} に rate limiting ルールを入れた(ルール ${rules.length} 件)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
