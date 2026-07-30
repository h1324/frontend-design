import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vitest config lives here too (test key) so logic + importer tests run in Node,
// where DecompressionStream / Blob / Response are available for the .xlsx parser.
export default defineConfig({
  plugins: [react()],
  // Pin PostCSS locally so Vite doesn't inherit the unrelated Tailwind config
  // at the monorepo root (this app uses plain CSS, no PostCSS plugins).
  css: { postcss: {} },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
