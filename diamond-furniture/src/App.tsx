import { useState } from 'react';
import {
  LayoutDashboard, Package, AlertTriangle, ClipboardList, Factory,
  TrendingUp, FileText, History, Users, Menu, X, Upload,
  type LucideIcon,
} from 'lucide-react';
import { useApp } from './store/store';
import { useToast } from './components/Toast';
import type { Role, EffSku } from './domain/types';
import { periodLabel } from './domain/period';
import type { View } from './views/types';
import { Dashboard } from './views/Dashboard';
import { Inventory } from './views/Inventory';
import { Production } from './views/Production';
import { Orders } from './views/Orders';
import { Trends } from './views/Trends';
import { Alerts } from './views/Alerts';
import { Reports } from './views/Reports';
import { Activity } from './views/Activity';
import { Team } from './views/Team';
import { EditDialog } from './components/dialogs/EditDialog';
import { ProductionDialog } from './components/dialogs/ProductionDialog';
import { ImportDialog } from './components/dialogs/ImportDialog';

interface NavItem { id: View; label: string; icon: LucideIcon; ownerOnly?: boolean; firebaseOnly?: boolean }

const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  { label: 'Overview', items: [{ id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard }] },
  { label: 'Stock', items: [
    { id: 'inventory', label: 'Inventory', icon: Package },
    { id: 'alerts', label: 'Alerts', icon: AlertTriangle },
  ] },
  { label: 'Sales', items: [{ id: 'orders', label: 'Orders', icon: ClipboardList }] },
  { label: 'Production', items: [
    { id: 'production', label: 'Production', icon: Factory },
    { id: 'trends', label: 'Trends', icon: TrendingUp },
  ] },
  { label: 'Reports', items: [{ id: 'reports', label: 'Reports', icon: FileText }] },
  { label: 'Admin', items: [
    { id: 'activity', label: 'Activity', icon: History, ownerOnly: true },
    { id: 'team', label: 'Team', icon: Users, ownerOnly: true, firebaseOnly: true },
  ] },
];

export function App({ onSignOut }: { onSignOut?: () => void }) {
  const app = useApp();
  const flash = useToast();
  const [view, setViewRaw] = useState<View>('dashboard');
  const [editing, setEditing] = useState<EffSku | null>(null);
  const [prodOpen, setProdOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  if (app.loading) {
    return <div style={{ padding: 80, textAlign: 'center', color: 'var(--color-neutral-600)' }}>Loading inventory…</div>;
  }

  const setView = (v: View) => { setViewRaw(v); setMenuOpen(false); };
  const openImport = () => (app.canEdit ? setImportOpen(true) : flash('View-only role cannot import data'));
  const openProd = () => (app.canEdit ? setProdOpen(true) : flash('View-only role cannot log production'));

  const urgent = app.effs.filter((s) => s.status === 'Negative' || s.status === 'Low').length;

  const groups = NAV_GROUPS
    .map((g) => ({ ...g, items: g.items.filter((n) => (!n.ownerOnly || app.isOwner) && (!n.firebaseOnly || app.mode === 'firebase')) }))
    .filter((g) => g.items.length);

  return (
    <div className="app-shell">
      <aside className={`app-sidebar no-print ${menuOpen ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <span className="mark">Diamond Furniture</span>
          <span className="sub">Inventory Control</span>
        </div>
        <nav className="nav-scroll" aria-label="Sections">
          {groups.map((g) => (
            <div key={g.label}>
              <div className="nav-group-label">{g.label}</div>
              {g.items.map((n) => {
                const Icon = n.icon;
                return (
                  <button key={n.id} className="nav-link" aria-current={view === n.id ? 'page' : undefined} onClick={() => setView(n.id)}>
                    <Icon size={18} strokeWidth={2} className="ico" />
                    <span className="lbl">{n.label}</span>
                    {n.id === 'alerts' && urgent > 0 && <span className="nav-badge">{urgent}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          {app.mode === 'demo' ? (
            <div className="field-inline">
              <label>Signed in as</label>
              <select className="input" value={app.role} onChange={(e) => app.setDemoRole(e.target.value as Role)}>
                <option value="owner">Owner — full control</option>
                <option value="manager">Manager — can edit</option>
                <option value="viewer">Viewer — view only</option>
              </select>
            </div>
          ) : (
            <>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{app.userName}</span>
              <button className="btn btn-ghost" style={{ fontSize: 12, padding: 0, justifyContent: 'flex-start' }} onClick={onSignOut}>
                {app.role} · Sign out
              </button>
            </>
          )}
        </div>
      </aside>

      {menuOpen && <div className="drawer-backdrop no-print" onClick={() => setMenuOpen(false)} />}

      <div className="app-body">
        <header className="topbar no-print">
          <button className="menu-btn" aria-label={menuOpen ? 'Close menu' : 'Open menu'} onClick={() => setMenuOpen((o) => !o)}>
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          <div className="spacer" />
          {app.periodKeys.length > 0 ? (
            <div className="field-inline">
              <label htmlFor="month-sel">Month</label>
              <select
                id="month-sel" className="input" value={app.currentPeriodKey}
                onChange={(e) => app.setPeriod(e.target.value)} style={{ minWidth: 132 }}
                title="Choose which month to view"
              >
                {app.periodKeys.length > 1 && <option value="__all__">All months (overall)</option>}
                {app.periodKeys.map((k) => (
                  <option key={k} value={k}>{periodLabel(k)}{k === app.latestPeriodKey ? ' (latest)' : ''}</option>
                ))}
              </select>
            </div>
          ) : (
            <span className="tag tag-neutral" style={{ whiteSpace: 'nowrap' }}>No data yet</span>
          )}
          <button className="btn btn-primary" onClick={openImport} disabled={!app.canEdit} style={{ whiteSpace: 'nowrap' }}>
            <Upload size={16} /> Import
          </button>
        </header>

        <main className="app-main">
          {view === 'dashboard' && <Dashboard setView={setView} />}
          {view === 'inventory' && <Inventory onEdit={setEditing} />}
          {view === 'orders' && <Orders />}
          {view === 'production' && <Production onLog={openProd} />}
          {view === 'trends' && <Trends />}
          {view === 'alerts' && <Alerts onEdit={setEditing} />}
          {view === 'reports' && <Reports />}
          {view === 'activity' && app.isOwner && <Activity />}
          {view === 'team' && app.isOwner && app.mode === 'firebase' && <Team />}
        </main>
      </div>

      {editing && <EditDialog sku={editing} onClose={() => setEditing(null)} />}
      {prodOpen && <ProductionDialog onClose={() => setProdOpen(false)} />}
      {importOpen && <ImportDialog onClose={() => setImportOpen(false)} />}
    </div>
  );
}
