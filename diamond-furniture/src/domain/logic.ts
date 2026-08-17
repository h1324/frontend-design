import type {
  Dataset, EffSku, Overrides, RawSku, Status, Thresholds, LineThreshold,
  CatalogSku, PeriodSnapshot,
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
  demand: number; // current-month sold, or trailing-avg demand once history exists
  reorder: number;
  cover: number;
  overMonths: number;
}): Status {
  const { closing, demand, reorder, cover, overMonths } = args;
  if (closing < 0) return 'Negative';
  if (demand <= 0) return closing === 0 ? 'No activity' : 'OK';
  if (closing <= reorder) return 'Low';
  if (cover > overMonths) return 'Overstock';
  return 'OK';
}

/**
 * Core derivation shared by the single-month and history-aware paths.
 * `demand` is the expected monthly demand (current-month sold, or a trailing
 * average); `soldThisPeriod` drives the idle flag ("did it sell this month").
 */
function deriveEff(
  base: { uid: string; line: string; model: string; colour: string; opening: number; sold: number; closing: number },
  demand: number,
  reorderOverride: number | undefined,
  note: string,
  price: number,
  lowMonths: number,
  overMonths: number,
): EffSku {
  const opening = pieces(base.opening);
  const sold = pieces(base.sold);
  const closing = pieces(base.closing);
  const reorder = pieces(reorderOverride != null ? reorderOverride : reorderDefault(demand, lowMonths));
  const produced = closing + sold - opening;
  const cover = computeCover(closing, demand);
  const status = classify({ closing, demand, reorder, cover, overMonths });
  const idle = sold <= 0 && closing > 0;
  return {
    uid: base.uid, id: base.uid, line: base.line, model: base.model, colour: base.colour,
    opening, sold, closing, reorder, note, produced, demand, cover, status, price: price || 0, idle, lowMonths, overMonths,
  };
}

/** Apply overrides + per-line thresholds and compute every derived field for one SKU. */
export function effOne(raw: RawSku, ov: Overrides, thresholds: Thresholds): EffSku {
  const id = effectiveId(raw);
  const o = ov[id] || {};
  const { lowMonths, overMonths } = resolveThreshold(thresholds, raw.line);
  const sold = o.sold != null ? o.sold : raw.sold;
  const closing = o.closing != null ? o.closing : raw.closing;
  // Single-month path: demand = this month's sold.
  return deriveEff(
    { uid: id, line: raw.line, model: raw.model, colour: raw.colour, opening: raw.opening, sold, closing },
    sold, o.reorder, o.note || '', raw.price ?? 0, lowMonths, overMonths,
  );
}

/** Compute effective SKUs for the whole dataset (single-month). */
export function eff(dataset: Dataset | null, ov: Overrides, thresholds: Thresholds): EffSku[] {
  if (!dataset) return [];
  return dataset.skus.map((s) => effOne(s, ov, thresholds));
}

/**
 * History-aware effective SKUs. Demand for cover/reorder/status is the average
 * sold across the trailing snapshots (which include the current month), so
 * months-of-cover becomes a rolling forecast. With one month on file this equals
 * the single-month result (so it still reconciles with the workbook).
 */
export function effWithHistory(
  catalog: CatalogSku[],
  current: PeriodSnapshot | null,
  trailing: PeriodSnapshot[],
  ov: Overrides,
  thresholds: Thresholds,
): EffSku[] {
  const curRows = new Map((current?.rows ?? []).map((r) => [r.uid, r]));
  const soldMaps = trailing.map((p) => new Map(p.rows.map((r) => [r.uid, r.sold])));
  return catalog.map((c) => {
    const o = ov[c.uid] || {};
    const { lowMonths, overMonths } = resolveThreshold(thresholds, c.line);
    const row = curRows.get(c.uid);
    const sold = o.sold != null ? o.sold : row?.sold ?? 0;
    const closing = o.closing != null ? o.closing : row?.closing ?? 0;
    const opening = row?.opening ?? 0;
    // Demand = average sold across ONLY the trailing months this SKU actually
    // existed in. A month where the SKU isn't on file yet (a newly-added product)
    // must not be counted as a zero-sales month — that would halve/third a new
    // SKU's true demand, overstating cover and understating its reorder point.
    let soldSum = 0;
    let monthsPresent = 0;
    for (const m of soldMaps) if (m.has(c.uid)) { soldSum += m.get(c.uid) ?? 0; monthsPresent += 1; }
    const demand = monthsPresent ? soldSum / monthsPresent : sold;
    return deriveEff(
      { uid: c.uid, line: c.line, model: c.model, colour: c.colour, opening, sold, closing },
      demand, o.reorder ?? c.reorder, o.note || c.note || '', c.price ?? 0, lowMonths, overMonths,
    );
  });
}

/**
 * "Overall / all months" effective SKUs. Stock is a snapshot (latest month's
 * closing); sold is cumulative across every month; opening is the financial-year
 * baseline (or the earliest month's opening if none), so produced = closing +
 * total sold − opening is the whole-period production. Demand for status/cover is
 * the average monthly sold across the months a SKU appears in.
 */
export function effOverall(
  catalog: CatalogSku[],
  periods: PeriodSnapshot[],
  fyByUid: Record<string, number>,
  thresholds: Thresholds,
): EffSku[] {
  const sorted = [...periods].sort((a, b) => (a.key < b.key ? -1 : 1));
  const latest = sorted[sorted.length - 1];
  const earliest = sorted[0];
  const latestRows = new Map((latest?.rows ?? []).map((r) => [r.uid, r]));
  const earliestRows = new Map((earliest?.rows ?? []).map((r) => [r.uid, r]));
  const soldTotal = new Map<string, number>();
  const monthsPresent = new Map<string, number>();
  for (const p of sorted) for (const r of p.rows) {
    soldTotal.set(r.uid, (soldTotal.get(r.uid) ?? 0) + r.sold);
    monthsPresent.set(r.uid, (monthsPresent.get(r.uid) ?? 0) + 1);
  }
  return catalog.map((c) => {
    const { lowMonths, overMonths } = resolveThreshold(thresholds, c.line);
    const closing = latestRows.get(c.uid)?.closing ?? 0;
    const sold = soldTotal.get(c.uid) ?? 0;
    const opening = fyByUid[c.uid] ?? earliestRows.get(c.uid)?.opening ?? 0;
    const months = monthsPresent.get(c.uid) || sorted.length || 1;
    const demand = sold / months; // average monthly demand across the year
    return deriveEff(
      { uid: c.uid, line: c.line, model: c.model, colour: c.colour, opening, sold, closing },
      demand, c.reorder, c.note || '', c.price ?? 0, lowMonths, overMonths,
    );
  });
}

/** Split a single-month dataset (+ overrides) into the permanent catalog. */
export function catalogFromDataset(dataset: Dataset, ov: Overrides = {}): CatalogSku[] {
  const norm = normalizeDataset(dataset);
  return norm.skus.map((s) => {
    const o = ov[s.uid!] || {};
    const c: CatalogSku = { uid: s.uid!, line: s.line, model: s.model, colour: s.colour };
    if (o.reorder != null) c.reorder = o.reorder;
    if (o.note) c.note = o.note;
    return c;
  });
}

/** Split a single-month dataset into one period snapshot (the month's numbers). */
export function snapshotFromDataset(dataset: Dataset, key: string, label: string): PeriodSnapshot {
  const norm = normalizeDataset(dataset);
  return {
    key, label,
    machines: dataset.machines,
    rows: norm.skus.map((s) => ({ uid: s.uid!, opening: s.opening, sold: s.sold, closing: s.closing })),
  };
}

export interface PeriodTotals {
  key: string;
  label: string;
  sold: number;
  stock: number;
  fresh: number;
}

/** Per-month totals for the overall trend charts (oldest → newest by key). */
export function periodTotals(snapshots: PeriodSnapshot[]): PeriodTotals[] {
  return [...snapshots]
    .sort((a, b) => (a.key < b.key ? -1 : 1))
    .map((p) => ({
      key: p.key,
      label: p.label,
      sold: p.rows.reduce((a, r) => a + r.sold, 0),
      stock: p.rows.reduce((a, r) => a + r.closing, 0), // net, matches Category Summary
      fresh: p.machines.reduce((a, m) => a + m.fresh, 0),
    }));
}

/** Per-month sold + stock for one product line (for the line trend chart). */
export function lineTrend(
  catalog: CatalogSku[],
  snapshots: PeriodSnapshot[],
  line: string,
): PeriodTotals[] {
  const uidsInLine = new Set(catalog.filter((c) => c.line === line).map((c) => c.uid));
  return [...snapshots]
    .sort((a, b) => (a.key < b.key ? -1 : 1))
    .map((p) => {
      const rows = p.rows.filter((r) => uidsInLine.has(r.uid));
      return {
        key: p.key, label: p.label,
        sold: rows.reduce((a, r) => a + r.sold, 0),
        stock: rows.reduce((a, r) => a + r.closing, 0), // net, matches Category Summary
        fresh: 0,
      };
    });
}

export interface SkuMonth { key: string; label: string; sold: number; closing: number; }

/** One SKU's month-by-month sold + stock across all snapshots (oldest → newest). */
export function skuHistory(uid: string, snapshots: PeriodSnapshot[]): SkuMonth[] {
  return [...snapshots]
    .sort((a, b) => (a.key < b.key ? -1 : 1))
    .map((p) => {
      const r = p.rows.find((x) => x.uid === uid);
      return { key: p.key, label: p.label, sold: r?.sold ?? 0, closing: r?.closing ?? 0 };
    });
}

// ── Aggregations used by dashboard / reports (kept pure + testable) ──────────

export interface LineSummary {
  name: string;
  opening: number;
  sold: number;
  stock: number;   // Σ closing (NET — includes negative-stock rows, matching the
                   // client's Category Summary; negatives are surfaced separately)
  produced: number; // Σ produced (net conservation)
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
    L.stock += s.closing;
    L.produced += s.produced;
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
  totalStock: number;  // NET closing (Σ closing) — reconciles with Category Summary
  totalSold: number;
  /** Produced this period by stock conservation: Σ (closing + sold − opening).
   *  This is the reliable produced figure — the machine tabs over-count. */
  totalProduced: number;
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
    // NET closing (includes the negative-stock rows), so the headline reconciles
    // with the client's Category Summary. Negative stock is flagged separately.
    totalStock: effs.reduce((a, s) => a + s.closing, 0),
    totalSold: effs.reduce((a, s) => a + s.sold, 0),
    totalProduced: effs.reduce((a, s) => a + s.produced, 0),
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
