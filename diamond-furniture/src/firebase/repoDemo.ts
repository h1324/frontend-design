import type {
  CatalogSku, Dataset, Machine, Order, OrderItem, PeriodSnapshot, ProdLogEntry, Role, Thresholds,
} from '../domain/types';
import { catalogFromDataset, snapshotFromDataset } from '../domain/logic';
import { orderNo, ordersToKeepOnScrub } from '../domain/orders';
import { periodKeyFromLabel } from '../domain/period';
import {
  DEFAULT_THRESHOLDS, type AuditEntry, type ImportPayload, type PersistedState, type Repo,
} from '../store/types';
import seed from '../data/data.json';

const KEY = 'diamond_inv_v2';
const SEED = seed as unknown as Dataset;

interface StoredV2 {
  catalog: CatalogSku[];
  periods: PeriodSnapshot[];
  prodLog: ProdLogEntry[];
  orders: Order[];
  orderSeq: number;
  thresholds: Thresholds;
  role: Role;
  audit: AuditEntry[];
}

function seedState(): StoredV2 {
  // Split the bundled single-month dataset into catalog + one April 2026 snapshot.
  const key = periodKeyFromLabel('April 2026')!;
  return {
    catalog: catalogFromDataset(SEED),
    periods: [snapshotFromDataset(SEED, key, 'April 2026')],
    prodLog: [],
    orders: [],
    orderSeq: 1,
    thresholds: DEFAULT_THRESHOLDS,
    role: 'owner',
    audit: [],
  };
}

function load(): StoredV2 {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as StoredV2;
      if (s.catalog?.length) return { ...seedState(), ...s };
    }
  } catch {
    /* ignore */
  }
  return seedState();
}

const latestKey = (periods: PeriodSnapshot[]) =>
  periods.map((p) => p.key).sort().at(-1) ?? '';

/** Local, single-user demo backend for the new catalog + monthly-history model. */
export class DemoRepo implements Repo {
  private s: StoredV2 = load();
  private listeners = new Set<(s: PersistedState) => void>();

  private snapshot(): PersistedState {
    return {
      catalog: this.s.catalog,
      periods: this.s.periods,
      latestPeriodKey: latestKey(this.s.periods),
      prodLog: this.s.prodLog,
      orders: this.s.orders ?? [],
      orderSeq: this.s.orderSeq ?? 1,
      thresholds: this.s.thresholds,
      role: this.s.role,
      audit: this.s.audit,
    };
  }

  private commit(next: Partial<StoredV2>, audit?: AuditEntry) {
    this.s = { ...this.s, ...next };
    if (audit) this.s.audit = [audit, ...this.s.audit].slice(0, 500);
    try { localStorage.setItem(KEY, JSON.stringify(this.s)); } catch { /* full */ }
    for (const cb of this.listeners) cb(this.snapshot());
  }

  subscribe(cb: (s: PersistedState) => void): () => void {
    this.listeners.add(cb);
    cb(this.snapshot());
    return () => this.listeners.delete(cb);
  }

  async saveSku(
    uid: string, periodKey: string,
    numbers: { closing: number; sold: number },
    settings: { reorder: number; note: string },
    audit: AuditEntry,
  ): Promise<void> {
    const catalog = this.s.catalog.map((c) =>
      c.uid === uid ? { ...c, reorder: settings.reorder, note: settings.note } : c);
    const periods = this.s.periods.map((p) => {
      if (p.key !== periodKey) return p;
      const rows = p.rows.map((r) =>
        r.uid === uid ? { ...r, closing: numbers.closing, sold: numbers.sold } : r);
      if (!rows.some((r) => r.uid === uid)) rows.push({ uid, opening: 0, ...numbers });
      return { ...p, rows };
    });
    this.commit({ catalog, periods }, audit);
  }

  async addProdLog(entry: ProdLogEntry, audit: AuditEntry): Promise<void> {
    this.commit({ prodLog: [entry, ...this.s.prodLog] }, audit);
  }

  async setThresholds(thresholds: Thresholds, audit: AuditEntry): Promise<void> {
    this.commit({ thresholds }, audit);
  }

  async applyImport(payload: ImportPayload, audit: AuditEntry): Promise<void> {
    let catalog = this.s.catalog;
    let periods = this.s.periods;

    if (payload.catalogUpserts?.length) {
      const byId = new Map(catalog.map((c) => [c.uid, c]));
      for (const up of payload.catalogUpserts) {
        const existing = byId.get(up.uid);
        // preserve reorder/note on existing entries; update names + price; add new ones
        byId.set(up.uid, existing
          ? { ...existing, line: up.line, model: up.model, colour: up.colour, ...(up.price != null ? { price: up.price } : {}) }
          : up);
      }
      catalog = [...byId.values()];
    }
    if (payload.snapshot) {
      periods = [...periods.filter((p) => p.key !== payload.snapshot!.key), payload.snapshot];
    }
    if (payload.machinesFor) {
      periods = periods.map((p) =>
        p.key === payload.machinesFor!.key ? { ...p, machines: payload.machinesFor!.machines as Machine[] } : p);
    }
    this.commit({ catalog, periods }, audit);
  }

  async scrubYear(audit: AuditEntry): Promise<void> {
    // keep catalog, drop monthly numbers; carry over open/partial orders
    this.commit({ periods: [], orders: ordersToKeepOnScrub(this.s.orders ?? []) }, audit);
  }

  async createOrder(
    input: { dealer: string; date: string; note?: string; items: OrderItem[] },
    audit: AuditEntry,
  ): Promise<void> {
    const seq = this.s.orderSeq ?? 1;
    const order: Order = {
      id: orderNo(seq), no: seq, dealer: input.dealer, date: input.date, note: input.note,
      createdAt: Date.now(), items: input.items,
    };
    this.commit({ orders: [order, ...(this.s.orders ?? [])], orderSeq: seq + 1 }, audit);
  }

  async fulfilLine(orderId: string, itemIndex: number, qty: number, _periodKey: string, audit: AuditEntry): Promise<void> {
    // Orders are their own ledger — fulfilling advances the order line only and
    // never edits the imported month numbers, so "Sold (sheet)" and
    // "Dispatched (orders)" stay independent and can be cross-checked.
    const orders = (this.s.orders ?? []).map((o) => {
      if (o.id !== orderId) return o;
      const items = o.items.map((it, i) =>
        i === itemIndex ? { ...it, qtyFulfilled: Math.min(it.qtyOrdered, it.qtyFulfilled + qty) } : it);
      return { ...o, items };
    });
    this.commit({ orders }, audit);
  }

  async cancelOrder(orderId: string, audit: AuditEntry): Promise<void> {
    const orders = (this.s.orders ?? []).map((o) => (o.id === orderId ? { ...o, cancelled: true } : o));
    this.commit({ orders }, audit);
  }

  setDemoRole(role: Role): void {
    this.commit({ role });
  }
}
