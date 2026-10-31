import react from '@astrojs/react';
import { siteOrigin } from '@roommate/catalog';
import { defineConfig } from 'astro/config';

export default defineConfig({
  // OGP などの絶対 URL の基準
  site: siteOrigin,
  integrations: [react()],
});
