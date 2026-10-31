import { games } from '@roommate/catalog';
import { Hono } from 'hono';

const app = new Hono<{ Bindings: Env }>();

app.get('/health', (c) => c.json({ ok: true }));

app.get('/games', (c) => c.json({ games }));

export default app;
