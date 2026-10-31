import react from '@astrojs/react';
import { siteOrigin } from '@roommate/catalog';
import { defineConfig } from 'astro/config';

// src/config.ts の API_ORIGIN と同じ値。CSP で fetch を許す先
const apiOrigin = process.env.PUBLIC_API_ORIGIN || 'https://api.roommate.hayashi-naoki.com';

export default defineConfig({
  // OGP などの絶対 URL の基準
  site: siteOrigin,
  integrations: [react()],
  security: {
    // inline の script と style は、Astro がハッシュを CSP の meta に入れる。
    // meta では効かない frame-ancestors などは public/_headers で付ける
    csp: {
      directives: [
        "default-src 'self'",
        `connect-src 'self' ${apiOrigin}`,
        "img-src 'self' data:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ],
    },
  },
});
