import process from 'node:process';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import { siteOrigin } from '@roommate/catalog';
import { defineConfig } from 'astro/config';

// src/config.ts の API_ORIGIN と同じ値。CSP で fetch を許す先
const apiOrigin = process.env.PUBLIC_API_ORIGIN || 'https://api.roommate.hayashi-naoki.com';

export default defineConfig({
  // OGP などの絶対 URL の基準
  site: siteOrigin,
  // 404 と 500 は @astrojs/sitemap が sitemap から除く
  integrations: [react(), sitemap()],
  security: {
    // inline の script と style は、Astro がハッシュを CSP の meta に入れる。
    // meta では効かない frame-ancestors などは public/_headers で付ける
    csp: {
      directives: [
        "default-src 'self'",
        `connect-src 'self' ${apiOrigin} https://cloudflareinsights.com`,
        "img-src 'self' data:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ],
      // Cloudflare Web Analytics が配信時に差し込む beacon を許す
      scriptDirective: {
        resources: ["'self'", 'https://static.cloudflareinsights.com'],
      },
    },
  },
});
