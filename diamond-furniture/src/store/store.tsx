import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
  type ReactNode,
} from 'react';
import type {
  CatalogSku, EffSku, Machine, PeriodSnapshot, ProdLogEntry, Role, Thresholds, ParsedWorkbook,
} from '../domain/types';
import { effWithHistory, normalizeDataset } from '../domain/logic';
import { periodKeyFromLabel, periodLabel, trailingPeriods, financialYearOf } from '../domain/period';
import {
  DEFAULT_THRESHOLDS, type AuditEntry, type Identity, type ImportPayload,
  type PersistedState, type Repo,
} from './types';

export type Mode = 'demo' | 'firebase';

interface AppContextValue {
  loading: boolean;
  mode: Mode;
  // data
  catalog: CatalogSku[];
  periods: PeriodSnapshot[];
  periodKeys: string[];        // newest → oldest, for the selector
  currentPeriodKey: string;
  setPeriod: (key: string) => void;
  latestPeriodKey: string;
  financialYearLabel: string;
  dataset: { skus: never[]; lines: string[]; machines: Machine[] } | null;
  effs: EffSku[];
  prodLog: ProdLogEntry[];
  thresholds: Thresholds;
  period: string;              // label of the selected month
  audit: AuditEntry[];
  // identity
  role: Role;
  uid: string;
  userName: string;
  canEdit: boolean;
  isOwner: boolean;
  // actions
  setDemoRole: (role: Role) => void;
  saveEdit: (id: string, patch: { closing: number; sold: number; reorder: number; note: string }, prevClosing: number) => Promise<void>;
  addProduction: (entry: ProdLogEntry) => Promise<void>;
  setDefaultThreshold: (field: 'lowMonths' | 'overMonths', value: number) => Promise<void>;
  setLineThreshold: (line: string, field: 'lowMonths' | 'overMonths', value: number | undefined) => Promise<void>;
  applyImport: (parsed: ParsedWorkbook, periodLabelStr: string) => Promise<void>;
  scrubYear: () => Promise<void>;
}

const Ctx = createContext<AppContextValue | null>(null);

const empty: PersistedState = {
  catalog: [], periods: [], latestPeriodKey: '', prodLog: [],
  thresholds: DEFAULT_THRESHOLDS, role: 'owner', audit: [],
};

function uniqueLines(catalog: CatalogSku[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of catalog) if (c.line && !seen.has(c.line)) { seen.add(c.line); out.push(c.line); }
  return out.sort((a, b) => a.localeCompare(b));
}

export function AppProvider({
  repo, mode, identity, children,
}: {
  repo: Repo;
  mode: Mode;
  identity: Identity | null;
  children: ReactNode;
}) {
  const [state, setState] = useState<PersistedState>(empty);
  const [loading, setLoading] = useState(true);
  const [selectedKey, setSelectedKey] = useState<string>('');

  useEffect(() => {
    const unsub = repo.subscribe((s) => { setState(s); setLoading(false); });
    return unsub;
  }, [repo]);

  const periodKeys = useMemo(
    () => [...state.periods.map((p) => p.key)].sort((a, b) => (a < b ? 1 : -1)),
    [state.periods],
  );

  // Keep the local selection valid: default to the latest month.
  useEffect(() => {
    if (!periodKeys.length) { if (selectedKey) setSelectedKey(''); return; }
    if (!periodKeys.includes(selectedKey)) setSelectedKey(state.latestPeriodKey || periodKeys[0]);
  }, [periodKeys, state.latestPeriodKey, selectedKey]);

  const currentPeriodKey = periodKeys.includes(selectedKey) ? selectedKey : (state.latestPeriodKey || periodKeys[0] || '');

  const role: Role = mode === 'firebase' ? identity?.role ?? 'viewer' : state.role;
  const uid = mode === 'firebase' ? identity?.uid ?? '' : 'demo';
  const userName = mode === 'firebase' ? identity?.name ?? 'User' : 'Demo user';
  const canEdit = role !== 'viewer';
  const isOwner = role === 'owner';

  const currentSnapshot = useMemo(
    () => state.periods.find((p) => p.key === currentPeriodKey) ?? null,
    [state.periods, currentPeriodKey],
  );

  const effs = useMemo(() => {
    if (!currentPeriodKey) return [];
    const window = trailingPeriods(currentPeriodKey, 3);
    const trailing = window
      .map((k) => state.periods.find((p) => p.key === k))
      .filter((p): p is PeriodSnapshot => !!p);
    return effWithHistory(state.catalog, currentSnapshot, trailing, {}, state.thresholds);
  }, [state.catalog, state.periods, currentSnapshot, currentPeriodKey, state.thresholds]);

  const dataset = useMemo(
    () => (state.catalog.length || currentSnapshot
      ? { skus: [] as never[], lines: uniqueLines(state.catalog), machines: currentSnapshot?.machines ?? [] }
      : null),
    [state.catalog, currentSnapshot],
  );

  const periodLabelText = currentSnapshot?.label ?? (currentPeriodKey ? periodLabel(currentPeriodKey) : '—');
  const financialYearLabel = currentPeriodKey ? financialYearOf(currentPeriodKey).label : '';

  const mkAudit = useCallback(
    (action: AuditEntry['action'], target?: string, detail?: string): AuditEntry => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      at: Date.now(), user: userName, role, action, target, detail,
    }),
    [userName, role],
  );

  const setDemoRole = useCallback((r: Role) => repo.setDemoRole?.(r), [repo]);

  const saveEdit = useCallback<AppContextValue['saveEdit']>(
    async (id, patch, prevClosing) => {
      const detail = prevClosing !== patch.closing ? `stock ${prevClosing} → ${patch.closing}` : 'edited';
      await repo.saveSku(id, currentPeriodKey, { closing: patch.closing, sold: patch.sold },
        { reorder: patch.reorder, note: patch.note }, mkAudit('edit-sku', id, detail));
    },
    [repo, mkAudit, currentPeriodKey],
  );

  const addProduction = useCallback<AppContextValue['addProduction']>(
    async (entry) => {
      await repo.addProdLog(entry, mkAudit('log-production', entry.machine, `${entry.line}: +${entry.qty}`));
    },
    [repo, mkAudit],
  );

  const setDefaultThreshold = useCallback<AppContextValue['setDefaultThreshold']>(
    async (field, value) => {
      const thresholds: Thresholds = { ...state.thresholds, [field]: value };
      await repo.setThresholds(thresholds, mkAudit('set-threshold', 'default', `${field} = ${value}`));
    },
    [repo, mkAudit, state.thresholds],
  );

  const setLineThreshold = useCallback<AppContextValue['setLineThreshold']>(
    async (line, field, value) => {
      const byLine = { ...state.thresholds.byLine };
      const cur = { ...(byLine[line] || {}) };
      if (value == null || Number.isNaN(value)) delete cur[field];
      else cur[field] = value;
      if (Object.keys(cur).length) byLine[line] = cur; else delete byLine[line];
      const thresholds: Thresholds = { ...state.thresholds, byLine };
      await repo.setThresholds(thresholds, mkAudit('set-threshold', line, `${field} = ${value ?? 'default'}`));
    },
    [repo, mkAudit, state.thresholds],
  );

  const applyImport = useCallback<AppContextValue['applyImport']>(
    async (parsed, periodLabelStr) => {
      const key = periodKeyFromLabel(periodLabelStr) ?? currentPeriodKey ?? state.latestPeriodKey;
      const audit = mkAudit('import', periodLabelStr, `${parsed.skus.length} SKUs · ${parsed.machines.length} machines`);
      if (parsed.skus.length) {
        const norm = normalizeDataset({ skus: parsed.skus, lines: parsed.lines, machines: parsed.machines });
        const payload: ImportPayload = {
          catalogUpserts: norm.skus.map((s) => ({ uid: s.uid!, line: s.line, model: s.model, colour: s.colour })),
          snapshot: {
            key, label: periodLabelStr, machines: parsed.machines,
            rows: norm.skus.map((s) => ({ uid: s.uid!, opening: s.opening, sold: s.sold, closing: s.closing })),
          },
        };
        await repo.applyImport(payload, audit);
      } else if (parsed.machines.length) {
        await repo.applyImport({ machinesFor: { key: key || currentPeriodKey, machines: parsed.machines } }, audit);
      }
      setSelectedKey(key);
    },
    [repo, mkAudit, currentPeriodKey, state.latestPeriodKey],
  );

  const scrubYear = useCallback<AppContextValue['scrubYear']>(
    async () => {
      await repo.scrubYear(mkAudit('scrub-year', financialYearLabel, 'cleared monthly numbers; kept catalog'));
    },
    [repo, mkAudit, financialYearLabel],
  );

  const value: AppContextValue = {
    loading, mode,
    catalog: state.catalog, periods: state.periods, periodKeys, currentPeriodKey,
    setPeriod: setSelectedKey, latestPeriodKey: state.latestPeriodKey, financialYearLabel,
    dataset, effs, prodLog: state.prodLog, thresholds: state.thresholds, period: periodLabelText, audit: state.audit,
    role, uid, userName, canEdit, isOwner,
    setDemoRole, saveEdit, addProduction, setDefaultThreshold, setLineThreshold, applyImport, scrubYear,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used within AppProvider');
  return v;
}
