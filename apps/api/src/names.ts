/** 名前の長さの上限。文字(コードポイント)で数える */
export const MAX_NAME_LENGTH = 12;

// 改行・制御文字・ゼロ幅文字などの見えない文字と、表示の区切りに使う #
const FORBIDDEN = /[\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Zl}\p{Zp}#＃]/u;

/**
 * `{ name }` の名前を整えて返す。空なら null(名前を外す)、使えなければ undefined。
 * 前後の空白は落とし、続く空白は 1 つにまとめる
 */
export function parseName(body: unknown): string | null | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const { name } = body as Record<string, unknown>;
  if (name === null) return null;
  if (typeof name !== 'string') return undefined;
  const normalized = name.normalize('NFC').trim().replace(/\s+/gu, ' ');
  if (normalized === '') return null;
  if ([...normalized].length > MAX_NAME_LENGTH || FORBIDDEN.test(normalized)) return undefined;
  return normalized;
}

/**
 * ランキングに出す名前。同じ名前の人を見分けられるよう、ID の先頭 4 文字を付ける。
 * 名前が無ければ「名無し」
 */
export function displayName(name: string | null, playerId: string): string {
  return `${name ?? '名無し'}#${playerId.slice(0, 4)}`;
}
