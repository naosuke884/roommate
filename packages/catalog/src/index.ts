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
  /** これを超えるスコアは、運営が確かめるまでランキングに出さない(本人の自己ベストには数える) */
  holdScoreAbove: number;
}

export const games: readonly Game[] = [
  {
    slug: 'grapnl',
    title: 'grapnl',
    description: '日替わりのコースを走り、同じコースを走った人と自己ベストを競う。',
    maxScorePerSecond: 500,
    // 2026-11 時点の本番の最高は 6,591 点。迫る領域が速くなるので、数分のプレイで届く点数より十分上に置く
    holdScoreAbove: 30_000,
  },
];

export function findGame(slug: string): Game | undefined {
  return games.find((game) => game.slug === slug);
}

/** 配信用ドメイン上の、そのゲームの URL。末尾のスラッシュは相対パスの基準になる */
export function playUrl(slug: string): string {
  return `${playOrigin}/${slug}/`;
}
