// Domain types for the Diamond Furniture inventory app.

// Status taxonomy matches the client's Master workbook formulas (Status column):
//   Negative     — closing < 0 (data/recording issue)
//   No activity  — no sales this period AND no stock on hand (0/0, dormant SKU)
//   Low          — has sales and at/below the reorder point (~under 0.5 month cover)
//   Overstock    — has sales and more than the overstock months of cover (~>3 months)
//   OK           — everything else (incl. stock on hand with no sales this period)
export type Status = 'Negative' | 'Low' | 'Overstock' | 'No activity' | 'OK';

export type Role = 'owner' | 'manager' | 'viewer';

/** A raw SKU row as parsed from the Master SKU List (quantities are whole pieces). */
export interface RawSku {
  line: string;
  model: string;
  colour: string;
  opening: number;
  sold: number;
  closing: number;
  /** Optional unit price/value if the import has a price column (₹-value metrics). */
  price?: number;
  /**
   * Stable unique id. The natural key `line||model||colour` is NOT unique in the
   * real data (9 duplicate rows in the sample), so normalizeDataset() assigns a
   * disambiguated uid used as the override key and Firestore document id.
   */
  uid?: string;
}

export interface Machine {
  name: string;
  fresh: number;
  activeDays: number;
}

/** Permanent SKU catalog entry — survives the year-end scrub (names + settings). */
export interface CatalogSku {
  uid: string;
  line: string;
  model: string;
  colour: string;
  reorder?: number;
  note?: string;
  /** Optional, price-ready: unit cost / selling price for ₹-value metrics. */
  cost?: number;
  price?: number;
}

/** One month's numbers for one SKU (scrubbable). */
export interface MonthRow {
  uid: string;
  opening: number;
  sold: number;
  closing: number;
}

/** A month snapshot: the per-SKU numbers plus that month's machine output. */
export interface PeriodSnapshot {
  key: string;        // 'YYYY-MM'
  label: string;      // 'April 2026'
  machines: Machine[];
  rows: MonthRow[];
}

export interface Dataset {
  skus: RawSku[];
  lines: string[];
  machines: Machine[];
}

/** Per-SKU override written by manual edits. `id = line||model||colour`. */
export interface Override {
  closing?: number;
  sold?: number;
  reorder?: number;
  note?: string;
}
export type Overrides = Record<string, Override>;

/** Alert thresholds. Global defaults plus optional per-product-line overrides. */
export interface LineThreshold {
  lowMonths?: number;
  overMonths?: number;
}
export interface Thresholds {
  lowMonths: number;
  overMonths: number;
  byLine: Record<string, LineThreshold>;
}

/** An effective SKU: raw values with overrides applied and derived fields computed. */
export interface EffSku extends RawSku {
  id: string;
  reorder: number;
  note: string;
  produced: number;
  /** Expected monthly demand used for cover/reorder — current month, or a
   *  trailing 3-month average once history exists. */
  demand: number;
  cover: number;
  status: Status;
  /** Unit price if known (0 when no price data), for ₹-value metrics. */
  price: number;
  /** Insight flag (not a status): has stock on hand but no sales this period. */
  idle: boolean;
  /** thresholds actually used for this SKU's line (resolved from per-line + default) */
  lowMonths: number;
  overMonths: number;
}

export interface ProdLogEntry {
  machine: string;
  date: string;
  line: string;
  qty: number;
}

// ── Orders (Phase B) ─────────────────────────────────────────────────────────
export type OrderStatus = 'open' | 'partial' | 'fulfilled' | 'cancelled';

export interface OrderItem {
  uid: string;
  line: string;
  model: string;
  colour: string;
  qtyOrdered: number;
  qtyFulfilled: number;
}

export interface Order {
  id: string;        // 'ORD-0007' (also the Firestore doc id)
  no: number;        // sequential number, for ordering + the next id
  dealer: string;
  date: string;      // order date (YYYY-MM-DD)
  note?: string;
  createdAt: number;
  cancelled?: boolean;
  items: OrderItem[];
}

/** Parsed workbook result from the XLSX importer. */
export interface ParsedWorkbook {
  skus: RawSku[];
  lines: string[];
  machines: Machine[];
  sheetNames: string[];
  /** Present when SKUs came from consolidating raw product tabs (no Master sheet). */
  consolidation?: { tabs: number; skipped: string[] };
}
