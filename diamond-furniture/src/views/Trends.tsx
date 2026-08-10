import { useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid,
} from 'recharts';
import { Blueprint } from '../components/Blueprint';
import { useApp } from '../store/store';
import { fmt } from '../domain/format';
import { periodTotals, lineTrend } from '../domain/logic';
import { periodLabel } from '../domain/period';

const AXIS = { fontSize: 11, fill: 'var(--color-neutral-600)' };
const grid = 'color-mix(in srgb, var(--color-text) 8%, transparent)';

function shortLabel(key: string): string {
  return periodLabel(key).replace(/ \d{2}(\d{2})$/, " '$1"); // "April 2026" → "April '26"
}

export function Trends() {
  const { periods, catalog, financialYearLabel } = useApp();
  const lines = [...new Set(catalog.map((c) => c.line))].sort((a, b) => a.localeCompare(b));
  const [line, setLine] = useState(lines[0] ?? '');

  const totals = periodTotals(periods).map((t) => ({ ...t, name: shortLabel(t.key) }));
  const perLine = line ? lineTrend(catalog, periods, line).map((t) => ({ ...t, name: shortLabel(t.key) })) : [];

  if (periods.length < 2) {
    return (
      <section>
        <h1 style={{ margin: 0, fontSize: 34 }}>Trends</h1>
        <p className="text-muted" style={{ margin: '2px 0 0', fontSize: 14 }}>
          Month-over-month charts appear once you have <strong>two or more months</strong> imported.
          You currently have {periods.length}. Import next month's file to start building history.
        </p>
      </section>
    );
  }

  const tooltip = {
    contentStyle: { background: 'var(--color-bg)', border: '1px solid var(--color-divider)', borderRadius: 0, fontSize: 12 },
    formatter: (v: number) => fmt(v),
  };

  return (
    <section>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 34 }}>Trends</h1>
        <p className="text-muted" style={{ margin: '2px 0 0', fontSize: 14 }}>
          {periods.length} months on file · financial year {financialYearLabel}
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(340px,1fr))', gap: 18, alignItems: 'start' }}>
        <Blueprint className="card" style={{ gap: 12 }}>
          <h4 style={{ margin: 0 }}>Sales & production by month</h4>
          <div style={{ height: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={totals} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={grid} vertical={false} />
                <XAxis dataKey="name" tick={AXIS} axisLine={false} tickLine={false} />
                <YAxis tick={AXIS} axisLine={false} tickLine={false} width={48} tickFormatter={(v) => fmt(v)} />
                <Tooltip {...tooltip} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="sold" name="Sold" stroke="var(--color-accent)" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="fresh" name="Fresh produced" stroke="var(--color-accent-700)" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Blueprint>

        <Blueprint className="card" style={{ gap: 12 }}>
          <h4 style={{ margin: 0 }}>Stock on hand by month</h4>
          <div style={{ height: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={totals} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={grid} vertical={false} />
                <XAxis dataKey="name" tick={AXIS} axisLine={false} tickLine={false} />
                <YAxis tick={AXIS} axisLine={false} tickLine={false} width={48} tickFormatter={(v) => fmt(v)} />
                <Tooltip {...tooltip} />
                <Line type="monotone" dataKey="stock" name="Units in stock" stroke="var(--color-accent)" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Blueprint>

        <Blueprint className="card" style={{ gap: 12, gridColumn: '1/-1' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            <h4 style={{ margin: 0 }}>By product line</h4>
            <div className="field" style={{ margin: 0, minWidth: 200 }}>
              <label>Product line</label>
              <select className="input" value={line} onChange={(e) => setLine(e.target.value)}>
                {lines.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
          </div>
          <div style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={perLine} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={grid} vertical={false} />
                <XAxis dataKey="name" tick={AXIS} axisLine={false} tickLine={false} />
                <YAxis tick={AXIS} axisLine={false} tickLine={false} width={48} tickFormatter={(v) => fmt(v)} />
                <Tooltip {...tooltip} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="sold" name="Sold" stroke="var(--color-accent)" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="stock" name="Stock" stroke="var(--color-accent-700)" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Blueprint>
      </div>
    </section>
  );
}
