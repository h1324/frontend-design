import { defineConfig } from 'vitest/config';

// Firestore security-rules tests. Run via `npm run test:rules`, which starts the
// Firestore emulator (needs Java) and then runs only the *.emulator.test.ts files.
export default defineConfig({
  css: { postcss: {} },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.emulator.test.ts'],
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
