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
 * Months-of-cover display. Shows "n/a" only when cover is genuinely undefined —
 * negative stock, or no demand at all (cover === 999, our "infinite" sentinel).
 * It must NOT hide a finite forecast just because THIS month's sales were zero:
 * once history exists, `cover` is driven by the trailing-average demand, so a
 * SKU that sold in prior months has a real cover number the alerts rely on.
 */
export function coverLabel(cover: number, closing = 0): string {
  if (closing < 0 || cover >= 999) return 'n/a';
  return cover.toFixed(1);
}
