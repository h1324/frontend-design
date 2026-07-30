// Domain types for the Diamond Furniture inventory app.

export type Status = 'Negative' | 'Low' | 'Overstock' | 'No activity' | 'OK' | 'Empty';

export type Role = 'owner' | 'manager' | 'viewer';

/** A raw SKU row as parsed from the Master SKU List (quantities are whole pieces). */
export interface RawSku {
  line: string;
  model: string;
  colour: string;
  opening: number;
  sold: number;
  closing: number;
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
  cover: number;
  status: Status;
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

/** Parsed workbook result from the XLSX importer. */
export interface ParsedWorkbook {
  skus: RawSku[];
  lines: string[];
  machines: Machine[];
  sheetNames: string[];
}
