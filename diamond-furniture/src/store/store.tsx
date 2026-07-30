import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
  type ReactNode,
} from 'react';
import type {
  Dataset, EffSku, Overrides, ProdLogEntry, Role, Thresholds,
} from '../domain/types';
import { eff } from '../domain/logic';
import { applyParsedToDataset, preserveOverrides } from '../domain/applyImport';
import type { ParsedWorkbook } from '../domain/types';
import {
  DEFAULT_THRESHOLDS, type AuditEntry, type Identity, type PersistedState, type Repo,
} from './types';

export type Mode = 'demo' | 'firebase';

interface AppContextValue {
  loading: boolean;
  mode: Mode;
  dataset: Dataset | null;
  effs: EffSku[];
  ov: Overrides;
  prodLog: ProdLogEntry[];
  thresholds: Thresholds;
  period: string;
  audit: AuditEntry[];
  role: Role;
  userName: string;
  canEdit: boolean;
  isOwner: boolean;
  // actions
  setDemoRole: (role: Role) => void;
  saveEdit: (id: string, patch: { closing: number; sold: number; reorder: number; note: string }, prevClosing: number) => Promise<void>;
  addProduction: (entry: ProdLogEntry) => Promise<void>;
  setDefaultThreshold: (field: 'lowMonths' | 'overMonths', value: number) => Promise<void>;
  setLineThreshold: (line: string, field: 'lowMonths' | 'overMonths', value: number | undefined) => Promise<void>;
  applyImport: (parsed: ParsedWorkbook, period: string) => Promise<void>;
}

const Ctx = createContext<AppContextValue | null>(null);

const empty: PersistedState = {
  dataset: null, ov: {}, prodLog: [], thresholds: DEFAULT_THRESHOLDS,
  period: 'April 2026', role: 'owner', audit: [],
};

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

  useEffect(() => {
    const unsub = repo.subscribe((s) => {
      setState(s);
      setLoading(false);
    });
    return unsub;
  }, [repo]);

  const role: Role = mode === 'firebase' ? identity?.role ?? 'viewer' : state.role;
  const userName = mode === 'firebase' ? identity?.name ?? 'User' : 'Demo user';
  const canEdit = role !== 'viewer';
  const isOwner = role === 'owner';

  const effs = useMemo(
    () => eff(state.dataset, state.ov, state.thresholds),
    [state.dataset, state.ov, state.thresholds],
  );

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
      const detail =
        prevClosing !== patch.closing ? `stock ${prevClosing} → ${patch.closing}` : 'edited';
      await repo.saveOverride(id, patch, mkAudit('edit-sku', id, detail));
    },
    [repo, mkAudit],
  );

  const addProduction = useCallback<AppContextValue['addProduction']>(
    async (entry) => {
      await repo.addProdLog(
        entry,
        mkAudit('log-production', entry.machine, `${entry.line}: +${entry.qty}`),
      );
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
      if (Object.keys(cur).length) byLine[line] = cur;
      else delete byLine[line];
      const thresholds: Thresholds = { ...state.thresholds, byLine };
      await repo.setThresholds(thresholds, mkAudit('set-threshold', line, `${field} = ${value ?? 'default'}`));
    },
    [repo, mkAudit, state.thresholds],
  );

  const applyImport = useCallback<AppContextValue['applyImport']>(
    async (parsed, period) => {
      const current: Dataset = state.dataset ?? { skus: [], lines: [], machines: [] };
      const dataset = applyParsedToDataset(current, parsed);
      const keptOv = preserveOverrides(state.ov);
      await repo.applyImport(
        { dataset, ov: keptOv, period },
        mkAudit('import', period, `${parsed.skus.length} SKUs · ${parsed.machines.length} machines`),
      );
    },
    [repo, mkAudit, state.dataset, state.ov],
  );

  const value: AppContextValue = {
    loading, mode,
    dataset: state.dataset, effs, ov: state.ov, prodLog: state.prodLog,
    thresholds: state.thresholds, period: state.period, audit: state.audit,
    role, userName, canEdit, isOwner,
    setDemoRole, saveEdit, addProduction, setDefaultThreshold, setLineThreshold, applyImport,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used within AppProvider');
  return v;
}
