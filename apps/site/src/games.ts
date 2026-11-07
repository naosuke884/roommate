import type { ImageMetadata } from 'astro';
import grapnl from './assets/games/grapnl.png';

/**
 * ゲームの画像。カードとゲームページに出す。16:9(1280×720)で、そのゲームのドット絵で描いたものを置く。
 * 無いゲームはロゴのシンボルを出す
 */
export const gameImages: Readonly<Record<string, ImageMetadata>> = { grapnl };
