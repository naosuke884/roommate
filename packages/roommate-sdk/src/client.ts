/** 匿名 ID・スコア・自己ベストを受け持つ。ブラウザの API は外から渡し、テストで差し替えられるようにする */

export interface ClientOptions {
  apiOrigin: string;
  game: string;
  fetch: typeof fetch;
  storage: ClientStorage;
  now?: () => Date;
}

/** 使う localStorage の機能。自分のデータを消すときに、`roommate.` で始まるキーを数え上げる */
export type ClientStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

interface StoredPlayer {
  playerId: string;
  token: string;
  /** UNIX 秒 */
  expiresAt: number;
}

export interface RankingEntry {
  rank: number;
  name: string;
  score: number;
}

export type RankingState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'failed' }
  | {
      status: 'ready';
      day: string;
      entries: RankingEntry[];
      /** 自分のその日の順位。その日のスコアが無いか、ID が無ければ null */
      myRank: number | null;
    };

/** 自分のデータを消す要求の状態 */
export type DeleteState = 'idle' | 'deleting' | 'done' | 'failed';

interface PendingScore {
  day: string;
  score: number;
  durationMs: number;
}

const KEY_PREFIX = 'roommate.';
const PLAYER_KEY = `${KEY_PREFIX}player`;
// 送れずに手元に残すスコアの数。超えたら古いものから捨てる
const MAX_PENDING = 20;
// 期限までこれより短くなったら、同じ ID で発行し直す
const REFRESH_BEFORE_SECONDS = 7 * 24 * 60 * 60;
// 期限が切れてからも、この間は同じ ID で発行し直せる(API の REFRESH_GRACE_SECONDS と同じ)
const REFRESH_GRACE_SECONDS = 365 * 24 * 60 * 60;

export class Client {
  private player: StoredPlayer | undefined;
  private best: number | undefined;
  private ready: Promise<StoredPlayer | undefined>;
  private flushing: Promise<void> | undefined;
  private rankingValue: RankingState = { status: 'idle' };
  private rankingLoad: Promise<void> | undefined;
  private deleteValue: DeleteState = 'idle';
  private deleteRun: Promise<void> | undefined;
  /** 消している間と消したあとは、スコアを送らない */
  private holdScores = false;
  private readonly bestKey: string;
  private readonly pendingKey: string;
  private readonly now: () => Date;

  constructor(private readonly options: ClientOptions) {
    this.now = options.now ?? (() => new Date());
    this.bestKey = `${KEY_PREFIX}best.${options.game}`;
    this.pendingKey = `${KEY_PREFIX}pending.${options.game}`;
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

  /** 最後に頼んだランキングの状態 */
  rankingState(): RankingState {
    return this.rankingValue;
  }

  /**
   * 今のコースの日付のランキングと自分の順位を読む。結果は rankingState() で読む。
   * 読んでいる間にもう一度呼んでも、二重には読まない
   */
  requestRanking(): Promise<void> {
    if (this.rankingValue.status === 'loading' && this.rankingLoad) return this.rankingLoad;
    this.rankingValue = { status: 'loading' };
    this.rankingLoad = this.loadRanking()
      .then((state) => {
        this.rankingValue = state;
      })
      .catch(() => {
        this.rankingValue = { status: 'failed' };
      });
    return this.rankingLoad;
  }

  private async loadRanking(): Promise<RankingState> {
    const day = courseDay(this.now());
    // 送ったばかりのスコアが順位に入るよう、残っているスコアを先に送る
    await this.flush().catch(() => {});
    const [ranking, myRank] = await Promise.all([
      this.options
        .fetch(`${this.gamePath()}/rankings/${day}`, { cache: 'no-cache' })
        .then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return ((await res.json()) as { entries: RankingEntry[] }).entries;
        }),
      this.loadMyRank(day),
    ]);
    return { status: 'ready', day, entries: ranking, myRank };
  }

  private async loadMyRank(day: string): Promise<number | null> {
    const player = await this.ready;
    if (!player) return null;
    try {
      const res = await this.options.fetch(`${this.gamePath()}/scores/me?day=${day}`, {
        headers: { Authorization: `Bearer ${player.token}` },
      });
      if (!res.ok) return null;
      return ((await res.json()) as { rank?: number | null }).rank ?? null;
    } catch {
      return null;
    }
  }

  /** 最後に頼んだ、自分のデータを消す要求の状態 */
  deleteState(): DeleteState {
    return this.deleteValue;
  }

  /**
   * 自分の匿名 ID と、全ゲームのスコアをサーバーから消し、端末の `roommate.` のキーも消す。
   * 結果は deleteState() で読む。消したあとは、ページを開き直すまで ID を持たず、スコアも送らない。
   * 消している間にもう一度呼んでも、二重には消さない
   */
  requestDelete(): Promise<void> {
    if (this.deleteValue === 'deleting' && this.deleteRun) return this.deleteRun;
    if (this.deleteValue === 'done') return Promise.resolve();
    this.deleteValue = 'deleting';
    this.holdScores = true;
    this.deleteRun = this.deleteAll()
      .then(() => {
        this.deleteValue = 'done';
      })
      .catch(() => {
        this.deleteValue = 'failed';
        this.holdScores = false;
      });
    return this.deleteRun;
  }

  private async deleteAll() {
    await this.ready;
    // 送っている途中のスコアが 401 になると、新しい ID で送り直してしまう。終わるのを待ってから消す
    await this.flushing?.catch(() => {});
    const token = this.player?.token ?? this.storedPlayer()?.token;
    if (token) {
      const res = await this.options.fetch(`${this.options.apiOrigin}/players/me`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    }
    this.removeAllKeys();
    this.player = undefined;
    this.ready = Promise.resolve(undefined);
    this.best = undefined;
    this.rankingValue = { status: 'idle' };
  }

  /** ほかの JS(影の通信など)がトークンを使うとき用。取れなければ undefined */
  async token(): Promise<string | undefined> {
    return (await this.ready)?.token;
  }

  /**
   * スコアを送る。結果は待たずに戻り、自己ベストは手元ですぐ更新する。
   * 送れなかったスコアは手元に残し、次に送るときや次に開いたときに送り直す
   */
  submitScore(score: number, durationMs: number): Promise<void> {
    // 消したあとのスコアは、保存も送信もしない
    if (this.deleteValue === 'done') return Promise.resolve();
    this.raiseBest(score);
    this.enqueue({ day: courseDay(this.now()), score, durationMs });
    return this.flush().catch(() => {
      // 送れなくてもゲームは続ける。自己ベストは手元に残っている
    });
  }

  /** 手元に残っているスコアを古い順に送る。送れなかった分は残す */
  private async flush() {
    if (this.holdScores) return;
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      try {
        const player = await this.ready;
        if (!player) return;
        for (;;) {
          if (this.holdScores) return;
          const [next] = this.pending();
          if (!next) return;
          if ((await this.deliver(next)) === 'retry') return;
          this.writePending(this.pending().slice(1));
        }
      } finally {
        this.flushing = undefined;
      }
    })();
    return this.flushing;
  }

  /** 1 件送る。送れたか、送り直しても受け付けられないものは done */
  private async deliver(entry: PendingScore): Promise<'done' | 'retry'> {
    let player = await this.ready;
    if (!player) return 'retry';
    const body = JSON.stringify(entry);
    let res: Response;
    try {
      res = await this.postScore(player, body);
      // トークンが通らなくなった(ID が消えた、署名の鍵を替えたなど)ら、ID をもらい直して送り直す
      if (res.status === 401) {
        player = await this.reissue();
        if (!player) return 'retry';
        res = await this.postScore(player, body);
      }
    } catch {
      return 'retry';
    }
    if (res.ok) {
      const { best } = (await res.json()) as { best: number | null };
      if (best !== null) this.raiseBest(best);
      return 'done';
    }
    // 送りすぎとサーバーのエラーは後で送り直す。ほかの 4xx は送り直しても通らない
    return res.status === 429 || res.status >= 500 ? 'retry' : 'done';
  }

  private pending(): PendingScore[] {
    try {
      const value = JSON.parse(this.read(this.pendingKey) ?? '[]') as unknown;
      return Array.isArray(value) ? (value as PendingScore[]) : [];
    } catch {
      return [];
    }
  }

  private enqueue(entry: PendingScore) {
    this.writePending([...this.pending(), entry].slice(-MAX_PENDING));
  }

  private writePending(entries: PendingScore[]) {
    if (entries.length === 0) this.remove(this.pendingKey);
    else this.write(this.pendingKey, JSON.stringify(entries));
  }

  private async start(): Promise<StoredPlayer | undefined> {
    let player: StoredPlayer;
    try {
      player = await this.ensurePlayer();
    } catch {
      return undefined;
    }
    this.player = player;
    // 自己ベストを読めなくても、ID は使える
    await this.loadBest(player).catch(() => {});
    // 前に送れなかったスコアを送る。ready が決まってから動くように後に回す
    setTimeout(() => void this.flush().catch(() => {}), 0);
    return player;
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

  /** このゲームのものに限らず、`roommate.` で始まるキーをすべて消す */
  private removeAllKeys() {
    const keys: string[] = [];
    try {
      for (let i = 0; i < this.options.storage.length; i++) {
        const key = this.options.storage.key(i);
        if (key?.startsWith(KEY_PREFIX)) keys.push(key);
      }
    } catch {
      // 数え上げられなくても、このゲームのキーは消す
    }
    for (const key of new Set([...keys, PLAYER_KEY, this.bestKey, this.pendingKey])) {
      this.remove(key);
    }
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

  private remove(key: string) {
    try {
      this.options.storage.removeItem(key);
    } catch {
      // 消せなくても続ける
    }
  }
}

/** コースの日付。ゲームのコースは UTC の日付で切り替わるので、それに合わせる */
export function courseDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}
