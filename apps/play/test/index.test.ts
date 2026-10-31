import { siteOrigin } from '@roommate/catalog';
import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { cacheControl, contentSecurityPolicy, contentType, resolvePath } from '../src/serve.ts';

const ORIGIN = 'https://play.example';

function request(path: string, method = 'GET') {
  return exports.default.fetch(new Request(`${ORIGIN}${path}`, { method, redirect: 'manual' }));
}

async function put(
  key: string,
  body: string | Uint8Array,
  httpMetadata?: R2HTTPMetadata,
): Promise<void> {
  await env.GAMES.put(key, body, httpMetadata ? { httpMetadata } : undefined);
}

describe('resolvePath', () => {
  it('スラッシュ無しのゲームパスは末尾スラッシュへ返す', () => {
    expect(resolvePath('/browser-game-1')).toEqual({
      kind: 'redirect',
      pathname: '/browser-game-1/',
    });
  });

  it('ディレクトリは index.html になる', () => {
    expect(resolvePath('/browser-game-1/')).toEqual({
      kind: 'object',
      target: { key: 'browser-game-1/index.html', filename: 'index.html' },
    });
  });

  it('ファイルは slug を含めたキーになる', () => {
    expect(resolvePath('/browser-game-1/browser-game-1.wasm')).toEqual({
      kind: 'object',
      target: { key: 'browser-game-1/browser-game-1.wasm', filename: 'browser-game-1.wasm' },
    });
  });

  it('知らないゲームと、パスを遡る指定は配信しない', () => {
    expect(resolvePath('/other-game/index.html').kind).toBe('not-found');
    expect(resolvePath('/browser-game-1/%2e%2e%2fsecret').kind).toBe('not-found');
    expect(resolvePath('//browser-game-1/index.html').kind).toBe('not-found');
    expect(resolvePath('/').kind).toBe('not-found');
  });
});

describe('キャッシュと Content-Type', () => {
  it('index.html は v が付いてもキャッシュしない', () => {
    expect(cacheControl('index.html', 'abc')).toBe('no-cache');
    expect(cacheControl('index.html', null)).toBe('no-cache');
  });

  it('v が付いた wasm と JS だけ長くキャッシュする', () => {
    expect(cacheControl('game.wasm', 'abc')).toBe('public, max-age=31536000, immutable');
    expect(cacheControl('mq_js_bundle.js', 'abc')).toBe('public, max-age=31536000, immutable');
    expect(cacheControl('game.wasm', null)).toBe('no-cache');
    expect(cacheControl('mq_js_bundle.js', '')).toBe('no-cache');
  });

  it('wasm は application/wasm で、拡張子の無い名前は octet-stream', () => {
    expect(contentType('browser-game-1.wasm')).toBe('application/wasm');
    expect(contentType('README')).toBe('application/octet-stream');
  });

  it('frame-ancestors はブランドサイトだけで、壊れた値は落とす', () => {
    expect(contentSecurityPolicy([siteOrigin])).toBe(`frame-ancestors ${siteOrigin}`);
    expect(contentSecurityPolicy([siteOrigin])).not.toContain('itch.io');
    expect(contentSecurityPolicy(['https://evil.example/path', 'not a url', '*'])).toBe(
      "frame-ancestors 'none'",
    );
  });
});

describe('配信', () => {
  it('index.html をキャッシュせず、本文も CSP もそのまま返す', async () => {
    const html = '<!doctype html><script src="mq_js_bundle.js?v=abc"></script>';
    await put('browser-game-1/index.html', html, { contentType: 'text/plain' });

    const res = await request('/browser-game-1/');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(html);
    expect(res.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    expect(res.headers.get('Cache-Control')).toBe('no-cache');
    expect(res.headers.get('Content-Security-Policy')).toBe(`frame-ancestors ${siteOrigin}`);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('スラッシュが無いパスはクエリを残して末尾スラッシュへ返す', async () => {
    const res = await request('/browser-game-1?v=abc');
    expect(res.status).toBe(308);
    expect(res.headers.get('Location')).toBe(`${ORIGIN}/browser-game-1/?v=abc`);
    expect(res.headers.get('Content-Security-Policy')).toBe(`frame-ancestors ${siteOrigin}`);
  });

  it('v 付きの wasm は application/wasm で長くキャッシュし、キーには v を使わない', async () => {
    const wasm = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
    await put('browser-game-1/browser-game-1.wasm', wasm, {
      contentType: 'application/octet-stream',
      cacheControl: 'public, max-age=9',
    });

    const res = await request('/browser-game-1/browser-game-1.wasm?v=abc&other=1');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/wasm');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(wasm);
  });

  it('v の無い wasm はキャッシュしない', async () => {
    await put('browser-game-1/browser-game-1.wasm', new Uint8Array([0x00, 0x61, 0x73, 0x6d]));
    const res = await request('/browser-game-1/browser-game-1.wasm');
    expect(res.headers.get('Cache-Control')).toBe('no-cache');
    expect(res.headers.get('Content-Type')).toBe('application/wasm');
  });

  it('新しいビルドで上書きすると、古い v でも新しい中身が返る', async () => {
    await put('browser-game-1/mq_js_bundle.js', 'old');
    expect(await (await request('/browser-game-1/mq_js_bundle.js?v=old')).text()).toBe('old');

    await put('browser-game-1/mq_js_bundle.js', 'new');
    expect(await (await request('/browser-game-1/mq_js_bundle.js?v=old')).text()).toBe('new');
    expect(await (await request('/browser-game-1/mq_js_bundle.js?v=new')).text()).toBe('new');
  });

  it('置いていないファイルと、カタログに無いゲームは 404 で、CSP を付ける', async () => {
    await put('other-game/index.html', 'secret');
    for (const path of ['/browser-game-1/missing.js', '/other-game/', '/']) {
      const res = await request(path);
      expect(res.status).toBe(404);
      expect(res.headers.get('Content-Security-Policy')).toBe(`frame-ancestors ${siteOrigin}`);
      expect(await res.text()).toBe('Not Found');
    }
  });

  it('HEAD は本文を返さない', async () => {
    await put('browser-game-1/storage.js', 'var storage;');
    const res = await request('/browser-game-1/storage.js?v=abc', 'HEAD');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
    expect(res.headers.get('Content-Type')).toBe('text/javascript; charset=utf-8');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(res.headers.get('Content-Length')).toBe(
      String(new TextEncoder().encode('var storage;').length),
    );
  });

  it('無いファイルへの HEAD は本文を返さない', async () => {
    const res = await request('/browser-game-1/missing.js', 'HEAD');
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('');
    expect(res.headers.get('Content-Security-Policy')).toBe(`frame-ancestors ${siteOrigin}`);
  });

  it('GET と HEAD 以外は 405', async () => {
    const res = await request('/browser-game-1/', 'PUT');
    expect(res.status).toBe(405);
    expect(res.headers.get('Allow')).toBe('GET, HEAD');
  });
});
