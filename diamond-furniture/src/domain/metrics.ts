import type { EffSku, Order, PeriodSnapshot } from './types';
import { parsePeriodKey } from './period';

/** Sell-through %: units sold ÷ units that were available to sell (sold + stock on hand). */
export function sellThrough(effs: EffSku[]): number {
  let sold = 0, avail = 0;
  for (const e of effs) { sold += e.sold; avail += e.sold + Math.max(0, e.closing); }
  return avail > 0 ? Math.round((sold / avail) * 100) : 0;
}

/**
 * Typical days of stock cover across SKUs with demand (turnover proxy).
 * Uses the MEDIAN, not the mean: a single slow-mover holding a huge pile of
 * stock (e.g. sells 1, holds 5,000 → 5,000 months of cover) would otherwise
 * drag a mean into the tens of thousands of days and misrepresent the business.
 */
export function avgDaysCover(effs: EffSku[]): number {
  const covers = effs.filter((e) => e.demand > 0 && e.cover < 999).map((e) => e.cover).sort((a, b) => a - b);
  if (!covers.length) return 0;
  const mid = Math.floor(covers.length / 2);
  const medianMonths = covers.length % 2 ? covers[mid] : (covers[mid - 1] + covers[mid]) / 2;
  return Math.round(medianMonths * 30);
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

/** Whole months between two period keys (b − a). '2026-01'→'2026-04' = 3. */
function monthsBetween(a: string, b: string): number {
  const pa = parsePeriodKey(a);
  const pb = parsePeriodKey(b);
  return (pb.year * 12 + pb.month) - (pa.year * 12 + pa.month);
}

export interface LastSale {
  lastKey: string | null;   // most recent month (≤ current) with a sale, or null if never
  lastLabel: string | null;
  monthsSince: number | null; // 0 = sold this month; N = last sale N months ago; null = never
}

/** When a SKU last sold, looking only at months up to and including `currentKey`. */
export function lastSaleInfo(uid: string, snapshots: PeriodSnapshot[], currentKey: string): LastSale {
  let best: PeriodSnapshot | null = null;
  for (const p of snapshots) {
    if (p.key > currentKey) continue;
    const r = p.rows.find((x) => x.uid === uid);
    if (r && r.sold > 0 && (!best || p.key > best.key)) best = p;
  }
  if (!best) return { lastKey: null, lastLabel: null, monthsSince: null };
  return { lastKey: best.key, lastLabel: best.label, monthsSince: monthsBetween(best.key, currentKey) };
}

export interface PlanRow { eff: EffSku; make: number; }

/**
 * Production plan: for each SKU, how much to make so that after next month's
 * expected sales (its trailing-average demand) it still sits at its reorder
 * point — i.e. target stock = demand + reorder. Only items that need making
 * appear, biggest need first. Overstocked / well-covered items suggest nothing.
 */
export function productionPlan(effs: EffSku[]): PlanRow[] {
  return effs
    .map((e) => ({ eff: e, make: Math.max(0, Math.round(e.demand + e.reorder - e.closing)) }))
    .filter((r) => r.make > 0)
    .sort((a, b) => b.make - a.make);
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
