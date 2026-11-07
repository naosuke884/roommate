/**
 * 匿名 ID の発行を数える単位。IPv4 はアドレスごと、IPv6 は /64 ごとにまとめる。
 * IPv6 は 1 つの回線に /64 以上が割り当てられることが多く、アドレスごとに数えると
 * アドレスを替えるだけで上限を超えられるため。形の分からない値はそのまま使う
 */
export function issueLimitKey(ip: string): string {
  if (!ip.includes(':')) return ip;
  // IPv4 を写した IPv6(::ffff:192.0.2.1)は、IPv4 のアドレスとして数える。
  // /64 にまとめると、すべての IPv4 の人が 1 つの上限を分け合ってしまう
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(ip);
  if (mapped) return mapped[1]!;
  const groups = expandIpv6(ip);
  return groups ? `${groups.slice(0, 4).join(':')}::/64` : ip;
}

/** IPv6 を 8 つの 16 進のグループ(小文字、先頭の 0 を省く)にする。IPv6 でなければ undefined */
function expandIpv6(ip: string): string[] | undefined {
  let text = ip.toLowerCase();
  // 末尾が IPv4 の形(::ffff:192.0.2.1 など)なら、2 つのグループに直す
  const v4 = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (v4) {
    const octets = v4.slice(1).map(Number);
    if (octets.some((o) => o > 255)) return undefined;
    const [a, b, c, d] = octets as [number, number, number, number];
    text = `${text.slice(0, v4.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return undefined;
  const parse = (part: string) => (part === '' ? [] : part.split(':'));
  const head = parse(halves[0]!);
  const tail = halves.length === 2 ? parse(halves[1]!) : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return undefined;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return undefined;
  return groups.map((g) => parseInt(g, 16).toString(16));
}
