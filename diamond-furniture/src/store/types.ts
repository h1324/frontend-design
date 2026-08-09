import type { Dataset, Overrides, ProdLogEntry, Role, Thresholds } from '../domain/types';
export type { Role } from '../domain/types';

/** One audit-trail entry: who changed what, when. Visible to owners. */
export interface AuditEntry {
  id: string;
  at: number;          // epoch ms
  user: string;        // display name or email
  role: Role;
  action:
    | 'edit-sku'
    | 'record-sale'
    | 'log-production'
    | 'set-threshold'
    | 'import';
  target?: string;     // e.g. SKU id or product line
  detail?: string;     // human summary, e.g. "stock 80 → 60"
}

/** The full app state that both backends persist and stream. */
export interface PersistedState {
  dataset: Dataset | null;   // normalized (unique ids)
  ov: Overrides;
  prodLog: ProdLogEntry[];
  thresholds: Thresholds;
  period: string;
  /** role is authoritative from Firebase claims; in demo mode it's user-selectable */
  role: Role;
  audit: AuditEntry[];
}

/** The current signed-in identity. */
export interface Identity {
  uid: string;
  name: string;
  role: Role;
}

/**
 * Storage backend contract. Two implementations: DemoRepo (localStorage) and
 * FirebaseRepo (Firestore). The store code is identical against either.
 */
export interface Repo {
  /** Push the initial state and every subsequent update. Returns an unsubscribe fn. */
  subscribe(cb: (state: PersistedState) => void): () => void;
  saveOverride(id: string, patch: Overrides[string], audit: AuditEntry): Promise<void>;
  addProdLog(entry: ProdLogEntry, audit: AuditEntry): Promise<void>;
  setThresholds(thresholds: Thresholds, audit: AuditEntry): Promise<void>;
  applyImport(next: {
    dataset: Dataset;
    ov: Overrides;
    period: string;
  }, audit: AuditEntry): Promise<void>;
  /** Demo-only: change the acting role. No-op under Firebase (role comes from claims). */
  setDemoRole?(role: Role): void;
}

// Defaults match the client's Master workbook: Low = under 0.5 month of cover,
// Overstock = more than 3 months of cover. Adjustable per line in the Alerts view.
export const DEFAULT_THRESHOLDS: Thresholds = { lowMonths: 0.5, overMonths: 3, byLine: {} };
