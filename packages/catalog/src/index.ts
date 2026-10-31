/** ブランドサイトの origin */
export const siteOrigin = 'https://roommate.hayashi-naoki.com';

/** ゲーム配信の origin。サイトと origin を分け、ゲームからサイトの中身に触れられないようにする */
export const playOrigin = 'https://play.roommate.hayashi-naoki.com';

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
    maxScorePerSecond: 500,
  },
];

export function findGame(slug: string): Game | undefined {
  return games.find((game) => game.slug === slug);
}

/** 配信用ドメイン上の、そのゲームの URL。末尾のスラッシュは相対パスの基準になる */
export function playUrl(slug: string): string {
  return `${playOrigin}/${slug}/`;
}
