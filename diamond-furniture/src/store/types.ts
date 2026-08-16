import type {
  CatalogSku, Machine, Order, OrderItem, PeriodSnapshot, ProdLogEntry, Role, Thresholds,
} from '../domain/types';
export type { Role } from '../domain/types';

/** One audit-trail entry: who changed what, when. Visible to owners. */
export interface AuditEntry {
  id: string;
  at: number;
  user: string;
  role: Role;
  action:
    | 'edit-sku'
    | 'record-sale'
    | 'log-production'
    | 'set-threshold'
    | 'import'
    | 'scrub-year'
    | 'create-order'
    | 'fulfil-order'
    | 'cancel-order'
    | 'set-fy-opening';
  target?: string;
  detail?: string;
}

/**
 * A clean opening-stock baseline for one financial year (Apr–Mar). Everything is
 * built on top of this: in stock = opening + Σ produced − Σ sold. Captured
 * automatically from the year's first month, or set from a dedicated file.
 */
export interface FyOpening {
  fyLabel: string;                    // '2026-27'
  capturedFrom: string;               // 'April 2026' or 'manual upload'
  at: number;                         // when it was set
  byUid: Record<string, number>;      // opening units per SKU uid
}

/**
 * Full app state. The permanent catalog is separate from the monthly snapshots,
 * so the year-end scrub can clear the numbers while keeping names + settings.
 */
export interface PersistedState {
  catalog: CatalogSku[];
  periods: PeriodSnapshot[];   // every month on file (each with rows + machines)
  latestPeriodKey: string;     // newest month (default selection)
  prodLog: ProdLogEntry[];
  orders: Order[];
  orderSeq: number;            // next order number
  thresholds: Thresholds;
  fyOpening: FyOpening | null; // current financial-year opening-stock baseline
  role: Role;
  audit: AuditEntry[];
}

export interface Identity {
  uid: string;
  name: string;
  role: Role;
}

/** What an import writes: catalog upserts + a full month snapshot, or machines-only. */
export interface ImportPayload {
  catalogUpserts?: CatalogSku[];               // names only; reorder/note preserved server-side
  snapshot?: PeriodSnapshot;                   // full month (rows + machines)
  machinesFor?: { key: string; machines: Machine[] }; // production-only update
}

/** Storage backend contract. Two implementations: DemoRepo + FirebaseRepo. */
export interface Repo {
  subscribe(cb: (state: PersistedState) => void): () => void;
  saveSku(
    uid: string,
    periodKey: string,
    numbers: { closing: number; sold: number },
    settings: { reorder: number; note: string },
    audit: AuditEntry,
  ): Promise<void>;
  addProdLog(entry: ProdLogEntry, audit: AuditEntry): Promise<void>;
  setThresholds(thresholds: Thresholds, audit: AuditEntry): Promise<void>;
  applyImport(payload: ImportPayload, audit: AuditEntry): Promise<void>;
  /** Year-end reset: delete monthly snapshots + fulfilled/cancelled orders; keep the catalog + open orders. */
  scrubYear(audit: AuditEntry): Promise<void>;
  // Orders (Phase B)
  createOrder(input: { dealer: string; date: string; note?: string; items: OrderItem[] }, audit: AuditEntry): Promise<void>;
  /** Advance one order line by `qty` (order ledger only; does not touch periods). */
  fulfilLine(orderId: string, itemIndex: number, qty: number, periodKey: string, audit: AuditEntry): Promise<void>;
  cancelOrder(orderId: string, audit: AuditEntry): Promise<void>;
  /** Set the financial-year opening-stock baseline. */
  setFyOpening(fy: FyOpening, audit: AuditEntry): Promise<void>;
  setDemoRole?(role: Role): void;
}

// Defaults match the client's Master workbook: Low = under 0.5 month of cover,
// Overstock = more than 3 months of cover. Adjustable per line in the Alerts view.
export const DEFAULT_THRESHOLDS: Thresholds = { lowMonths: 0.5, overMonths: 3, byLine: {} };
