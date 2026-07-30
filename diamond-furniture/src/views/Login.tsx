import { useState } from 'react';
import { Blueprint } from '../components/Blueprint';
import type { FirebaseAuthState } from '../firebase/auth';

/** Sign-in screen (Firebase mode only). */
export function Login({ auth }: { auth: FirebaseAuthState }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 20, background: 'var(--color-bg)' }}>
      <Blueprint className="card" style={{ width: 'min(380px,100%)', gap: 16, padding: 28 }}>
        <div className="nav-brand" style={{ display: 'flex', flexDirection: 'column', lineHeight: 1, gap: 4 }}>
          <span style={{ fontSize: 22 }}>DIAMOND FURNITURE</span>
          <span style={{ fontSize: 10, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--color-accent)' }}>Inventory Control</span>
        </div>
        <form
          onSubmit={(e) => { e.preventDefault(); auth.signInEmail(email, password); }}
          style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
        >
          <div className="field" style={{ margin: 0 }}>
            <label>Email</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Password</label>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </div>
          {auth.error && <div style={{ fontSize: 12.5, color: '#a63a3a' }}>{auth.error}</div>}
          <button className="btn btn-primary btn-block" type="submit">Sign in</button>
        </form>
        <button className="btn btn-secondary" onClick={() => auth.signInGoogle()}>Continue with Google</button>
        <p className="text-muted" style={{ margin: 0, fontSize: 11.5, lineHeight: 1.5 }}>
          Your role (owner / manager / viewer) is assigned by an administrator and enforced by the server.
        </p>
      </Blueprint>
    </div>
  );
}
