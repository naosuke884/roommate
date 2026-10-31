import { createMiddleware } from 'hono/factory';
import { sign, verify } from 'hono/jwt';

const ISSUER = 'roommate';
export const TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface PlayerToken {
  playerId: string;
  token: string;
  /** UNIX 秒 */
  expiresAt: number;
}

export async function issuePlayerToken(
  playerId: string,
  secret: string,
  now = Math.floor(Date.now() / 1000),
): Promise<PlayerToken> {
  const expiresAt = now + TOKEN_TTL_SECONDS;
  const token = await sign(
    { iss: ISSUER, sub: playerId, iat: now, exp: expiresAt },
    secret,
    'HS256',
  );
  return { playerId, token, expiresAt };
}

/** 署名と有効期限を確かめ、プレイヤー ID を返す。不正なら undefined */
export async function verifyPlayerToken(
  token: string,
  secret: string,
): Promise<string | undefined> {
  try {
    const payload = await verify(token, secret, { alg: 'HS256', iss: ISSUER });
    return typeof payload.sub === 'string' ? payload.sub : undefined;
  } catch {
    return undefined;
  }
}

/** `Authorization: Bearer <token>` を確かめ、`c.var.playerId` に入れる */
export const requirePlayer = createMiddleware<{
  Bindings: Env;
  Variables: { playerId: string };
}>(async (c, next) => {
  const header = c.req.header('Authorization');
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
  const playerId = token && (await verifyPlayerToken(token, c.env.JWT_SECRET));
  if (!playerId) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  c.set('playerId', playerId);
  await next();
});
