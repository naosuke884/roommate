// macroquad の JS ローダーのプラグイン。mq_js_bundle.js の後、load() の前に読み込む。
//   <script src="roommate-sdk.js" data-game="<slug>"></script>
// data-api で API の origin を変えられる(開発用)。
import { Client, type ClientStorage } from './client.ts';

declare function miniquad_add_plugin(plugin: {
  register_plugin: (importObject: { env: Record<string, unknown> }) => void;
  name: string;
  version: number;
}): void;

// macroquad の JS ローダーが置く、wasm の線形メモリ
declare const wasm_memory: WebAssembly.Memory;

declare global {
  interface Window {
    roommate?: { client: Client };
  }
}

const DEFAULT_API_ORIGIN = 'https://api.roommate.hayashi-naoki.com';

const script = document.currentScript as HTMLScriptElement | null;
const game = script?.dataset.game;
if (!game) {
  throw new Error('roommate-sdk.js: data-game にゲームの slug を書く');
}

// localStorage に触れるだけで例外になるブラウザでは、開いている間だけ覚える
let storage: ClientStorage;
try {
  storage = window.localStorage;
} catch {
  const memory = new Map<string, string>();
  storage = {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => void memory.set(key, value),
    removeItem: (key) => void memory.delete(key),
    key: (index) => [...memory.keys()][index] ?? null,
    get length() {
      return memory.size;
    },
  };
}

const client = new Client({
  apiOrigin: script?.dataset.api ?? DEFAULT_API_ORIGIN,
  game,
  fetch: window.fetch.bind(window),
  storage,
});
window.roommate = { client };

miniquad_add_plugin({
  name: 'roommate_sdk',
  version: 1,
  register_plugin(importObject) {
    importObject.env.roommate_is_ready = () => (client.isReady() ? 1 : 0);
    importObject.env.roommate_best_score = () => client.bestScore() ?? -1;
    importObject.env.roommate_submit_score = (score: number, durationMs: number) => {
      void client.submitScore(score, durationMs);
    };

    // ランキング。wasm へは数値しか渡せないので、1 件ずつ番号で読ませる
    const ready = () => {
      const state = client.rankingState();
      return state.status === 'ready' ? state : undefined;
    };
    const RANKING_STATUS = { idle: 0, loading: 1, ready: 2, failed: 3 } as const;
    importObject.env.roommate_request_ranking = () => {
      void client.requestRanking();
    };
    importObject.env.roommate_ranking_status = () => RANKING_STATUS[client.rankingState().status];
    importObject.env.roommate_ranking_len = () => ready()?.entries.length ?? 0;
    importObject.env.roommate_ranking_my_rank = () => ready()?.myRank ?? -1;
    importObject.env.roommate_ranking_rank = (i: number) => ready()?.entries[i]?.rank ?? 0;
    importObject.env.roommate_ranking_score = (i: number) => ready()?.entries[i]?.score ?? 0;
    // 名前を UTF-8 で ptr から cap バイトまで書き、名前の全体のバイト数を返す
    importObject.env.roommate_ranking_name = (i: number, ptr: number, cap: number) => {
      const bytes = new TextEncoder().encode(ready()?.entries[i]?.name ?? '');
      new Uint8Array(wasm_memory.buffer, ptr, cap).set(bytes.subarray(0, cap));
      return bytes.length;
    };

    // 自分のデータを消す。結果はランキングと同じく、頼んでから状態を見る
    const DELETE_STATUS = { idle: 0, deleting: 1, done: 2, failed: 3 } as const;
    importObject.env.roommate_request_delete = () => {
      void client.requestDelete();
    };
    importObject.env.roommate_delete_status = () => DELETE_STATUS[client.deleteState()];
  },
});
