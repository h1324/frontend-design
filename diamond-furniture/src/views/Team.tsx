import { useEffect, useState } from 'react';
import { Blueprint } from '../components/Blueprint';
import { useApp } from '../store/store';
import { useToast } from '../components/Toast';
import { subscribeUsers, setUserRole, type TeamUser } from '../firebase/users';
import type { Role } from '../domain/types';

const ROLES: Role[] = ['owner', 'manager', 'viewer'];
const ROLE_HINT: Record<Role, string> = {
  owner: 'Full control + team & activity',
  manager: 'Can edit, import, log production',
  viewer: 'Read-only',
};

/** Owner-only teammate & role management (Firebase mode). */
export function Team() {
  const { uid } = useApp();
  const flash = useToast();
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = subscribeUsers((u) => { setUsers(u); setLoading(false); });
    return unsub;
  }, []);

  const change = async (u: TeamUser, role: Role) => {
    try {
      await setUserRole(u.uid, role);
      flash(`${u.email || u.name || 'User'} is now ${role}`);
    } catch {
      flash('Could not change role (owner only)');
    }
  };

  return (
    <section>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 34 }}>Team</h1>
        <p className="text-muted" style={{ margin: '2px 0 0', fontSize: 14 }}>
          People with access. Set each person's role here — no Firebase console needed.
          New sign-ups start as <strong>viewer</strong> until you promote them.
        </p>
      </div>

      <Blueprint className="card" style={{ padding: 0, overflow: 'auto' }}>
        <table className="table" style={{ minWidth: 640 }}>
          <thead>
            <tr><th>Name</th><th>Email</th><th>Role</th><th>Access</th></tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="text-muted" style={{ padding: 16 }}>Loading team…</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={4} className="text-muted" style={{ padding: 16 }}>No users yet.</td></tr>
            ) : (
              users.map((u) => {
                const isSelf = u.uid === uid;
                return (
                  <tr key={u.uid}>
                    <td style={{ fontWeight: 500 }}>{u.name || '—'}{isSelf && <span className="text-muted"> (you)</span>}</td>
                    <td style={{ fontSize: 12.5 }}>{u.email || '—'}</td>
                    <td>
                      <select
                        className="input" value={u.role} disabled={isSelf}
                        onChange={(e) => change(u, e.target.value as Role)}
                        style={{ minHeight: 32, padding: '2px 8px', fontSize: 13, minWidth: 130 }}
                        title={isSelf ? "You can't change your own role" : undefined}
                      >
                        {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </td>
                    <td className="text-muted" style={{ fontSize: 12 }}>{ROLE_HINT[u.role]}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </Blueprint>

      <p className="text-muted" style={{ fontSize: 12, marginTop: 12, maxWidth: 640 }}>
        A teammate sees their new permissions the next time they open or refresh the app.
        You can't change your own role here (so the last owner can't be locked out).
      </p>
    </section>
  );
}
