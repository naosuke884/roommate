import { describe, expect, it } from 'vitest';
import { findGame, games, playOrigin, playUrl, siteOrigin } from './index.ts';

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

  it('スコアの上限が正の数になっている', () => {
    for (const game of games) {
      expect(game.maxScorePerSecond).toBeGreaterThan(0);
    }
  });

  it('確かめる点数が正の数になっている', () => {
    for (const game of games) {
      expect(game.holdScoreAbove).toBeGreaterThan(0);
    }
  });
});

describe('playUrl', () => {
  it('配信 URL が /<slug>/ になる', () => {
    expect(playUrl('grapnl')).toBe(`${playOrigin}/grapnl/`);
  });

  it('サイトと配信の origin が別である', () => {
    expect(playOrigin).not.toBe(siteOrigin);
    expect(playOrigin.startsWith('https://')).toBe(true);
    expect(siteOrigin.startsWith('https://')).toBe(true);
  });
});

describe('findGame', () => {
  it('slug でゲームを引ける', () => {
    expect(findGame('grapnl')?.slug).toBe('grapnl');
  });

  it('無い slug では undefined を返す', () => {
    expect(findGame('missing')).toBeUndefined();
  });
});
