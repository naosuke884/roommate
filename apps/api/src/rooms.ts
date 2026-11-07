import { Hono } from 'hono';
import { verificationSecrets, verifyPlayerToken } from './auth.ts';
import { isAllowedOrigin } from './origins.ts';

// 部屋が埋まったら次の部屋に入れる。これを超えたら断る
const MAX_SHARDS = 50;
const ROOM_KEY = /^[A-Za-z0-9._:-]{1,128}$/;

export const rooms = new Hono<{ Bindings: Env }>();

// ブラウザの WebSocket はヘッダーを付けられないので、トークンは query で受け取る
rooms.get('/rooms/:key', async (c) => {
  if (c.req.header('Upgrade')?.toLowerCase() !== 'websocket') {
    return c.json({ error: 'websocket_required' }, 426);
  }
  if (!isAllowedOrigin(c.req.header('Origin') ?? '', c.env.ALLOWED_ORIGINS)) {
    return c.json({ error: 'forbidden_origin' }, 403);
  }
  const token = c.req.query('token');
  if (!token || !(await verifyPlayerToken(token, verificationSecrets(c.env)))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const key = c.req.param('key');
  if (!ROOM_KEY.test(key)) {
    return c.json({ error: 'invalid_room_key' }, 400);
  }

  for (let shard = 0; shard < MAX_SHARDS; shard++) {
    const room = c.env.ROOM.getByName(`${key}#${shard}`);
    const res = await room.fetch(new Request(c.req.raw));
    if (res.status !== 409) {
      return res;
    }
  }
  return c.json({ error: 'rooms_full' }, 503);
});
