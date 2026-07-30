import type { Dataset, Overrides, ProdLogEntry, Role, Thresholds } from '../domain/types';
import { normalizeDataset } from '../domain/logic';
import { DEFAULT_THRESHOLDS, type AuditEntry, type PersistedState, type Repo } from '../store/types';
import seed from '../data/data.json';

const KEY = 'diamond_inv_v1';
const SEED = seed as unknown as Dataset;

function load(): PersistedState {
  let saved: Partial<PersistedState> = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    /* ignore corrupt storage */
  }
  const dataset = normalizeDataset(saved.dataset && saved.dataset.skus?.length ? saved.dataset : SEED);
  return {
    dataset,
    ov: saved.ov || {},
    prodLog: saved.prodLog || [],
    thresholds: saved.thresholds || DEFAULT_THRESHOLDS,
    period: saved.period || 'April 2026',
    role: (saved.role as Role) || 'owner',
    audit: saved.audit || [],
  };
}

/** Local, single-user demo backend. Persists everything to localStorage. */
export class DemoRepo implements Repo {
  private state: PersistedState = load();
  private listeners = new Set<(s: PersistedState) => void>();

  private commit(next: Partial<PersistedState>) {
    this.state = { ...this.state, ...next };
    try {
      localStorage.setItem(KEY, JSON.stringify(this.state));
    } catch {
      /* storage full — keep in memory */
    }
    for (const cb of this.listeners) cb(this.state);
  }

  private pushAudit(a: AuditEntry): AuditEntry[] {
    return [a, ...this.state.audit].slice(0, 500);
  }

  subscribe(cb: (s: PersistedState) => void): () => void {
    this.listeners.add(cb);
    cb(this.state);
    return () => this.listeners.delete(cb);
  }

  async saveOverride(id: string, patch: Overrides[string], audit: AuditEntry): Promise<void> {
    this.commit({ ov: { ...this.state.ov, [id]: patch }, audit: this.pushAudit(audit) });
  }

  async addProdLog(entry: ProdLogEntry, audit: AuditEntry): Promise<void> {
    this.commit({ prodLog: [entry, ...this.state.prodLog], audit: this.pushAudit(audit) });
  }

  async setThresholds(thresholds: Thresholds, audit: AuditEntry): Promise<void> {
    this.commit({ thresholds, audit: this.pushAudit(audit) });
  }

  async applyImport(
    next: { dataset: Dataset; ov: Overrides; period: string },
    audit: AuditEntry,
  ): Promise<void> {
    this.commit({
      dataset: normalizeDataset(next.dataset),
      ov: next.ov,
      period: next.period,
      audit: this.pushAudit(audit),
    });
  }

  setDemoRole(role: Role): void {
    this.commit({ role });
  }
}
