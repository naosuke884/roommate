import { DurableObject } from 'cloudflare:workers';

export const MAX_PEERS = 20;
export const MAX_MESSAGE_BYTES = 1024;
export const MAX_MESSAGES_PER_SECOND = 30;
export const FLUSH_INTERVAL_MS = 100;
/** 部屋に入る人の表示名(「名前#1a2b」)。`rooms.ts` が URL 符号化して付ける */
export const DISPLAY_NAME_HEADER = 'X-Roommate-Display-Name';
/** 部屋の名前(`<キー>#<番号>`)。`rooms.ts` が URL 符号化して付ける。人数を書くときに使う */
export const ROOM_NAME_HEADER = 'X-Roommate-Room';
/** 人がいる間、人数を書き直す間隔。出入りが無くても行が古くならないようにする */
export const PRESENCE_REFRESH_MS = 60_000;

interface Attachment {
  peerId: number;
  name: string;
}

interface Frame {
  from: number;
  data: Uint8Array;
}

/**
 * 1 つの部屋。届いたバイト列を解釈せず、送信者 ID を付けて他の全員へ配る。
 *
 * - バイナリ: クライアントからは 1 つのバイト列。配るときは 100ms ぶんをまとめ、
 *   `[送信者 ID: u16][長さ: u16][バイト列]` を繰り返した 1 つのメッセージにする(big endian)
 * - テキスト: サーバーからの通知(welcome / join / leave)の JSON。welcome と join には表示名
 *   (`names` は ID から表示名、`name` は入った人の表示名)を付ける
 *
 * Hibernation を使うので、メモリ上の状態は静かな間に消えてよいものだけにする。
 */
export class Room extends DurableObject<Env> {
  private pending: Frame[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private rates = new Map<WebSocket, { windowStart: number; count: number }>();

  override async fetch(request: Request): Promise<Response> {
    const sockets = this.openSockets();
    if (sockets.length >= MAX_PEERS) {
      return new Response('room is full', { status: 409 });
    }

    const room = decodeName(request.headers.get(ROOM_NAME_HEADER));
    if (room) this.ctx.storage.kv.put('room', room);

    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    const peerId = this.nextPeerId(sockets);
    const name = decodeName(request.headers.get(DISPLAY_NAME_HEADER));
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ peerId, name } satisfies Attachment);

    server.send(
      JSON.stringify({
        type: 'welcome',
        id: peerId,
        peers: sockets.map((ws) => peerOf(ws)),
        names: Object.fromEntries(sockets.map((ws) => [peerOf(ws), nameOf(ws)])),
      }),
    );
    this.broadcastText({ type: 'join', id: peerId, name }, server);
    await this.reportPresence();
    return new Response(null, { status: 101, webSocket: client });
  }

  override webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    if (typeof message === 'string') {
      return;
    }
    if (message.byteLength > MAX_MESSAGE_BYTES) {
      ws.close(1009, 'message too large');
      return;
    }
    if (!this.allow(ws)) {
      ws.close(1008, 'too many messages');
      return;
    }
    this.pending.push({ from: peerOf(ws), data: new Uint8Array(message) });
    this.flushTimer ??= setTimeout(() => this.flush(), FLUSH_INTERVAL_MS);
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    await this.leave(ws);
    try {
      ws.close(code, reason);
    } catch {
      // すでに閉じている
    }
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.leave(ws);
  }

  override async alarm(): Promise<void> {
    await this.reportPresence();
  }

  private async leave(ws: WebSocket) {
    this.rates.delete(ws);
    this.broadcastText({ type: 'leave', id: peerOf(ws) }, ws);
    await this.reportPresence(ws);
  }

  /**
   * 今つながっている人数を D1 に書く。誰もいなければ行を消す。
   * 人がいる間はアラームで書き直し、部屋が止まっても古い行として数えられないようにする。
   * 書けなくても部屋は動かし続ける
   */
  private async reportPresence(leaving?: WebSocket) {
    const room = this.ctx.storage.kv.get<string>('room');
    if (!room) return;
    const players = this.openSockets().filter((ws) => ws !== leaving).length;
    try {
      if (players === 0) {
        await this.env.DB.prepare('DELETE FROM presence WHERE room = ?').bind(room).run();
        await this.ctx.storage.deleteAlarm();
        return;
      }
      await this.env.DB.prepare(
        `INSERT INTO presence (room, game, players, updated_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (room) DO UPDATE SET players = ?3, updated_at = ?4`,
      )
        .bind(room, gameOfRoom(room), players, Date.now())
        .run();
    } catch (error) {
      console.error('presence を書けなかった', error);
    }
    await this.ctx.storage.setAlarm(Date.now() + PRESENCE_REFRESH_MS);
  }

  private flush() {
    this.flushTimer = undefined;
    const frames = this.pending;
    this.pending = [];
    for (const ws of this.openSockets()) {
      const peerId = peerOf(ws);
      const others = frames.filter((frame) => frame.from !== peerId);
      if (others.length > 0) {
        ws.send(encodeFrames(others));
      }
    }
  }

  private allow(ws: WebSocket): boolean {
    const now = Date.now();
    const rate = this.rates.get(ws);
    if (!rate || now - rate.windowStart >= 1000) {
      this.rates.set(ws, { windowStart: now, count: 1 });
      return true;
    }
    rate.count += 1;
    return rate.count <= MAX_MESSAGES_PER_SECOND;
  }

  private broadcastText(message: object, except: WebSocket) {
    const text = JSON.stringify(message);
    for (const ws of this.openSockets()) {
      if (ws !== except) {
        ws.send(text);
      }
    }
  }

  private openSockets(): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => ws.readyState === WebSocket.OPEN);
  }

  /** u16 に収まる、今いる人と重ならない ID を選ぶ */
  private nextPeerId(sockets: WebSocket[]): number {
    const used = new Set(sockets.map((ws) => peerOf(ws)));
    let id = (this.ctx.storage.kv.get<number>('lastPeerId') ?? 0) % 0xffff;
    do {
      id = (id % 0xffff) + 1;
    } while (used.has(id));
    this.ctx.storage.kv.put('lastPeerId', id);
    return id;
  }
}

function peerOf(ws: WebSocket): number {
  return (ws.deserializeAttachment() as Attachment).peerId;
}

function nameOf(ws: WebSocket): string {
  return (ws.deserializeAttachment() as Partial<Attachment>).name ?? '';
}

/** 部屋の名前からゲームの slug を取る。キーは `<slug>:...` の形にする約束 */
export function gameOfRoom(room: string): string {
  return room.split(/[:#]/, 1)[0] ?? '';
}

/** 符号化された表示名を戻す。無いか壊れていれば空にする */
function decodeName(header: string | null): string {
  if (!header) return '';
  try {
    return decodeURIComponent(header);
  } catch {
    return '';
  }
}

export function encodeFrames(frames: Frame[]): ArrayBuffer {
  const size = frames.reduce((sum, frame) => sum + 4 + frame.data.byteLength, 0);
  const buffer = new ArrayBuffer(size);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let offset = 0;
  for (const frame of frames) {
    view.setUint16(offset, frame.from);
    view.setUint16(offset + 2, frame.data.byteLength);
    bytes.set(frame.data, offset + 4);
    offset += 4 + frame.data.byteLength;
  }
  return buffer;
}
