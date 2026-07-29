import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Loads .env so DB-backed integration tests can find DATABASE_URL. They self-skip
    // when it's absent (e.g. a fresh clone with no database), so the pure suite always runs.
    setupFiles: ["./tests/setup.ts"],
    // Integration suites share one local Postgres; running test files in parallel starves
    // the connection pool and makes interactive-transaction tests (e.g. the concurrent-OUT
    // race) flaky. The suite is small, so run files sequentially for determinism.
    fileParallelism: false,
  },
});
