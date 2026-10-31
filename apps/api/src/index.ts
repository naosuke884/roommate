import { games } from '@roommate/catalog';
import { type Context, Hono } from 'hono';
import { cors } from 'hono/cors';
import { players } from './players.ts';

const app = new Hono<{ Bindings: Env }>();

app.use(
  '*',
  cors({
    origin: (origin, c: Context<{ Bindings: Env }>) => {
      const allowed = c.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim());
      return allowed.includes(origin) ? origin : null;
    },
    allowHeaders: ['Authorization', 'Content-Type'],
    allowMethods: ['GET', 'POST'],
    maxAge: 86400,
  }),
);

app.get('/health', (c) => c.json({ ok: true }));

app.get('/games', (c) => c.json({ games }));

app.route('/players', players);

export default app;
