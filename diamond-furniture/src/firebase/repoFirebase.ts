import {
  collection, doc, onSnapshot, setDoc, addDoc, writeBatch, serverTimestamp,
} from 'firebase/firestore';
import type { Dataset, Machine, Overrides, ProdLogEntry, RawSku, Thresholds } from '../domain/types';
import { normalizeDataset } from '../domain/logic';
import { db } from './config';
import { safeDocId } from './docId';
import {
  DEFAULT_THRESHOLDS, type AuditEntry, type Identity, type PersistedState, type Repo,
} from '../store/types';

/**
 * Firestore backend. Layout:
 *   skus/{uid}          → { line, model, colour, opening, sold, closing, reorder?, note? }
 *   settings/app        → { thresholds, period, lines, machines }
 *   productionLog/{id}  → { machine, date, line, qty }
 *   audit/{id}          → { at, user, role, action, target?, detail? }
 *
 * Edits write directly to the sku doc (the README's "overrides become field
 * writes"); reorder/note are folded back into the in-memory `ov` map so the
 * shared domain logic is identical to demo mode.
 */
type SkuDoc = RawSku & { reorder?: number; note?: string };
interface SettingsDoc {
  thresholds?: Thresholds;
  period?: string;
  lines?: string[];
  machines?: Machine[];
}

export class FirebaseRepo implements Repo {
  private skus: SkuDoc[] = [];
  private skuDocIds: string[] = []; // actual Firestore doc IDs currently present
  private settings: SettingsDoc = {};
  private prodLog: ProdLogEntry[] = [];
  private audit: AuditEntry[] = [];
  private ready = { skus: false, settings: false, prod: false, audit: false };
  private listeners = new Set<(s: PersistedState) => void>();

  constructor(private identity: Identity) {}

  private db() {
    if (!db) throw new Error('Firestore not initialised');
    return db;
  }

  private compose(): PersistedState {
    const raw: RawSku[] = [];
    const ov: Overrides = {};
    for (const s of this.skus) {
      const uid = s.uid!;
      raw.push({ line: s.line, model: s.model, colour: s.colour, opening: s.opening, sold: s.sold, closing: s.closing, uid });
      if (s.reorder != null || s.note) ov[uid] = { reorder: s.reorder, note: s.note };
    }
    const dataset: Dataset = normalizeDataset({
      skus: raw,
      lines: this.settings.lines ?? [...new Set(raw.map((r) => r.line))],
      machines: this.settings.machines ?? [],
    });
    return {
      dataset,
      ov,
      prodLog: this.prodLog,
      thresholds: this.settings.thresholds ?? DEFAULT_THRESHOLDS,
      period: this.settings.period ?? 'April 2026',
      role: this.identity.role,
      audit: this.audit,
    };
  }

  private emit() {
    if (!this.ready.skus || !this.ready.settings) return; // wait for core data
    const s = this.compose();
    for (const cb of this.listeners) cb(s);
  }

  subscribe(cb: (s: PersistedState) => void): () => void {
    this.listeners.add(cb);
    const d = this.db();
    const unsubs = [
      onSnapshot(collection(d, 'skus'), (snap) => {
        // uid is the readable key stored as a field; the doc ID is a safe hash.
        // Fall back to the doc ID for any legacy docs written before this change.
        this.skus = snap.docs.map((x) => {
          const data = x.data() as SkuDoc;
          return { ...data, uid: data.uid ?? x.id };
        });
        this.skuDocIds = snap.docs.map((x) => x.id);
        this.ready.skus = true;
        this.emit();
      }),
      onSnapshot(doc(d, 'settings', 'app'), (snap) => {
        this.settings = (snap.data() as SettingsDoc) ?? {};
        this.ready.settings = true;
        this.emit();
      }),
      onSnapshot(collection(d, 'productionLog'), (snap) => {
        this.prodLog = snap.docs
          .map((x) => x.data() as ProdLogEntry)
          .sort((a, b) => b.date.localeCompare(a.date));
        this.ready.prod = true;
        this.emit();
      }),
      onSnapshot(collection(d, 'audit'), (snap) => {
        this.audit = snap.docs
          .map((x) => ({ id: x.id, ...(x.data() as Omit<AuditEntry, 'id'>) }))
          .sort((a, b) => b.at - a.at);
        this.ready.audit = true;
        this.emit();
      }),
    ];
    return () => {
      this.listeners.delete(cb);
      unsubs.forEach((u) => u());
    };
  }

  private async writeAudit(a: AuditEntry) {
    await addDoc(collection(this.db(), 'audit'), {
      at: a.at, user: a.user, role: a.role, action: a.action,
      target: a.target ?? null, detail: a.detail ?? null, serverAt: serverTimestamp(),
    });
  }

  async saveOverride(id: string, patch: Overrides[string], audit: AuditEntry): Promise<void> {
    // `id` is the readable key; the document lives under a safe hashed ID.
    await setDoc(doc(this.db(), 'skus', safeDocId(id)), { ...patch, uid: id }, { merge: true });
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

  async applyImport(
    next: { dataset: Dataset; ov: Overrides; period: string },
    audit: AuditEntry,
  ): Promise<void> {
    const d = this.db();
    const norm = normalizeDataset(next.dataset);
    const rows = norm.skus;

    // Write (upsert) every SKU under a safe, hashed doc ID, keeping the readable
    // key as the `uid` field. Chunk into batches (Firestore limit 500 ops/batch).
    const newIds = new Set<string>();
    for (let i = 0; i < rows.length; i += 450) {
      const batch = writeBatch(d);
      for (const s of rows.slice(i, i + 450)) {
        const uid = s.uid!;
        const docId = safeDocId(uid);
        newIds.add(docId);
        const kept = next.ov[uid] || {};
        batch.set(doc(d, 'skus', docId), {
          uid,
          line: s.line, model: s.model, colour: s.colour,
          opening: s.opening, sold: s.sold, closing: s.closing,
          ...(kept.reorder != null ? { reorder: kept.reorder } : {}),
          ...(kept.note ? { note: kept.note } : {}),
        });
      }
      await batch.commit();
    }

    // Remove any docs no longer present (incl. legacy IDs from before this fix),
    // so a re-import can't leave duplicates behind. Done after writes so the data
    // is never momentarily empty.
    const orphans = this.skuDocIds.filter((id) => !newIds.has(id));
    for (let i = 0; i < orphans.length; i += 450) {
      const batch = writeBatch(d);
      for (const id of orphans.slice(i, i + 450)) batch.delete(doc(d, 'skus', id));
      await batch.commit();
    }

    await setDoc(
      doc(d, 'settings', 'app'),
      { lines: norm.lines, machines: norm.machines, period: next.period },
      { merge: true },
    );
    await this.writeAudit(audit);
  }
}
