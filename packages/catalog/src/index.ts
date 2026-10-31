/** ブランドサイトの origin。ゲームの埋め込みを許すのはここだけ */
export const siteOrigin = 'https://roommate-site.884naoki-dev.workers.dev';

/**
 * ゲーム配信の origin。カスタムドメインが決まるまでは workers.dev。
 * Worker 名 `roommate-play` と揃える。
 */
export const playOrigin = 'https://roommate-play.884naoki-dev.workers.dev';

export interface Game {
  /** URL とゲームの配信パス(`/<slug>/`)に使う */
  slug: string;
  title: string;
  description: string;
  /** 1 秒あたりに伸ばせるスコアの上限。これを超える速さのスコアは受け付けない */
  maxScorePerSecond: number;
}

export const games: readonly Game[] = [
  {
    slug: 'browser-game-1',
    title: 'browser-game-1',
    description: '日替わりのコースを走り、同じコースを走った人と自己ベストを競う。',
    maxScorePerSecond: 50,
  },
];

export function findGame(slug: string): Game | undefined {
  return games.find((game) => game.slug === slug);
}

/** 配信用ドメイン上の、そのゲームの URL。末尾のスラッシュは相対パスの基準になる */
export function playUrl(slug: string): string {
  return `${playOrigin}/${slug}/`;
}
