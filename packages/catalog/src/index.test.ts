import { describe, expect, it } from 'vitest';
import { findGame, games } from './index.ts';

describe('games', () => {
  it('slug が重複しない', () => {
    const slugs = games.map((game) => game.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('slug がパスに使える形になっている', () => {
    for (const game of games) {
      expect(game.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });
});

describe('findGame', () => {
  it('slug でゲームを引ける', () => {
    expect(findGame('browser-game-1')?.slug).toBe('browser-game-1');
  });

  it('無い slug では undefined を返す', () => {
    expect(findGame('missing')).toBeUndefined();
  });
});
