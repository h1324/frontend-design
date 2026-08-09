/** Whole pieces, Indian digit grouping (lakh/crore) — ported from the prototype's fmt(). */
export function fmt(n: number): string {
  return Math.round(n).toLocaleString('en-IN');
}

/** Round a quantity to whole pieces (the business rule: stock is counted in whole pieces). */
export function pieces(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}

/**
 * Months-of-cover display, matching the workbook: "n/a" when there's no demand
 * (can't divide by zero sales) or negative stock; otherwise 1 decimal place.
 */
export function coverLabel(cover: number, sold: number, closing = 0): string {
  if (sold <= 0 || closing < 0) return 'n/a';
  return cover.toFixed(1);
}
