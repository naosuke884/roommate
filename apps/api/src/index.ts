import { games, playOrigin, siteOrigin } from '@roommate/catalog';
import { type Context, Hono } from 'hono';
import { cors } from 'hono/cors';
import { players } from './players.ts';

const app = new Hono<{ Bindings: Env }>();

function allowedOrigin(origin: string, configured: string): string | null {
  const allowed = new Set(
    [siteOrigin, playOrigin, ...configured.split(',').map((item) => item.trim())].filter(
      (item) => item.length > 0,
    ),
  );
  return allowed.has(origin) ? origin : null;
}

const appCors = cors({
  origin: (origin, c: Context<{ Bindings: Env }>) => allowedOrigin(origin, c.env.ALLOWED_ORIGINS),
  allowHeaders: ['Authorization', 'Content-Type'],
  allowMethods: ['GET', 'POST'],
  maxAge: 86400,
});

app.use('*', appCors);

app.get('/health', (c) => c.json({ ok: true }));

app.get('/games', (c) => c.json({ games }));

app.route('/players', players);

export default app;
