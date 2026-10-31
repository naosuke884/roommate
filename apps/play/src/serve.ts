import { findGame } from '@roommate/catalog';

const FILE_SEGMENT = /^[A-Za-z0-9._-]+$/;

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  css: 'text/css; charset=utf-8',
  gif: 'image/gif',
  html: 'text/html; charset=utf-8',
  ico: 'image/x-icon',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  js: 'text/javascript; charset=utf-8',
  json: 'application/json',
  map: 'application/json',
  mjs: 'text/javascript; charset=utf-8',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  png: 'image/png',
  svg: 'image/svg+xml',
  txt: 'text/plain; charset=utf-8',
  wasm: 'application/wasm',
  wav: 'audio/wav',
  webm: 'video/webm',
  webp: 'image/webp',
};

export type ObjectTarget = {
  key: string;
  filename: string;
};

export type ResolvedPath =
  | { kind: 'redirect'; pathname: string }
  | { kind: 'object'; target: ObjectTarget }
  | { kind: 'not-found' };

/**
 * `/<slug>/` を `index.html` に、`/<slug>/<file>` を R2 キー `<slug>/<file>` に対応させる。
 * `?v=` はキーに含めない。`..` やスラッシュを含む名前は配信しない。
 */
export function resolvePath(pathname: string): ResolvedPath {
  if (!pathname.startsWith('/')) return { kind: 'not-found' };

  let parts: string[];
  try {
    parts = pathname.split('/').map((part) => decodeURIComponent(part));
  } catch {
    return { kind: 'not-found' };
  }

  // 先頭の `/` が空要素になる。途中の空要素は `//` なので拒否する。
  if (parts[0] !== '') return { kind: 'not-found' };
  parts = parts.slice(1);
  const directory = pathname.endsWith('/');
  if (directory) parts = parts.slice(0, -1);
  if (parts.some((part) => part.length === 0)) return { kind: 'not-found' };
  if (parts.length === 0) return { kind: 'not-found' };

  const [slug, ...rest] = parts;
  if (slug === undefined || !findGame(slug)) return { kind: 'not-found' };

  if (rest.length === 0) {
    if (!directory) return { kind: 'redirect', pathname: `${pathname}/` };
    return { kind: 'object', target: { key: `${slug}/index.html`, filename: 'index.html' } };
  }
  if (directory) return { kind: 'not-found' };
  if (!rest.every((part) => part !== '.' && part !== '..' && FILE_SEGMENT.test(part))) {
    return { kind: 'not-found' };
  }

  const filename = rest[rest.length - 1];
  if (filename === undefined) return { kind: 'not-found' };
  return { kind: 'object', target: { key: [slug, ...rest].join('/'), filename } };
}

/**
 * `index.html` はキャッシュさせない。それ以外は `?v=<commit>` が付いているときだけ長くキャッシュする。
 * 付いていない `.wasm` や JS を長くキャッシュすると、更新後に古いファイルと新しいファイルが組み合わさる。
 */
export function cacheControl(filename: string, version: string | null): string {
  const html = filename.toLowerCase().endsWith('.html');
  if (html || version === null || version.length === 0) return 'no-cache';
  return 'public, max-age=31536000, immutable';
}

/** 拡張子で Content-Type を決める。アップロード時のメタデータは使わない */
export function contentType(filename: string): string {
  const extension = filename.split('.').pop()?.toLowerCase() ?? '';
  return CONTENT_TYPES[extension] ?? 'application/octet-stream';
}

function isHttpOrigin(value: string): boolean {
  if (value.includes('*')) return false;
  try {
    const url = new URL(value);
    return (
      url.origin === value &&
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      url.username === '' &&
      url.password === ''
    );
  } catch {
    return false;
  }
}

/** CSP の frame-ancestors。通らない値は落とす。1 件も無ければ誰の埋め込みも許さない */
export function contentSecurityPolicy(origins: readonly string[]): string {
  const safe = origins.filter(isHttpOrigin);
  if (safe.length === 0) return "frame-ancestors 'none'";
  return `frame-ancestors ${safe.join(' ')}`;
}
