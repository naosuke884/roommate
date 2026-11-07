import type { ImageMetadata } from 'astro';
import grapnl from './assets/games/grapnl.png';

/**
 * ゲームの画面の画像。カードとゲームページに出す。1280×720 のスクリーンショットを置く。
 * 無いゲームはロゴのシンボルを出す
 */
export const gameImages: Readonly<Record<string, ImageMetadata>> = { grapnl };
