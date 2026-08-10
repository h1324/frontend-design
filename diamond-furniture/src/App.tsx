import { useState } from 'react';
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

const NAV: { id: View; label: string; ownerOnly?: boolean; firebaseOnly?: boolean }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'orders', label: 'Orders' },
  { id: 'production', label: 'Production' },
  { id: 'trends', label: 'Trends' },
  { id: 'alerts', label: 'Alerts' },
  { id: 'reports', label: 'Reports' },
  { id: 'activity', label: 'Activity', ownerOnly: true },
  { id: 'team', label: 'Team', ownerOnly: true, firebaseOnly: true },
];

export function App({ onSignOut }: { onSignOut?: () => void }) {
  const app = useApp();
  const flash = useToast();
  const [view, setView] = useState<View>('dashboard');
  const [editing, setEditing] = useState<EffSku | null>(null);
  const [prodOpen, setProdOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  if (app.loading) {
    return <div style={{ padding: 80, textAlign: 'center', color: 'var(--color-neutral-600)' }}>Loading inventory…</div>;
  }

  const nav = NAV.filter((n) => (!n.ownerOnly || app.isOwner) && (!n.firebaseOnly || app.mode === 'firebase'));
  const openImport = () => (app.canEdit ? setImportOpen(true) : flash('View-only role cannot import data'));
  const openProd = () => (app.canEdit ? setProdOpen(true) : flash('View-only role cannot log production'));

  return (
    <div className="app-shell">
      <header className="nav app-header no-print">
        <div className="nav-brand" style={{ display: 'flex', flexDirection: 'column', lineHeight: 1, gap: 2 }}>
          <span style={{ fontSize: 19, letterSpacing: '.02em' }}>DIAMOND FURNITURE</span>
          <span style={{ fontSize: 10, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--color-accent)' }}>Inventory Control</span>
        </div>
        <nav style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          {nav.map((n) => (
            <button key={n.id} className="nav-btn" aria-current={view === n.id ? 'page' : undefined} onClick={() => setView(n.id)}>
              {n.label}
            </button>
          ))}
        </nav>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 'auto' }}>
          <button className="btn btn-secondary" onClick={openImport} disabled={!app.canEdit} style={{ whiteSpace: 'nowrap' }}>↑ Import Excel</button>
          {app.periodKeys.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <label style={{ fontSize: 9, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--color-accent)' }}>Month</label>
              <select
                className="input" value={app.currentPeriodKey} onChange={(e) => app.setPeriod(e.target.value)}
                style={{ minHeight: 32, padding: '2px 8px', fontSize: 13, minWidth: 130 }}
                title="Choose which month to view"
              >
                {app.periodKeys.map((k) => (
                  <option key={k} value={k}>{periodLabel(k)}{k === app.latestPeriodKey ? ' (latest)' : ''}</option>
                ))}
              </select>
            </div>
          ) : (
            <span className="tag tag-neutral" style={{ whiteSpace: 'nowrap' }}>No data yet</span>
          )}
          {app.mode === 'demo' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <label style={{ fontSize: 9, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--color-accent)' }}>Signed in as</label>
              <select
                className="input" value={app.role} onChange={(e) => app.setDemoRole(e.target.value as Role)}
                style={{ minHeight: 32, padding: '2px 8px', fontSize: 13, minWidth: 160 }}
              >
                <option value="owner">Owner — full control</option>
                <option value="manager">Manager — can edit</option>
                <option value="viewer">Viewer — view only</option>
              </select>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-end' }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{app.userName}</span>
              <button className="btn btn-ghost" style={{ fontSize: 11, padding: 0 }} onClick={onSignOut}>
                {app.role} · Sign out
              </button>
            </div>
          )}
        </div>
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

      {editing && <EditDialog sku={editing} onClose={() => setEditing(null)} />}
      {prodOpen && <ProductionDialog onClose={() => setProdOpen(false)} />}
      {importOpen && <ImportDialog onClose={() => setImportOpen(false)} />}
    </div>
  );
}
