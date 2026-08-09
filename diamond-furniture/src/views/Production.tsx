import { Blueprint } from '../components/Blueprint';
import { BarList } from '../components/BarList';
import { useApp } from '../store/store';
import { fmt } from '../domain/format';
import { lineSummaries } from '../domain/logic';

export function Production({ onLog }: { onLog: () => void }) {
  const { effs, dataset, prodLog, canEdit } = useApp();

  const logByMachine = new Map<string, number>();
  for (const l of prodLog) logByMachine.set(l.machine, (logByMachine.get(l.machine) ?? 0) + l.qty);
  const machineCards = (dataset?.machines ?? []).map((m) => ({
    name: m.name, total: m.fresh + (logByMachine.get(m.name) ?? 0), days: m.activeDays,
  }));

  const producedBars = [...lineSummaries(effs)].sort((a, b) => b.produced - a.produced).slice(0, 12)
    .map((l) => ({ name: l.name, value: l.produced }));

  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 34 }}>Production</h1>
          <p className="text-muted" style={{ margin: '2px 0 0', fontSize: 14 }}>Fresh output per machine (M-1…M-7) · light view feeding inventory</p>
        </div>
        <button className="btn btn-primary no-print" onClick={onLog} disabled={!canEdit}>+ Log production</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 14, marginBottom: 20 }}>
        {machineCards.map((m) => (
          <Blueprint key={m.name} className="card elev-sm" style={{ gap: 5 }}>
            <span className="card-kicker">Machine {m.name}</span>
            <span style={{ fontFamily: 'var(--font-heading)', fontSize: 28, lineHeight: 1 }}>{fmt(m.total)}</span>
            <span className="card-meta" style={{ margin: 0 }}>fresh pieces · {m.days} production entries</span>
          </Blueprint>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 18, alignItems: 'start' }}>
        <Blueprint className="card" style={{ gap: 14 }}>
          <h4 style={{ margin: 0 }}>Produced this period, by line</h4>
          <p className="text-muted" style={{ margin: 0, fontSize: 12 }}>Derived from stock movement (closing + sold − opening).</p>
          <BarList data={producedBars} max={producedBars[0]?.value ?? 1} />
        </Blueprint>

        <Blueprint className="card" style={{ gap: 12 }}>
          <h4 style={{ margin: 0 }}>Recently logged</h4>
          {prodLog.length > 0 ? (
            <table className="table"><tbody>
              {prodLog.slice(0, 8).map((l, i) => (
                <tr key={i}>
                  <td style={{ fontSize: 12.5 }}>{l.date}</td>
                  <td><span className="tag tag-accent">{l.machine}</span></td>
                  <td style={{ fontSize: 12.5 }}>{l.line}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmt(l.qty)}</td>
                </tr>
              ))}
            </tbody></table>
          ) : (
            <p className="text-muted" style={{ margin: 0, fontSize: 13 }}>
              No entries logged in this session yet. Use <strong>+ Log production</strong> to add a day's output.
            </p>
          )}
        </Blueprint>
      </div>
    </section>
  );
}
