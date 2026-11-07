import { games } from '@roommate/catalog';
import { type Context, Hono } from 'hono';
import { cors } from 'hono/cors';
import { isAllowedOrigin } from './origins.ts';
import { deleteUnusedPlayers, players } from './players.ts';
import { presence } from './presence.ts';
import { rooms } from './rooms.ts';
import { scores } from './scores.ts';

const app = new Hono<{ Bindings: Env }>();

const appCors = cors({
  origin: (origin, c: Context<{ Bindings: Env }>) =>
    isAllowedOrigin(origin, c.env.ALLOWED_ORIGINS) ? origin : null,
  allowHeaders: ['Authorization', 'Content-Type'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
  maxAge: 86400,
});

app.use('*', appCors);

app.get('/health', (c) => c.json({ ok: true }));

app.get('/games', (c) => c.json({ games }));

app.route('/players', players);
app.route('/', presence);
app.route('/', scores);
app.route('/', rooms);

export { Room } from './room.ts';

export default {
  fetch: app.fetch,
  // 毎日、使われなかった匿名 ID を消す(wrangler.jsonc の triggers.crons)
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      deleteUnusedPlayers(env.DB).then((count) =>
        console.log(`使われなかった ID を ${count} 件消した`),
      ),
    );
  },
} satisfies ExportedHandler<Env>;
