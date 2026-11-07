import { describe, expect, it } from 'vitest';
import { MAX_NAME_LENGTH, displayName, parseName } from '../src/names.ts';

describe('parseName', () => {
  it('前後の空白を落とし、続く空白を 1 つにまとめる', () => {
    expect(parseName({ name: '  あお　 い ' })).toBe('あお い');
  });

  it('空や空白だけ、null なら名前を外す', () => {
    expect(parseName({ name: '' })).toBeNull();
    expect(parseName({ name: ' \t ' })).toBeNull();
    expect(parseName({ name: null })).toBeNull();
  });

  it('文字の数で上限を数える', () => {
    expect(parseName({ name: '🍡'.repeat(MAX_NAME_LENGTH) })).toBe('🍡'.repeat(MAX_NAME_LENGTH));
    expect(parseName({ name: 'a'.repeat(MAX_NAME_LENGTH + 1) })).toBeUndefined();
  });

  it('NFC にそろえてから数える', () => {
    const decomposed = 'が'.repeat(MAX_NAME_LENGTH);
    expect(parseName({ name: decomposed })).toBe('が'.repeat(MAX_NAME_LENGTH));
  });

  it('見えない文字と # は使えない', () => {
    for (const name of ['a​b', 'a‮b', 'a\u0007b', 'a#b', 'a＃b']) {
      expect(parseName({ name })).toBeUndefined();
    }
  });

  it('文字列でなければ使えない', () => {
    expect(parseName({ name: 1 })).toBeUndefined();
    expect(parseName({})).toBeUndefined();
    expect(parseName(null)).toBeUndefined();
  });
});

describe('displayName', () => {
  it('名前と ID の先頭 4 文字を # でつなぐ', () => {
    expect(displayName('あおい', '1a2b3c4d')).toBe('あおい#1a2b');
    expect(displayName(null, '1a2b3c4d')).toBe('名無し#1a2b');
  });
});
