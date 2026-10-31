import { siteOrigin } from '@roommate/catalog';
import { cacheControl, contentSecurityPolicy, contentType, resolvePath } from './serve.ts';

// 埋め込みを許すのはブランドサイトだけ。itch.io は入れない。
const FRAME_ANCESTORS = [siteOrigin];

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const csp = contentSecurityPolicy(FRAME_ANCESTORS);
    const url = new URL(request.url);

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return text(request.method, 'Method Not Allowed', 405, csp, { Allow: 'GET, HEAD' });
    }

    const resolved = resolvePath(url.pathname);
    if (resolved.kind === 'not-found') return text(request.method, 'Not Found', 404, csp);
    if (resolved.kind === 'redirect') {
      const location = new URL(request.url);
      location.pathname = resolved.pathname;
      return new Response(null, {
        status: 308,
        headers: baseHeaders(csp, { Location: location.toString(), 'Cache-Control': 'no-cache' }),
      });
    }

    const version = url.searchParams.get('v');
    if (request.method === 'HEAD') {
      const head = await env.GAMES.head(resolved.target.key);
      if (!head) return text(request.method, 'Not Found', 404, csp);
      return new Response(null, {
        status: 200,
        headers: fileHeaders(csp, resolved.target.filename, version, head),
      });
    }

    const object = await env.GAMES.get(resolved.target.key);
    if (!object) return text(request.method, 'Not Found', 404, csp);
    return new Response(object.body, {
      status: 200,
      headers: fileHeaders(csp, resolved.target.filename, version, object),
    });
  },
} satisfies ExportedHandler<Env>;

function fileHeaders(
  csp: string,
  filename: string,
  version: string | null,
  object: { size: number; httpEtag: string },
): Headers {
  return baseHeaders(csp, {
    'Content-Type': contentType(filename),
    'Cache-Control': cacheControl(filename, version),
    'Content-Length': String(object.size),
    ETag: object.httpEtag,
  });
}

function baseHeaders(csp: string, extra: Record<string, string>): Headers {
  const headers = new Headers(extra);
  headers.set('Content-Security-Policy', csp);
  headers.set('X-Content-Type-Options', 'nosniff');
  return headers;
}

function text(
  method: string,
  body: string,
  status: number,
  csp: string,
  extra: Record<string, string> = {},
): Response {
  const headers = baseHeaders(csp, extra);
  headers.set('Content-Type', 'text/plain; charset=utf-8');
  headers.set('Cache-Control', 'no-cache');
  headers.set('Content-Length', String(new TextEncoder().encode(body).byteLength));
  return new Response(method === 'HEAD' ? null : body, { status, headers });
}
