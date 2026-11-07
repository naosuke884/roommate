import { Hono } from 'hono';
import { verificationSecrets, verifyPlayerToken } from './auth.ts';
import { displayName } from './names.ts';
import { isAllowedOrigin } from './origins.ts';
import { DISPLAY_NAME_HEADER } from './room.ts';

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
  const playerId = token && (await verifyPlayerToken(token, verificationSecrets(c.env)));
  if (!playerId) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const key = c.req.param('key');
  if (!ROOM_KEY.test(key)) {
    return c.json({ error: 'invalid_room_key' }, 400);
  }

  // 部屋の他の人に見せる名前は、送る人の申告ではなくここで決める。ヘッダーは ASCII だけなので符号化して渡す
  const row = await c.env.DB.prepare('SELECT name FROM players WHERE id = ?')
    .bind(playerId)
    .first<{ name: string | null }>();
  const forwarded = new Request(c.req.raw);
  forwarded.headers.set(
    DISPLAY_NAME_HEADER,
    encodeURIComponent(displayName(row?.name ?? null, playerId)),
  );

  for (let shard = 0; shard < MAX_SHARDS; shard++) {
    const room = c.env.ROOM.getByName(`${key}#${shard}`);
    const res = await room.fetch(new Request(forwarded));
    if (res.status !== 409) {
      return res;
    }
  }
  return c.json({ error: 'rooms_full' }, 503);
});
