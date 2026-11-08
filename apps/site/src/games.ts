import type { ImageMetadata } from 'astro';
import grapnl from './assets/games/grapnl.png';

/**
 * ゲームの画像。カードとゲームページに出す。16:9(1280×720)で、そのゲームのドット絵で描いたものを置く。
 * 無いゲームはロゴのシンボルを出す
 */
export const gameImages: Readonly<Record<string, ImageMetadata>> = { grapnl };

/**
 * リンクの共有で出るゲームページの画像(1200×630)。`public/og/<slug>.png` に置く。
 * ゲームの index.html の og:image も同じ URL にする。無いゲームはサイト全体の画像を使う
 */
export const gameOgImages: Readonly<Record<string, string>> = { grapnl: '/og/grapnl.png' };
