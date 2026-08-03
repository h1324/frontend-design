// Indian financial year: 1 April – 31 March. Document series are numbered per FY
// (CLAUDE.md rule 7). Pure and deterministic — no dependency on the server's timezone.

// The plant runs on IST; the FY boundary is midnight 1 April IST. We shift the instant
// into IST before reading calendar fields so a timestamp just before/after the boundary
// is classified correctly regardless of where the server clock is set.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** FY label for an instant, e.g. 2026-05-01 → "2026-27"; 2026-02-15 → "2025-26". */
export function financialYear(instant: Date): string {
  const ist = new Date(instant.getTime() + IST_OFFSET_MS);
  const year = ist.getUTCFullYear();
  const month = ist.getUTCMonth(); // 0 = Jan, 3 = Apr
  const startYear = month >= 3 ? year : year - 1;
  const endYY = String((startYear + 1) % 100).padStart(2, "0");
  return `${startYear}-${endYY}`;
}

/** Compact FY, e.g. "2026-27" → "2627". Used in roll numbers where a slash-free, terse
 *  form reads better on a hand-keyed label (spec S11). */
export function compactFinancialYear(fy: string): string {
  return fy.slice(2, 4) + fy.slice(5, 7);
}
