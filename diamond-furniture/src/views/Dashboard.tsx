import {
  BarChart, Bar, XAxis, YAxis, Cell, ResponsiveContainer, LabelList,
} from 'recharts';
import { Blueprint } from '../components/Blueprint';
import { BarList } from '../components/BarList';
import { useApp } from '../store/store';
import { fmt } from '../domain/format';
import { kpis, lineSummaries, statusCounts } from '../domain/logic';
import { valuation, soldViaOrders } from '../domain/metrics';
import { STATUS_META, STATUS_ORDER, IDLE_META } from '../domain/status';
import type { View } from './types';

export function Dashboard({ setView }: { setView: (v: View) => void }) {
  const { effs, dataset, prodLog, period, orders, currentPeriodKey } = useApp();
  const k = kpis(effs);
  // Sold, the second way: units dispatched through orders dated in this month.
  const dispatched = soldViaOrders(orders, currentPeriodKey);
  const lines = lineSummaries(effs);
  const machinesFresh = dataset?.machines.reduce((a, m) => a + m.fresh, 0) ?? 0;
  const loggedTotal = prodLog.reduce((a, l) => a + l.qty, 0);

  const val = valuation(effs);
  const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
  // Machine-sheet fresh output, kept only as a cross-check against the reliable
  // stock-math produced (the machine tabs over-count via subtotal rows).
  const machineFresh = machinesFresh + loggedTotal;
  const kpiCards = [
    { label: 'Units in stock', value: fmt(k.totalStock), sub: `across ${fmt(effs.length)} SKUs`, color: 'var(--color-text)' },
    { label: 'Sold this period', value: fmt(k.totalSold), sub: `${period} dispatches`, color: 'var(--color-text)' },
    { label: 'Urgent alerts', value: fmt(k.urgent), sub: `${k.negativeCount} negative · ${k.lowCount} low`, color: k.urgent ? STATUS_META.Negative.accent : 'var(--color-text)' },
    { label: 'Produced this period', value: fmt(k.totalProduced), sub: 'from stock movement', color: 'var(--color-accent-700)' },
    ...(val.hasPrice ? [{ label: 'Stock value', value: inr(val.stockValue), sub: `${inr(val.overstockValue)} in overstock`, color: 'var(--color-accent-700)' }] : []),
  ];

  const tiles = [
    { label: 'Negative stock', count: k.negativeCount, hint: 'data to fix', meta: STATUS_META.Negative },
    { label: 'Low / reorder', count: k.lowCount, hint: 'order now', meta: STATUS_META.Low },
    { label: 'Overstock', count: k.overstockCount, hint: 'cash tied up', meta: STATUS_META.Overstock },
    { label: 'No activity', count: k.noActivityCount, hint: 'dormant · no stock or sales', meta: STATUS_META['No activity'] },
    { label: 'Idle stock', count: k.idleCount, hint: `${fmt(k.idleUnits)} units, no sales`, meta: IDLE_META },
  ];

  const stockBars = [...lines].sort((a, b) => b.stock - a.stock).slice(0, 12).map((l) => ({ name: l.name, value: l.stock }));
  const movers = [...effs].sort((a, b) => b.sold - a.sold).slice(0, 12)
    .map((s) => ({ name: (s.model + ' ' + s.colour).slice(0, 22), value: s.sold }));

  const logByMachine = new Map<string, number>();
  for (const l of prodLog) logByMachine.set(l.machine, (logByMachine.get(l.machine) ?? 0) + l.qty);
  const machineData = (dataset?.machines ?? []).map((m) => ({ name: m.name, total: m.fresh + (logByMachine.get(m.name) ?? 0) }));

  const counts = statusCounts(effs);
  const total = effs.length || 1;
  const seg = STATUS_ORDER.filter((s) => counts[s] > 0).map((s) => ({
    label: s, count: counts[s], color: STATUS_META[s].accent,
    pct: (counts[s] / total) * 100,
  }));

  return (
    <section>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ margin: 0, fontSize: 34 }}>Dashboard</h1>
        <p className="text-muted" style={{ margin: '2px 0 0', fontSize: 14 }}>
          Consolidated from your production file · {fmt(effs.length)} SKUs across {dataset?.lines.length ?? 0} lines
        </p>
      </div>

      <div className="grid-kpi" style={{ marginBottom: 22 }}>
        {kpiCards.map((c) => (
          <Blueprint key={c.label} className="card elev-sm" style={{ gap: 6 }}>
            <span className="card-kicker">{c.label}</span>
            <span className="kpi-value" style={{ color: c.color }}>{c.value}</span>
            <span className="card-meta" style={{ margin: 0 }}>{c.sub}</span>
          </Blueprint>
        ))}
      </div>

      <div className="grid-cards">
        <Blueprint className="card" style={{ gridColumn: '1/-1', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <h4 style={{ margin: 0 }}>Where to look first</h4>
            <button className="btn btn-ghost no-print" onClick={() => setView('alerts')}>See all alerts →</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 }}>
            {tiles.map((t) => (
              <button key={t.label} onClick={() => setView('alerts')}
                style={{ textAlign: 'left', cursor: 'pointer', border: '1px solid var(--color-divider)', background: t.meta.bg, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontFamily: 'var(--font-heading)', fontSize: 28, lineHeight: 1, color: t.meta.fg }}>{t.count}</span>
                <span style={{ fontSize: 12, color: t.meta.fg, fontWeight: 500 }}>{t.label}</span>
                <span style={{ fontSize: 11, color: 'color-mix(in srgb,var(--color-text) 55%,transparent)' }}>{t.hint}</span>
              </button>
            ))}
          </div>
        </Blueprint>

        {orders.length > 0 && (() => {
          const diff = k.totalSold - dispatched;
          const off = k.totalSold > 0 && Math.abs(diff) / k.totalSold > 0.05;
          return (
            <Blueprint className="card" style={{ gridColumn: '1/-1', gap: 10 }}>
              <h4 style={{ margin: 0 }}>Sales cross-check <span className="text-muted" style={{ fontSize: 12, fontWeight: 400 }}>· {period}</span></h4>
              <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
                <div><div className="kpi-value" style={{ fontSize: 26 }}>{fmt(k.totalSold)}</div><span className="card-meta" style={{ margin: 0 }}>Sold — from the sheet</span></div>
                <div><div className="kpi-value" style={{ fontSize: 26 }}>{fmt(dispatched)}</div><span className="card-meta" style={{ margin: 0 }}>Dispatched — from orders this month</span></div>
                <div><div className="kpi-value" style={{ fontSize: 26, color: off ? '#b5852a' : '#4e8055' }}>{diff >= 0 ? '' : '+'}{fmt(Math.abs(diff))}</div><span className="card-meta" style={{ margin: 0 }}>{off ? 'gap to reconcile' : 'reconciles'}</span></div>
              </div>
              <p className="text-muted" style={{ margin: 0, fontSize: 12, lineHeight: 1.5 }}>
                Two independent counts of what left the floor. They line up only once every sale is also recorded as an order — a persistent gap points to sales not entered as orders (or vice-versa).
              </p>
            </Blueprint>
          );
        })()}

        <Blueprint className="card" style={{ gap: 14 }}>
          <h4 style={{ margin: 0 }}>Stock on hand by product line</h4>
          <BarList data={stockBars} max={stockBars[0]?.value ?? 1} />
        </Blueprint>

        <Blueprint className="card" style={{ gap: 14 }}>
          <h4 style={{ margin: 0 }}>Fastest moving this period</h4>
          <BarList data={movers} max={movers[0]?.value ?? 1} fill="var(--color-accent-700)" labelWidth={150} />
        </Blueprint>

        <Blueprint className="card" style={{ gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
            <h4 style={{ margin: 0 }}>Machine output</h4>
            <span className="text-muted" style={{ fontSize: 11 }}>fresh pieces logged</span>
          </div>
          <div style={{ height: 170 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={machineData} margin={{ top: 18, right: 0, bottom: 0, left: 0 }}>
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--color-accent)' }} axisLine={false} tickLine={false} />
                <YAxis hide />
                <Bar dataKey="total" isAnimationActive>
                  <LabelList dataKey="total" position="top" formatter={(v: number) => fmt(v)} style={{ fontSize: 11, fill: 'var(--color-text)' }} />
                  {machineData.map((_, i) => <Cell key={i} fill="var(--color-accent)" />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          {machineFresh > 0 && (() => {
            const gap = machineFresh - k.totalProduced;
            const off = k.totalProduced > 0 && Math.abs(gap) / k.totalProduced > 0.1;
            return (
              <div style={{ borderTop: '1px solid var(--color-divider)', paddingTop: 10, fontSize: 12, lineHeight: 1.5 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="text-muted">Machine sheet total</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(machineFresh)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="text-muted">Produced (stock movement)</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(k.totalProduced)}</span>
                </div>
                <p style={{ margin: '6px 0 0', color: off ? '#b5852a' : 'var(--color-neutral-600)' }}>
                  {off
                    ? `⚠ These differ by ${fmt(Math.abs(gap))}. The machine tabs contain subtotal rows and a Day/Night split, so treat the stock-movement figure as the reliable one.`
                    : 'These reconcile — good.'}
                </p>
              </div>
            );
          })()}
        </Blueprint>

        <Blueprint className="card" style={{ gap: 14 }}>
          <h4 style={{ margin: 0 }}>Status of every SKU</h4>
          <div style={{ display: 'flex', height: 22, width: '100%', overflow: 'hidden', border: '1px solid var(--color-divider)' }}>
            {seg.map((s) => <div key={s.label} className="barfill" style={{ width: `${s.pct}%`, background: s.color }} title={s.label} />)}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 2 }}>
            {seg.map((s) => (
              <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <span style={{ width: 11, height: 11, flex: 'none', background: s.color }} />
                <span style={{ flex: 1 }}>{s.label}</span>
                <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{s.count}</span>
                <span className="text-muted" style={{ width: 44, textAlign: 'right' }}>{Math.round(s.pct)}%</span>
              </div>
            ))}
          </div>
        </Blueprint>
      </div>
    </section>
  );
}
