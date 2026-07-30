/** Whole pieces, Indian digit grouping (lakh/crore) — ported from the prototype's fmt(). */
export function fmt(n: number): string {
  return Math.round(n).toLocaleString('en-IN');
}

/** Round a quantity to whole pieces (the business rule: stock is counted in whole pieces). */
export function pieces(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}

/** Months-of-cover display: ∞ when effectively infinite, 1 dp when there's demand, else em dash. */
export function coverLabel(cover: number, sold: number): string {
  if (cover >= 999) return '∞';
  return sold > 0 ? cover.toFixed(1) : '—';
}
