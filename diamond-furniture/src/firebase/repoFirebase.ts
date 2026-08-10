import {
  collection, doc, onSnapshot, setDoc, getDoc, getDocs, deleteDoc, addDoc, serverTimestamp,
} from 'firebase/firestore';
import type {
  CatalogSku, Machine, MonthRow, PeriodSnapshot, ProdLogEntry, Thresholds,
} from '../domain/types';
import { periodKeyFromLabel, periodLabel } from '../domain/period';
import { db } from './config';
import { safeDocId } from './docId';
import {
  DEFAULT_THRESHOLDS, type AuditEntry, type Identity, type ImportPayload,
  type PersistedState, type Repo,
} from '../store/types';

/**
 * Firestore backend (catalog + monthly-history model).
 *   catalog/{docId}   → { uid, line, model, colour, reorder?, note?, cost?, price? }   (permanent)
 *   periods/{key}     → { key, label, machines[], rows: { [docId]: { uid, o, s, c } } } (one per month)
 *   settings/app      → { thresholds }
 *   productionLog/{id}, audit/{id}, users/{uid}
 *
 * A month is a single document, so a whole import is one write (no bulk-write
 * limits), and per-SKU edits deep-merge safely. Old skus/{docId} docs are kept
 * as a backup and migrated on first load.
 */
type RowVal = { uid: string; o: number; s: number; c: number };
interface PeriodDoc {
  key: string; label: string; machines?: Machine[]; rows?: Record<string, RowVal>;
}

export class FirebaseRepo implements Repo {
  private catalog: CatalogSku[] = [];
  private periods: PeriodSnapshot[] = [];
  private settings: { thresholds?: Thresholds } = {};
  private prodLog: ProdLogEntry[] = [];
  private audit: AuditEntry[] = [];
  private ready = { catalog: false, periods: false, settings: false };
  private migrationTried = false;
  private listeners = new Set<(s: PersistedState) => void>();

  constructor(private identity: Identity) {}

  private db() {
    if (!db) throw new Error('Firestore not initialised');
    return db;
  }

  private compose(): PersistedState {
    return {
      catalog: this.catalog,
      periods: this.periods,
      latestPeriodKey: this.periods.map((p) => p.key).sort().at(-1) ?? '',
      prodLog: this.prodLog,
      thresholds: this.settings.thresholds ?? DEFAULT_THRESHOLDS,
      role: this.identity.role,
      audit: this.audit,
    };
  }

  private emit() {
    if (!this.ready.catalog || !this.ready.periods || !this.ready.settings) return;
    const s = this.compose();
    for (const cb of this.listeners) cb(s);
  }

  subscribe(cb: (s: PersistedState) => void): () => void {
    this.listeners.add(cb);
    const d = this.db();
    const unsubs = [
      onSnapshot(collection(d, 'catalog'), (snap) => {
        this.catalog = snap.docs.map((x) => x.data() as CatalogSku);
        this.ready.catalog = true;
        if (snap.empty && !this.migrationTried && this.identity.role !== 'viewer') {
          this.migrationTried = true;
          void this.migrate();
        }
        this.emit();
      }),
      onSnapshot(collection(d, 'periods'), (snap) => {
        this.periods = snap.docs.map((x) => {
          const p = x.data() as PeriodDoc;
          const rows: MonthRow[] = Object.values(p.rows ?? {}).map((v) => ({
            uid: v.uid, opening: v.o ?? 0, sold: v.s ?? 0, closing: v.c ?? 0,
          }));
          return { key: p.key ?? x.id, label: p.label ?? periodLabel(x.id), machines: p.machines ?? [], rows };
        });
        this.ready.periods = true;
        this.emit();
      }),
      onSnapshot(doc(d, 'settings', 'app'), (snap) => {
        this.settings = (snap.data() as { thresholds?: Thresholds }) ?? {};
        this.ready.settings = true;
        this.emit();
      }),
      onSnapshot(collection(d, 'productionLog'), (snap) => {
        this.prodLog = snap.docs.map((x) => x.data() as ProdLogEntry).sort((a, b) => b.date.localeCompare(a.date));
        this.emit();
      }),
      onSnapshot(collection(d, 'audit'), (snap) => {
        this.audit = snap.docs
          .map((x) => ({ id: x.id, ...(x.data() as Omit<AuditEntry, 'id'>) }))
          .sort((a, b) => b.at - a.at);
        this.emit();
      }),
    ];
    return () => {
      this.listeners.delete(cb);
      unsubs.forEach((u) => u());
    };
  }

  /** One-time, non-destructive migration from the old skus/ collection. */
  private async migrate(): Promise<void> {
    const d = this.db();
    try {
      const skuSnap = await getDocs(collection(d, 'skus'));
      if (skuSnap.empty) return; // fresh project — nothing to migrate
      const setSnap = await getDoc(doc(d, 'settings', 'app'));
      const s = (setSnap.data() as { period?: string; machines?: Machine[] }) ?? {};
      const label = s.period ?? 'April 2026';
      const key = periodKeyFromLabel(label) ?? 'legacy';
      const rows: Record<string, RowVal> = {};
      const docs = skuSnap.docs;
      for (let i = 0; i < docs.length; i += 40) {
        await Promise.all(docs.slice(i, i + 40).map((x) => {
          const data = x.data() as CatalogSku & { opening?: number; sold?: number; closing?: number };
          rows[x.id] = { uid: data.uid ?? x.id, o: data.opening ?? 0, s: data.sold ?? 0, c: data.closing ?? 0 };
          const cat: CatalogSku = { uid: data.uid ?? x.id, line: data.line, model: data.model, colour: data.colour };
          if (data.reorder != null) cat.reorder = data.reorder;
          if (data.note) cat.note = data.note;
          return setDoc(doc(d, 'catalog', x.id), cat);
        }));
      }
      await setDoc(doc(d, 'periods', key), { key, label, machines: s.machines ?? [], rows });
      // old skus/ left in place as a backup.
    } catch (e) {
      console.error('Migration failed:', e);
    }
  }

  private async writeAudit(a: AuditEntry) {
    await addDoc(collection(this.db(), 'audit'), {
      at: a.at, user: a.user, role: a.role, action: a.action,
      target: a.target ?? null, detail: a.detail ?? null, serverAt: serverTimestamp(),
    });
  }

  async saveSku(
    uid: string, periodKey: string,
    numbers: { closing: number; sold: number },
    settings: { reorder: number; note: string },
    audit: AuditEntry,
  ): Promise<void> {
    const d = this.db();
    const id = safeDocId(uid);
    await setDoc(doc(d, 'catalog', id), { reorder: settings.reorder, note: settings.note }, { merge: true });
    await setDoc(
      doc(d, 'periods', periodKey),
      { rows: { [id]: { uid, s: numbers.sold, c: numbers.closing } } },
      { merge: true },
    );
    await this.writeAudit(audit);
  }

  async addProdLog(entry: ProdLogEntry, audit: AuditEntry): Promise<void> {
    await addDoc(collection(this.db(), 'productionLog'), entry);
    await this.writeAudit(audit);
  }

  async setThresholds(thresholds: Thresholds, audit: AuditEntry): Promise<void> {
    await setDoc(doc(this.db(), 'settings', 'app'), { thresholds }, { merge: true });
    await this.writeAudit(audit);
  }

  async applyImport(payload: ImportPayload, audit: AuditEntry): Promise<void> {
    const d = this.db();
    if (payload.catalogUpserts?.length) {
      const ups = payload.catalogUpserts;
      for (let i = 0; i < ups.length; i += 40) {
        await Promise.all(ups.slice(i, i + 40).map((c) =>
          setDoc(doc(d, 'catalog', safeDocId(c.uid)),
            { uid: c.uid, line: c.line, model: c.model, colour: c.colour }, { merge: true })));
      }
    }
    if (payload.snapshot) {
      const snap = payload.snapshot;
      const rows: Record<string, RowVal> = {};
      for (const r of snap.rows) rows[safeDocId(r.uid)] = { uid: r.uid, o: r.opening, s: r.sold, c: r.closing };
      await setDoc(doc(d, 'periods', snap.key), { key: snap.key, label: snap.label, machines: snap.machines, rows });
    }
    if (payload.machinesFor) {
      await setDoc(doc(d, 'periods', payload.machinesFor.key), { machines: payload.machinesFor.machines }, { merge: true });
    }
    await this.writeAudit(audit);
  }

  async scrubYear(audit: AuditEntry): Promise<void> {
    const d = this.db();
    const snap = await getDocs(collection(d, 'periods'));
    for (const x of snap.docs) await deleteDoc(doc(d, 'periods', x.id));
    await this.writeAudit(audit); // catalog kept intact
  }
}
