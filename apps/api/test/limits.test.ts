import { describe, expect, it } from 'vitest';
import { issueLimitKey } from '../src/limits.ts';

describe('issueLimitKey', () => {
  it('IPv4 はアドレスごとに数える', () => {
    expect(issueLimitKey('192.0.2.1')).toBe('192.0.2.1');
    expect(issueLimitKey('192.0.2.2')).toBe('192.0.2.2');
  });

  it('IPv6 は同じ /64 をまとめる', () => {
    const key = issueLimitKey('2001:db8:1:2::1');
    expect(key).toBe('2001:db8:1:2::/64');
    expect(issueLimitKey('2001:0db8:0001:0002:ffff:ffff:ffff:ffff')).toBe(key);
    expect(issueLimitKey('2001:DB8:1:2:a:b:c:d')).toBe(key);
    expect(issueLimitKey('2001:db8:1:3::1')).not.toBe(key);
  });

  it('省略や IPv4 の埋め込みがあっても同じ /64 にする', () => {
    expect(issueLimitKey('::1')).toBe('0:0:0:0::/64');
    expect(issueLimitKey('2001:db8::')).toBe('2001:db8:0:0::/64');
    expect(issueLimitKey('64:ff9b::192.0.2.1')).toBe('64:ff9b:0:0::/64');
    expect(issueLimitKey('64:ff9b:1:2::192.0.2.1')).toBe('64:ff9b:1:2::/64');
  });

  it('IPv4 を写した IPv6 は、IPv4 のアドレスとして数える', () => {
    expect(issueLimitKey('::ffff:192.0.2.1')).toBe('192.0.2.1');
    expect(issueLimitKey('::FFFF:192.0.2.2')).toBe('192.0.2.2');
  });

  it('IPv6 として読めない値はそのまま使う', () => {
    expect(issueLimitKey('unknown')).toBe('unknown');
    expect(issueLimitKey('1::2::3')).toBe('1::2::3');
    expect(issueLimitKey('2001:db8:zz::1')).toBe('2001:db8:zz::1');
    expect(issueLimitKey('1:2:3:4:5:6:7:8:9')).toBe('1:2:3:4:5:6:7:8:9');
  });
});
