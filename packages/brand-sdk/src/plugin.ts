// macroquad の JS ローダーのプラグイン。mq_js_bundle.js の後、load() の前に読み込む。
//   <script src="brand-sdk.js" data-game="<slug>"></script>
// data-api で API の origin を変えられる(開発用)。
import { Client } from './client.ts';

declare function miniquad_add_plugin(plugin: {
  register_plugin: (importObject: { env: Record<string, unknown> }) => void;
  name: string;
  version: number;
}): void;

declare global {
  interface Window {
    roommate?: { client: Client };
  }
}

const DEFAULT_API_ORIGIN = 'https://api.roommate.hayashi-naoki.com';

const script = document.currentScript as HTMLScriptElement | null;
const game = script?.dataset.game;
if (!game) {
  throw new Error('brand-sdk.js: data-game にゲームの slug を書く');
}

// localStorage に触れるだけで例外になるブラウザでは、開いている間だけ覚える
let storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
try {
  storage = window.localStorage;
} catch {
  const memory = new Map<string, string>();
  storage = {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => void memory.set(key, value),
    removeItem: (key) => void memory.delete(key),
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
  name: 'roommate_brand_sdk',
  version: 1,
  register_plugin(importObject) {
    importObject.env.roommate_is_ready = () => (client.isReady() ? 1 : 0);
    importObject.env.roommate_best_score = () => client.bestScore() ?? -1;
    importObject.env.roommate_submit_score = (score: number, durationMs: number) => {
      void client.submitScore(score, durationMs);
    };
  },
});
