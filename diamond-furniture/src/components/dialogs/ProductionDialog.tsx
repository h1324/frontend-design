import { useState } from 'react';
import { Blueprint } from '../Blueprint';
import { useApp } from '../../store/store';
import { useToast } from '../Toast';

export function ProductionDialog({ onClose }: { onClose: () => void }) {
  const { dataset, addProduction } = useApp();
  const flash = useToast();
  const machineNames = dataset?.machines.map((m) => m.name) ?? [];
  const lineNames = dataset?.lines ?? [];

  const [machine, setMachine] = useState(machineNames[0] ?? 'M-1');
  const [date, setDate] = useState('2026-04-30');
  const [line, setLine] = useState(lineNames[0] ?? '');
  const [qty, setQty] = useState('');

  const save = async () => {
    const q = Math.round(Number(qty) || 0);
    if (q <= 0) {
      flash('Enter a piece count');
      return;
    }
    await addProduction({ machine, date, line, qty: q });
    flash(`Production logged for ${machine}`);
    onClose();
  };

  return (
    <div className="dialog-backdrop no-print" onClick={onClose}>
      <Blueprint className="dialog" onClick={(e) => e.stopPropagation()}>
        <>
          <div className="dialog-title">Log production</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field" style={{ margin: 0 }}>
              <label>Machine</label>
              <select className="input" value={machine} onChange={(e) => setMachine(e.target.value)}>
                {machineNames.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label>Date</label>
              <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label>Product line</label>
              <select className="input" value={line} onChange={(e) => setLine(e.target.value)}>
                {lineNames.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label>Fresh pieces</label>
              <input className="input" type="number" min={0} value={qty} onChange={(e) => setQty(e.target.value)} />
            </div>
          </div>
          <div className="dialog-actions">
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={save}>Add entry</button>
          </div>
        </>
      </Blueprint>
    </div>
  );
}
