import { playOrigin, siteOrigin } from '@roommate/catalog';

/** サイトと配信用の origin は常に許し、`ALLOWED_ORIGINS`(カンマ区切り)の分を足す */
export function isAllowedOrigin(origin: string, configured: string): boolean {
  const allowed = new Set(
    [siteOrigin, playOrigin, ...configured.split(',').map((item) => item.trim())].filter(
      (item) => item.length > 0,
    ),
  );
  return allowed.has(origin);
}
