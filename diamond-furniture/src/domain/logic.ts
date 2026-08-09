import type {
  Dataset, EffSku, Overrides, RawSku, Status, Thresholds, LineThreshold,
} from './types';
import { pieces } from './format';

/** Natural composite key: line||model||colour. NOT guaranteed unique — see normalizeDataset. */
export function skuId(s: Pick<RawSku, 'line' | 'model' | 'colour'>): string {
  return s.line + '||' + s.model + '||' + s.colour;
}

/**
 * Assign a unique, stable `uid` to every SKU. Where the natural key collides
 * (duplicate rows exist in the real data), later copies get a ` #2`, ` #3`… suffix
 * so no row can silently overwrite another as a Firestore document / override key.
 */
export function normalizeDataset(ds: Dataset): Dataset {
  const seen = new Map<string, number>();
  const skus = ds.skus.map((s) => {
    const base = skuId(s);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { ...s, uid: n === 1 ? base : `${base} #${n}` };
  });
  return { ...ds, skus };
}

/** The id actually used for overrides / Firestore: the assigned uid, else the composite. */
export function effectiveId(s: RawSku): string {
  return s.uid ?? skuId(s);
}

/** Resolve the thresholds that apply to a given product line (per-line override → global default). */
export function resolveThreshold(
  thresholds: Thresholds,
  line: string,
): { lowMonths: number; overMonths: number } {
  const per: LineThreshold = thresholds.byLine?.[line] ?? {};
  return {
    lowMonths: per.lowMonths ?? thresholds.lowMonths,
    overMonths: per.overMonths ?? thresholds.overMonths,
  };
}

/** Default reorder point: one `lowMonths` window of demand, in whole pieces. */
export function reorderDefault(sold: number, lowMonths: number): number {
  return Math.round(sold * lowMonths);
}

/**
 * Months of cover.
 * = closing / sold when there's demand; ∞ (999) when stock exists but nothing sold; 0 when empty.
 */
export function computeCover(closing: number, sold: number): number {
  return sold > 0 ? closing / sold : closing > 0 ? 999 : 0;
}

/**
 * Status classification — mirrors the client's Master workbook Status formula:
 *   =IF(F<0,"Negative",
 *       IF(OR(E="",E=0), IF(F=0,"No Activity","OK"),
 *          IF(F/E<0.5,"Low", IF(F/E>3,"Overstock","OK"))))
 * where E = sold this period, F = closing stock. We keep an editable reorder
 * point in place of the hard-coded 0.5 (reorder defaults to round(sold*lowMonths),
 * lowMonths default 0.5), and the overstock cover threshold is overMonths (default 3).
 */
export function classify(args: {
  closing: number;
  sold: number;
  reorder: number;
  cover: number;
  overMonths: number;
}): Status {
  const { closing, sold, reorder, cover, overMonths } = args;
  if (closing < 0) return 'Negative';
  if (sold <= 0) return closing === 0 ? 'No activity' : 'OK';
  if (closing <= reorder) return 'Low';
  if (cover > overMonths) return 'Overstock';
  return 'OK';
}

/** Apply overrides + per-line thresholds and compute every derived field for one SKU. */
export function effOne(raw: RawSku, ov: Overrides, thresholds: Thresholds): EffSku {
  const id = effectiveId(raw);
  const o = ov[id] || {};
  const { lowMonths, overMonths } = resolveThreshold(thresholds, raw.line);

  const opening = pieces(raw.opening);
  const sold = pieces(o.sold != null ? o.sold : raw.sold);
  const closing = pieces(o.closing != null ? o.closing : raw.closing);
  const reorder = pieces(o.reorder != null ? o.reorder : reorderDefault(sold, lowMonths));
  const note = o.note || '';
  const produced = closing + sold - opening;
  const cover = computeCover(closing, sold);
  const status = classify({ closing, sold, reorder, cover, overMonths });
  const idle = sold <= 0 && closing > 0; // stock sitting with no sales this period

  return { ...raw, id, opening, sold, closing, reorder, note, produced, cover, status, idle, lowMonths, overMonths };
}

/** Compute effective SKUs for the whole dataset. */
export function eff(dataset: Dataset | null, ov: Overrides, thresholds: Thresholds): EffSku[] {
  if (!dataset) return [];
  return dataset.skus.map((s) => effOne(s, ov, thresholds));
}

// ── Aggregations used by dashboard / reports (kept pure + testable) ──────────

export interface LineSummary {
  name: string;
  opening: number;
  sold: number;
  stock: number;   // Σ max(0, closing)
  produced: number; // Σ max(0, produced)
  count: number;
  flagged: number;  // negative + low
}

export function lineSummaries(effs: EffSku[]): LineSummary[] {
  const byLine = new Map<string, LineSummary>();
  for (const s of effs) {
    let L = byLine.get(s.line);
    if (!L) {
      L = { name: s.line, opening: 0, sold: 0, stock: 0, produced: 0, count: 0, flagged: 0 };
      byLine.set(s.line, L);
    }
    L.opening += s.opening;
    L.sold += s.sold;
    L.stock += Math.max(0, s.closing);
    L.produced += Math.max(0, s.produced);
    L.count += 1;
    if (s.status === 'Negative' || s.status === 'Low') L.flagged += 1;
  }
  return [...byLine.values()];
}

export function statusCounts(effs: EffSku[]): Record<Status, number> {
  const counts: Record<Status, number> = {
    Negative: 0, Low: 0, Overstock: 0, 'No activity': 0, OK: 0,
  };
  for (const s of effs) counts[s.status] += 1;
  return counts;
}

export interface Kpis {
  totalStock: number;
  totalSold: number;
  negativeCount: number;
  lowCount: number;
  overstockCount: number;
  noActivityCount: number;
  idleCount: number;   // stock on hand but no sales this period
  idleUnits: number;   // units of stock tied up in idle SKUs
  urgent: number;      // negative + low
}

export function kpis(effs: EffSku[]): Kpis {
  const c = statusCounts(effs);
  const idle = effs.filter((s) => s.idle);
  return {
    totalStock: effs.reduce((a, s) => a + Math.max(0, s.closing), 0),
    totalSold: effs.reduce((a, s) => a + s.sold, 0),
    negativeCount: c.Negative,
    lowCount: c.Low,
    overstockCount: c.Overstock,
    noActivityCount: c['No activity'],
    idleCount: idle.length,
    idleUnits: idle.reduce((a, s) => a + s.closing, 0),
    urgent: c.Negative + c.Low,
  };
}

/** Total fresh output = parsed machine fresh + any production logged in-app. */
export function freshTotal(machinesFresh: number, loggedQty: number): number {
  return machinesFresh + loggedQty;
}
