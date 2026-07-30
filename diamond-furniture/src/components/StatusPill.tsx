import type { Status } from '../domain/types';
import { STATUS_META } from '../domain/status';

export function StatusPill({ status }: { status: Status }) {
  const m = STATUS_META[status];
  return (
    <span className="status-pill" style={{ background: m.bg, color: m.fg }}>
      {status}
    </span>
  );
}
