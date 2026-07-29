import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Minimal, dependency-free .env loader for tests. Populates process.env from .env when a
// variable isn't already set, so integration tests can reach the local database. If there
// is no .env, integration suites self-skip.
try {
  const contents = readFileSync(resolve(process.cwd(), ".env"), "utf8");
  for (const rawLine of contents.split("\n")) {
    const match = /^\s*([\w.-]+)\s*=\s*(.*?)\s*$/.exec(rawLine);
    if (!match) continue;
    const key = match[1];
    let value = match[2] ?? "";
    if (key === undefined) continue;
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (quoted) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
} catch {
  // no .env present — fine; integration tests will skip
}
