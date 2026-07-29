import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Loads .env so DB-backed integration tests can find DATABASE_URL. They self-skip
    // when it's absent (e.g. a fresh clone with no database), so the pure suite always runs.
    setupFiles: ["./tests/setup.ts"],
  },
});
