import { createMiddleware } from 'hono/factory';
import { sign, verify } from 'hono/jwt';

const ISSUER = 'roommate';
export const TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
/** 期限が切れてから、同じ ID で発行し直せる間 */
export const REFRESH_GRACE_SECONDS = 365 * 24 * 60 * 60;

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

/**
 * 発行し直すためのトークンを確かめ、プレイヤー ID を返す。期限切れでも
 * `REFRESH_GRACE_SECONDS` の間は受け付ける。署名が違うものは受け付けない
 */
export async function verifyRefreshToken(
  token: string,
  secret: string,
  now = Math.floor(Date.now() / 1000),
): Promise<string | undefined> {
  try {
    const payload = await verify(token, secret, { alg: 'HS256', iss: ISSUER, exp: false });
    if (typeof payload.exp !== 'number' || payload.exp + REFRESH_GRACE_SECONDS <= now) {
      return undefined;
    }
    return typeof payload.sub === 'string' ? payload.sub : undefined;
  } catch {
    return undefined;
  }
}

function bearer(header: string | undefined): string | undefined {
  return header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
}

/** `Authorization: Bearer <token>` を確かめ、`c.var.playerId` に入れる */
export const requirePlayer = createMiddleware<{
  Bindings: Env;
  Variables: { playerId: string };
}>(async (c, next) => {
  const token = bearer(c.req.header('Authorization'));
  const playerId = token && (await verifyPlayerToken(token, c.env.JWT_SECRET));
  if (!playerId) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  c.set('playerId', playerId);
  await next();
});

/** 発行し直すためのトークンを確かめる。期限切れでも猶予の間は通す */
export const requireRefreshablePlayer = createMiddleware<{
  Bindings: Env;
  Variables: { playerId: string };
}>(async (c, next) => {
  const token = bearer(c.req.header('Authorization'));
  const playerId = token && (await verifyRefreshToken(token, c.env.JWT_SECRET));
  if (!playerId) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  c.set('playerId', playerId);
  await next();
});
