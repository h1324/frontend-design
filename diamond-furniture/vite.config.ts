import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Vitest config lives here too (test key) so logic + importer tests run in Node,
// where DecompressionStream / Blob / Response are available for the .xlsx parser.
export default defineConfig({
  plugins: [
    react(),
    // Installable Progressive Web App: adds a service worker (offline app shell)
    // and a web manifest so the site can be added to a phone's home screen.
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon-32.png', 'apple-touch-icon.png'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,png,svg}'],
        navigateFallback: '/index.html',
        // Firestore/Auth calls must always hit the network, never the SW cache.
        navigateFallbackDenylist: [/^\/__/, /firestore\.googleapis\.com/],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      manifest: {
        name: 'Diamond Furniture — Inventory Control',
        short_name: 'DF Inventory',
        description: 'Inventory, production, alerts and reports for Diamond Furniture.',
        theme_color: '#5980a6',
        background_color: '#f2f2f3',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  // Pin PostCSS locally so Vite doesn't inherit the unrelated Tailwind config
  // at the monorepo root (this app uses plain CSS, no PostCSS plugins).
  css: { postcss: {} },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
