import { DurableObject } from 'cloudflare:workers';

export const MAX_PEERS = 20;
export const MAX_MESSAGE_BYTES = 1024;
export const MAX_MESSAGES_PER_SECOND = 30;
export const FLUSH_INTERVAL_MS = 100;
/** 部屋に入る人の表示名(「名前#1a2b」)。`rooms.ts` が URL 符号化して付ける */
export const DISPLAY_NAME_HEADER = 'X-Roommate-Display-Name';
/** 部屋の名前(`<キー>#<番号>`)。`rooms.ts` が URL 符号化して付ける。人数を書くときに使う */
export const ROOM_NAME_HEADER = 'X-Roommate-Room';
/** 部屋に入る人のプレイヤー ID。`rooms.ts` がトークンを確かめてから付ける */
export const PLAYER_ID_HEADER = 'X-Roommate-Player';
/** 同じプレイヤーが入り直したときに、前の接続を閉じる理由 */
export const REPLACED_CLOSE_CODE = 4000;
/** 人がいる間、人数を書き直す間隔。出入りが無くても行が古くならないようにする */
export const PRESENCE_REFRESH_MS = 60_000;

interface Attachment {
  peerId: number;
  name: string;
  /** この変更より前に入った接続には無い */
  playerId?: string;
  /** 同じプレイヤーが入り直して閉じた接続。退出は入り直したときに知らせ終えている */
  replaced?: boolean;
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
    const playerId = request.headers.get(PLAYER_ID_HEADER) ?? undefined;
    // 1 人が席をいくつも取らないよう、同じプレイヤーの前の接続は閉じて、その席を引き継ぐ
    const previous = playerId
      ? this.openSockets().filter((ws) => attachmentOf(ws).playerId === playerId)
      : [];
    const sockets = this.openSockets().filter((ws) => !previous.includes(ws));
    if (sockets.length >= MAX_PEERS) {
      return new Response('room is full', { status: 409 });
    }
    for (const ws of previous) this.replace(ws);

    const room = decodeName(request.headers.get(ROOM_NAME_HEADER));
    if (room) this.ctx.storage.kv.put('room', room);

    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    const peerId = this.nextPeerId(sockets);
    const name = decodeName(request.headers.get(DISPLAY_NAME_HEADER));
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({
      peerId,
      name,
      ...(playerId && { playerId }),
    } satisfies Attachment);

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
    if (!attachmentOf(ws).replaced) {
      this.broadcastText({ type: 'leave', id: peerOf(ws) }, ws);
    }
    await this.reportPresence(ws);
  }

  /** 同じプレイヤーが入り直した前の接続を閉じる。ほかの人には、ここで退出を知らせる */
  private replace(ws: WebSocket) {
    ws.serializeAttachment({ ...attachmentOf(ws), replaced: true } satisfies Attachment);
    this.rates.delete(ws);
    this.broadcastText({ type: 'leave', id: peerOf(ws) }, ws);
    try {
      ws.close(REPLACED_CLOSE_CODE, 'replaced');
    } catch {
      // すでに閉じている
    }
  }

  /**
   * 今いるプレイヤーを D1 に書き直す。人数はプレイヤー ID の重複を除いて数えるので、
   * 1 人が部屋をいくつも開いても 1 人と数える。誰もいなければ行を消す。
   * 人がいる間はアラームで書き直し、部屋が止まっても古い行として数えられないようにする。
   * 書けなくても部屋は動かし続ける
   */
  private async reportPresence(leaving?: WebSocket) {
    const room = this.ctx.storage.kv.get<string>('room');
    if (!room) return;
    const members = new Set(
      this.openSockets()
        .filter((ws) => ws !== leaving)
        .map((ws) => {
          const { playerId, peerId } = attachmentOf(ws);
          // この変更より前に入った接続は ID を持たないので、接続ごとに 1 人と数える
          return playerId ?? `peer:${room}:${peerId}`;
        }),
    );
    const now = Date.now();
    const clear = this.env.DB.prepare('DELETE FROM presence WHERE room = ?').bind(room);
    const insert = this.env.DB.prepare(
      'INSERT INTO presence (room, player_id, game, updated_at) VALUES (?, ?, ?, ?)',
    );
    try {
      await this.env.DB.batch([
        clear,
        ...[...members].map((member) => insert.bind(room, member, gameOfRoom(room), now)),
      ]);
    } catch (error) {
      console.error('presence を書けなかった', error);
    }
    if (members.size === 0) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    await this.ctx.storage.setAlarm(now + PRESENCE_REFRESH_MS);
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

function attachmentOf(ws: WebSocket): Attachment {
  return ws.deserializeAttachment() as Attachment;
}

function peerOf(ws: WebSocket): number {
  return attachmentOf(ws).peerId;
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
