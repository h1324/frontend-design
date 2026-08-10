import type { EffSku, Order, PeriodSnapshot } from './types';

/** Sell-through %: units sold ÷ units that were available to sell (sold + stock on hand). */
export function sellThrough(effs: EffSku[]): number {
  let sold = 0, avail = 0;
  for (const e of effs) { sold += e.sold; avail += e.sold + Math.max(0, e.closing); }
  return avail > 0 ? Math.round((sold / avail) * 100) : 0;
}

/** Average days of stock cover across SKUs with demand (turnover proxy). */
export function avgDaysCover(effs: EffSku[]): number {
  const withDemand = effs.filter((e) => e.demand > 0 && e.cover < 999);
  if (!withDemand.length) return 0;
  const meanMonths = withDemand.reduce((a, e) => a + e.cover, 0) / withDemand.length;
  return Math.round(meanMonths * 30);
}

export interface Valuation {
  hasPrice: boolean;
  stockValue: number;      // ₹ value of all stock on hand
  overstockValue: number;  // ₹ tied up in overstocked SKUs
  idleValue: number;       // ₹ tied up in idle stock (no sales this month)
}

export function valuation(effs: EffSku[]): Valuation {
  let stockValue = 0, overstockValue = 0, idleValue = 0;
  let hasPrice = false;
  for (const e of effs) {
    if (e.price > 0) hasPrice = true;
    const v = Math.max(0, e.closing) * e.price;
    stockValue += v;
    if (e.status === 'Overstock') overstockValue += v;
    if (e.idle) idleValue += v;
  }
  return { hasPrice, stockValue, overstockValue, idleValue };
}

/**
 * Dead stock: SKUs holding stock now with ZERO sales across the trailing months
 * provided (e.g. the last 3). Stronger than the single-month "idle" flag.
 * Returns the effs, sorted by stock held (descending).
 */
export function deadStock(effs: EffSku[], trailing: PeriodSnapshot[]): EffSku[] {
  const soldByUid = new Map<string, number>();
  for (const p of trailing) for (const r of p.rows) soldByUid.set(r.uid, (soldByUid.get(r.uid) ?? 0) + r.sold);
  return effs
    .filter((e) => e.closing > 0 && (soldByUid.get(e.uid ?? e.id) ?? 0) === 0)
    .sort((a, b) => b.closing - a.closing);
}

/** ₹ value of units still to dispatch across open/partial orders. */
export function pendingOrderValue(orders: Order[], priceByUid: Map<string, number>): number {
  let total = 0;
  for (const o of orders) {
    if (o.cancelled) continue;
    for (const it of o.items) {
      const pending = Math.max(0, it.qtyOrdered - it.qtyFulfilled);
      total += pending * (priceByUid.get(it.uid) ?? 0);
    }
  }
  return total;
}
