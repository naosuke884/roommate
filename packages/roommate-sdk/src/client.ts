/** 匿名 ID・スコア・自己ベストを受け持つ。ブラウザの API は外から渡し、テストで差し替えられるようにする */

export interface ClientOptions {
  apiOrigin: string;
  game: string;
  fetch: typeof fetch;
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  now?: () => Date;
}

interface StoredPlayer {
  playerId: string;
  token: string;
  /** UNIX 秒 */
  expiresAt: number;
}

const PLAYER_KEY = 'roommate.player';
// 期限までこれより短くなったら、同じ ID で発行し直す
const REFRESH_BEFORE_SECONDS = 7 * 24 * 60 * 60;
// 期限が切れてからも、この間は同じ ID で発行し直せる(API の REFRESH_GRACE_SECONDS と同じ)
const REFRESH_GRACE_SECONDS = 365 * 24 * 60 * 60;

export class Client {
  private player: StoredPlayer | undefined;
  private best: number | undefined;
  private ready: Promise<StoredPlayer | undefined>;
  private readonly bestKey: string;
  private readonly now: () => Date;

  constructor(private readonly options: ClientOptions) {
    this.now = options.now ?? (() => new Date());
    this.bestKey = `roommate.best.${options.game}`;
    const local = Number(this.read(this.bestKey));
    this.best = Number.isSafeInteger(local) && local > 0 ? local : undefined;
    this.ready = this.start();
  }

  /** 匿名 ID の準備ができたか */
  isReady(): boolean {
    return this.player !== undefined;
  }

  /** 全期間の自己ベスト。まだわからなければ undefined */
  bestScore(): number | undefined {
    return this.best;
  }

  /** ほかの JS(影の通信など)がトークンを使うとき用。取れなければ undefined */
  async token(): Promise<string | undefined> {
    return (await this.ready)?.token;
  }

  /** スコアを送る。結果は待たずに戻り、自己ベストは手元ですぐ更新する */
  submitScore(score: number, durationMs: number): Promise<void> {
    this.raiseBest(score);
    return this.send(score, durationMs).catch(() => {
      // 送れなくてもゲームは続ける。自己ベストは手元に残っている
    });
  }

  private async send(score: number, durationMs: number) {
    let player = await this.ready;
    if (!player) return;
    const body = JSON.stringify({ day: courseDay(this.now()), score, durationMs });
    let res = await this.postScore(player, body);
    // トークンが通らなくなった(ID が消えた、署名の鍵を替えたなど)ら、ID をもらい直して 1 回だけ送り直す
    if (res.status === 401) {
      player = await this.reissue();
      if (!player) return;
      res = await this.postScore(player, body);
    }
    if (res.ok) {
      const { best } = (await res.json()) as { best: number | null };
      if (best !== null) this.raiseBest(best);
    }
  }

  private async start(): Promise<StoredPlayer | undefined> {
    try {
      const player = await this.ensurePlayer();
      this.player = player;
      await this.loadBest(player);
      return player;
    } catch {
      return undefined;
    }
  }

  private async ensurePlayer(): Promise<StoredPlayer> {
    const stored = this.storedPlayer();
    const nowSeconds = Math.floor(this.now().getTime() / 1000);
    const remaining = stored ? stored.expiresAt - nowSeconds : -Infinity;
    if (stored && remaining > -REFRESH_GRACE_SECONDS) {
      if (remaining > REFRESH_BEFORE_SECONDS) return stored;
      const res = await this.request('/players/me/token', stored.token);
      if (res?.ok) return this.savePlayer((await res.json()) as StoredPlayer);
      // 401 は ID が使えないということなので、新しくもらう。
      // 通信の失敗やサーバーの一時的なエラーなら、今の ID を捨てない。
      // 期限内ならそのまま使い、期限切れなら次に開いたときにまた発行し直す
      if (res?.status !== 401) {
        if (remaining > 0) return stored;
        throw new Error('匿名 ID を発行し直せなかった');
      }
    }
    return this.issue();
  }

  private async issue(): Promise<StoredPlayer> {
    const res = await this.request('/players');
    if (!res?.ok) throw new Error('匿名 ID を発行できなかった');
    return this.savePlayer((await res.json()) as StoredPlayer);
  }

  private async reissue(): Promise<StoredPlayer | undefined> {
    const player = await this.issue().catch(() => undefined);
    if (player) {
      this.player = player;
      this.ready = Promise.resolve(player);
    }
    return player;
  }

  private postScore(player: StoredPlayer, body: string): Promise<Response> {
    return this.options.fetch(`${this.gamePath()}/scores`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${player.token}`, 'Content-Type': 'application/json' },
      body,
    });
  }

  private async loadBest(player: StoredPlayer) {
    const res = await this.options.fetch(`${this.gamePath()}/scores/me`, {
      headers: { Authorization: `Bearer ${player.token}` },
    });
    if (!res.ok) return;
    const { best } = (await res.json()) as { best: number | null };
    if (best !== null) this.raiseBest(best);
  }

  /** ID の発行・更新を POST する。通信に失敗したら undefined */
  private async request(path: string, token?: string): Promise<Response | undefined> {
    try {
      return await this.options.fetch(`${this.options.apiOrigin}${path}`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
    } catch {
      return undefined;
    }
  }

  private raiseBest(score: number) {
    if (this.best !== undefined && this.best >= score) return;
    this.best = score;
    this.write(this.bestKey, String(score));
  }

  private storedPlayer(): StoredPlayer | undefined {
    try {
      const value = JSON.parse(this.read(PLAYER_KEY) ?? 'null') as StoredPlayer | null;
      return value && typeof value.token === 'string' ? value : undefined;
    } catch {
      return undefined;
    }
  }

  private savePlayer(player: StoredPlayer): StoredPlayer {
    this.write(PLAYER_KEY, JSON.stringify(player));
    return player;
  }

  private gamePath() {
    return `${this.options.apiOrigin}/games/${encodeURIComponent(this.options.game)}`;
  }

  // プライベートブラウズなどで localStorage が使えなくても止まらないようにする
  private read(key: string): string | null {
    try {
      return this.options.storage.getItem(key);
    } catch {
      return null;
    }
  }

  private write(key: string, value: string) {
    try {
      this.options.storage.setItem(key, value);
    } catch {
      // 保存できなくても続ける
    }
  }
}

/** コースの日付。ゲームのコースは UTC の日付で切り替わるので、それに合わせる */
export function courseDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}
