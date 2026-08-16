import { Blueprint } from '../components/Blueprint';
import { useApp } from '../store/store';
import type { AuditEntry } from '../store/types';

const ACTION_LABEL: Record<AuditEntry['action'], string> = {
  'edit-sku': 'Edited SKU',
  'record-sale': 'Recorded sale',
  'log-production': 'Logged production',
  'set-threshold': 'Changed threshold',
  import: 'Imported data',
  'scrub-year': 'Started new financial year',
  'create-order': 'Created order',
  'fulfil-order': 'Dispatched order',
  'cancel-order': 'Cancelled order',
  'set-fy-opening': 'Set FY opening stock',
};

function when(ts: number): string {
  const d = new Date(ts);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()} ${hh}:${mi}`;
}

/** Owner-only audit trail: who changed what, and when. */
export function Activity() {
  const { audit } = useApp();
  return (
    <section>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 34 }}>Activity log</h1>
        <p className="text-muted" style={{ margin: '2px 0 0', fontSize: 14 }}>
          Every stock edit, sale, production entry, threshold change and import — who did it and when. Owner-only.
        </p>
      </div>

      <Blueprint className="card" style={{ padding: 0, overflow: 'auto' }}>
        <table className="table" style={{ minWidth: 720 }}>
          <thead>
            <tr>
              <th>When</th><th>User</th><th>Role</th><th>Action</th><th>Target</th><th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {audit.length === 0 ? (
              <tr><td colSpan={6} className="text-muted" style={{ padding: 16 }}>No activity recorded yet.</td></tr>
            ) : (
              audit.map((a) => (
                <tr key={a.id}>
                  <td style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', fontSize: 12.5 }}>{when(a.at)}</td>
                  <td style={{ fontWeight: 500 }}>{a.user}</td>
                  <td><span className="tag tag-neutral">{a.role}</span></td>
                  <td>{ACTION_LABEL[a.action]}</td>
                  <td style={{ fontSize: 12.5, color: 'var(--color-neutral-700)' }}>{a.target ?? '—'}</td>
                  <td style={{ fontSize: 12.5 }}>{a.detail ?? '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Blueprint>
    </section>
  );
}
