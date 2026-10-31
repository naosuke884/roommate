export interface Game {
  /** URL とゲームの配信パス(`/<slug>/`)に使う */
  slug: string;
  title: string;
  description: string;
}

export const games: readonly Game[] = [
  {
    slug: 'browser-game-1',
    title: 'browser-game-1',
    description: '日替わりのコースを走り、同じコースを走った人と自己ベストを競う。',
  },
];

export function findGame(slug: string): Game | undefined {
  return games.find((game) => game.slug === slug);
}
