import { games } from '@roommate/catalog';
import { type Context, Hono } from 'hono';
import { cors } from 'hono/cors';
import { isAllowedOrigin } from './origins.ts';
import { players } from './players.ts';
import { rooms } from './rooms.ts';
import { scores } from './scores.ts';

const app = new Hono<{ Bindings: Env }>();

const appCors = cors({
  origin: (origin, c: Context<{ Bindings: Env }>) =>
    isAllowedOrigin(origin, c.env.ALLOWED_ORIGINS) ? origin : null,
  allowHeaders: ['Authorization', 'Content-Type'],
  allowMethods: ['GET', 'POST', 'DELETE'],
  maxAge: 86400,
});

app.use('*', appCors);

app.get('/health', (c) => c.json({ ok: true }));

app.get('/games', (c) => c.json({ games }));

app.route('/players', players);
app.route('/', scores);
app.route('/', rooms);

export { Room } from './room.ts';

export default app;
