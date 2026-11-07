import { playOrigin } from '@roommate/catalog';
import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { issuePlayerToken } from '../src/auth.ts';
import {
  MAX_MESSAGES_PER_SECOND,
  MAX_MESSAGE_BYTES,
  MAX_PEERS,
  REPLACED_CLOSE_CODE,
  gameOfRoom,
} from '../src/room.ts';
import { issuePlayer, request } from './helpers.ts';

// ゲームは配信用の origin から繋ぐ
const ORIGIN = playOrigin;

interface Peer {
  ws: WebSocket;
  id: number;
  peers: number[];
  names: Record<string, string>;
  texts: unknown[];
  frames: { from: number; data: number[] }[];
  closed?: number;
}

function decode(buffer: ArrayBuffer) {
  const view = new DataView(buffer);
  const frames: { from: number; data: number[] }[] = [];
  for (let offset = 0; offset < buffer.byteLength;) {
    const from = view.getUint16(offset);
    const length = view.getUint16(offset + 2);
    frames.push({ from, data: [...new Uint8Array(buffer, offset + 4, length)] });
    offset += 4 + length;
  }
  return frames;
}

async function connect(key: string, token?: string): Promise<Peer> {
  token ??= (await issuePlayer()).token;
  const res = await request(`/rooms/${key}?token=${token}`, {
    headers: { Upgrade: 'websocket', Origin: ORIGIN },
  });
  expect(res.status).toBe(101);
  const ws = res.webSocket!;
  ws.accept();
  ws.binaryType = 'arraybuffer';
  return new Promise((resolve) => {
    const peer = { ws, texts: [], frames: [] } as unknown as Peer;
    ws.addEventListener('message', (event) => {
      if (typeof event.data === 'string') {
        const message = JSON.parse(event.data) as {
          type: string;
          id: number;
          peers: number[];
          names: Record<string, string>;
        };
        if (message.type === 'welcome') {
          peer.id = message.id;
          peer.peers = message.peers;
          peer.names = message.names;
          resolve(peer);
        } else {
          peer.texts.push(message);
        }
      } else {
        peer.frames.push(...decode(event.data as ArrayBuffer));
      }
    });
    ws.addEventListener('close', (event) => {
      peer.closed = event.code;
    });
  });
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** CI では遅れることがあるので、条件がそろうまで待つ */
async function waitFor(check: () => boolean, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) {
    await wait(20);
  }
}

describe('GET /rooms/:key', () => {
  it('同じ部屋の他の人にだけ、送信者 ID を付けて配る', async () => {
    const a = await connect('relay');
    const b = await connect('relay');
    const c = await connect('relay');
    expect(c.peers.sort()).toEqual([a.id, b.id].sort());

    a.ws.send(new Uint8Array([1, 2, 3]));
    b.ws.send(new Uint8Array([9]));
    await waitFor(() => a.frames.length > 0 && b.frames.length > 0 && c.frames.length >= 2);

    expect(a.frames).toEqual([{ from: b.id, data: [9] }]);
    expect(b.frames).toEqual([{ from: a.id, data: [1, 2, 3] }]);
    expect(c.frames).toEqual(
      expect.arrayContaining([
        { from: a.id, data: [1, 2, 3] },
        { from: b.id, data: [9] },
      ]),
    );
  });

  it('100ms のあいだの送信を 1 つのメッセージにまとめる', async () => {
    const a = await connect('batch');
    const b = await connect('batch');
    let messages = 0;
    b.ws.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') messages++;
    });

    a.ws.send(new Uint8Array([1]));
    a.ws.send(new Uint8Array([2]));
    a.ws.send(new Uint8Array([3]));
    await waitFor(() => b.frames.length >= 3);

    expect(messages).toBe(1);
    expect(b.frames.map((frame) => frame.data[0])).toEqual([1, 2, 3]);
  });

  it('人の出入りを他の人に知らせる', async () => {
    const a = await connect('presence');
    const b = await connect('presence');
    expect(a.texts).toContainEqual({
      type: 'join',
      id: b.id,
      name: expect.stringMatching(/^名無し#/),
    });

    b.ws.close(1000, 'bye');
    await waitFor(() => a.texts.length >= 2);
    expect(a.texts).toContainEqual({ type: 'leave', id: b.id });
  });

  it('入った人と、先にいた人の表示名をサーバーが付けて知らせる', async () => {
    const named = await issuePlayer();
    const res = await request('/players/me/name', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${named.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'あおい' }),
    });
    expect(res.status).toBe(200);
    const a = await connect('names', named.token);
    const b = await connect('names');
    const prefix = named.playerId.slice(0, 4);
    expect(b.names).toEqual({ [a.id]: `あおい#${prefix}` });
    await waitFor(() => a.texts.length > 0);
    expect(a.texts).toContainEqual({
      type: 'join',
      id: b.id,
      name: expect.stringMatching(/^名無し#/),
    });
  });

  it('大きすぎるメッセージを送った接続は閉じる', async () => {
    const a = await connect('large');
    a.ws.send(new Uint8Array(MAX_MESSAGE_BYTES + 1));
    await waitFor(() => a.closed !== undefined);
    expect(a.closed).toBe(1009);
  });

  it('1 秒に送りすぎた接続は閉じる', async () => {
    const a = await connect('flood');
    for (let i = 0; i <= MAX_MESSAGES_PER_SECOND; i++) {
      a.ws.send(new Uint8Array([i]));
    }
    await waitFor(() => a.closed !== undefined);
    expect(a.closed).toBe(1008);
  });

  it('部屋が埋まったら次の部屋に入れる', async () => {
    const first: Peer[] = [];
    for (let i = 0; i < MAX_PEERS; i++) {
      first.push(await connect('full'));
    }
    const extra = await connect('full');
    expect(extra.peers).toEqual([]);

    extra.ws.send(new Uint8Array([7]));
    await wait(250);
    expect(first[0]!.frames).toEqual([]);
  });

  it('同じプレイヤーが入り直すと、前の接続を閉じて席を引き継ぎ、ほかの人には退出を知らせる', async () => {
    const other = await connect('rejoin');
    const { token } = await issuePlayer();
    const first = await connect('rejoin', token);
    const second = await connect('rejoin', token);

    await waitFor(() => first.closed !== undefined);
    expect(first.closed).toBe(REPLACED_CLOSE_CODE);
    expect(second.peers).toEqual([other.id]);
    await waitFor(() => other.texts.length >= 3);
    expect(other.texts).toContainEqual({ type: 'leave', id: first.id });
    expect(other.texts.filter((t) => (t as { type: string }).type === 'leave')).toHaveLength(1);
  });

  it('1 つのトークンでは、部屋の席を 1 つしか取れない', async () => {
    const { token } = await issuePlayer();
    let last: Peer | undefined;
    for (let i = 0; i < MAX_PEERS; i++) {
      last = await connect('hog', token);
    }
    // 1 人で埋められていれば次の部屋に回されて誰もいないはず。同じ部屋に入り、先にいるのは自分の 1 席だけ
    const someone = await connect('hog');
    expect(someone.peers).toEqual([last!.id]);
  });

  it('同じプレイヤーが部屋に入りすぎると 429 を返す', async () => {
    const { token } = await issuePlayer();
    const statuses: number[] = [];
    // 上限は 1 分ごとの窓で数えるので、途中で窓が切り替わっても 1 つの窓で上限を超えるだけ送る
    for (let i = 0; i < 61; i++) {
      const res = await request(`/rooms/limit?token=${token}`, {
        headers: { Upgrade: 'websocket', Origin: ORIGIN },
      });
      statuses.push(res.status);
      res.webSocket?.accept();
      res.webSocket?.close();
    }
    expect(statuses.slice(0, 20).every((s) => s === 101)).toBe(true);
    expect(statuses).toContain(429);
  });

  it('トークンが無ければ 401 を返す', async () => {
    const res = await request('/rooms/auth', { headers: { Upgrade: 'websocket', Origin: ORIGIN } });
    expect(res.status).toBe(401);
  });

  it('前の鍵で署名したトークンでも入れる', async () => {
    const { playerId } = await issuePlayer();
    const { token } = await issuePlayerToken(playerId, env.JWT_SECRET_PREVIOUS!);
    const peer = await connect('previous-key', token);
    peer.ws.close();
  });

  it('許可していない origin からは 403 を返す', async () => {
    const { token } = await issuePlayer();
    const res = await request(`/rooms/auth?token=${token}`, {
      headers: { Upgrade: 'websocket', Origin: 'https://evil.example' },
    });
    expect(res.status).toBe(403);
  });

  it('WebSocket でなければ 426 を返す', async () => {
    const res = await request('/rooms/auth');
    expect(res.status).toBe(426);
  });

  it('部屋キーの形が違えば 400 を返す', async () => {
    const { token } = await issuePlayer();
    const res = await request(`/rooms/${'x'.repeat(129)}?token=${token}`, {
      headers: { Upgrade: 'websocket', Origin: ORIGIN },
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /games/:slug/presence', () => {
  async function playing() {
    const res = await request('/games/grapnl/presence');
    expect(res.status).toBe(200);
    return (await res.json<{ playing: number }>()).playing;
  }

  /** 出た人の分は部屋が後から書くので、期待する人数になるまで待つ */
  async function playingBecomes(expected: number) {
    let now = await playing();
    for (let i = 0; i < 100 && now !== expected; i++) {
      await wait(20);
      now = await playing();
    }
    return now;
  }

  it('同じプレイヤーが部屋をいくつ開いても 1 人と数える', async () => {
    const before = await playing();
    const { token } = await issuePlayer();
    const peers = [];
    for (let i = 1; i <= 3; i++) {
      peers.push(await connect(`grapnl:same-player:${i}`, token));
    }
    expect(await playing()).toBe(before + 1);

    for (const peer of peers) peer.ws.close();
    expect(await playingBecomes(before)).toBe(before);
  });

  it('そのゲームの部屋につながっている人数を足し、出た人は引く', async () => {
    const before = await playing();
    const a = await connect('grapnl:presence:1');
    const b = await connect('grapnl:presence:1');
    const c = await connect('grapnl:presence:2');
    // ほかのゲームの部屋は数えない
    const other = await connect('other-game:presence:1');
    expect(await playing()).toBe(before + 3);

    b.ws.close();
    expect(await playingBecomes(before + 2)).toBe(before + 2);

    for (const peer of [a, c, other]) peer.ws.close();
    expect(await playingBecomes(before)).toBe(before);
  });

  it('しばらく書き直されていない部屋は数えない', async () => {
    const before = await playing();
    await env.DB.prepare(
      'INSERT INTO presence (room, player_id, game, updated_at) VALUES (?, ?, ?, ?)',
    )
      .bind('grapnl:stale#0', 'stale-player', 'grapnl', Date.now() - 60 * 60 * 1000)
      .run();
    expect(await playing()).toBe(before);
  });

  it('無いゲームには 404 を返す', async () => {
    const res = await request('/games/missing/presence');
    expect(res.status).toBe(404);
  });
});

describe('gameOfRoom', () => {
  it('部屋の名前の「:」より前をゲームの slug とする', () => {
    expect(gameOfRoom('grapnl:20000:3#0')).toBe('grapnl');
    expect(gameOfRoom('plain#2')).toBe('plain');
  });
});
