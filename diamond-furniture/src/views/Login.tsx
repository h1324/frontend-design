import { useState } from 'react';
import { Blueprint } from '../components/Blueprint';
import type { FirebaseAuthState } from '../firebase/auth';

/** Sign-in / create-account screen (Firebase mode only). */
export function Login({ auth }: { auth: FirebaseAuthState }) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const isSignup = mode === 'signup';

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isSignup) auth.signUpEmail(email, password, name);
    else auth.signInEmail(email, password);
  };

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 20, background: 'var(--color-bg)' }}>
      <Blueprint className="card" style={{ width: 'min(380px,100%)', gap: 16, padding: 28 }}>
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1, gap: 4 }}>
          <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 24 }}>Diamond Furniture</span>
          <span style={{ fontSize: 10, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--color-accent)' }}>Inventory Control</span>
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          <button className={`btn ${!isSignup ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMode('signin')} style={{ flex: 1 }}>Sign in</button>
          <button className={`btn ${isSignup ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMode('signup')} style={{ flex: 1 }}>Create account</button>
        </div>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {isSignup && (
            <div className="field" style={{ margin: 0 }}>
              <label>Your name</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </div>
          )}
          <div className="field" style={{ margin: 0 }}>
            <label>Email</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Password</label>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={isSignup ? 'new-password' : 'current-password'} />
          </div>
          {auth.error && <div style={{ fontSize: 12.5, color: '#a63a3a' }}>{auth.error}</div>}
          <button className="btn btn-primary btn-block" type="submit">{isSignup ? 'Create account' : 'Sign in'}</button>
        </form>

        <button className="btn btn-secondary" onClick={() => auth.signInGoogle()}>Continue with Google</button>

        <p className="text-muted" style={{ margin: 0, fontSize: 11.5, lineHeight: 1.5 }}>
          {isSignup
            ? 'New accounts start as view-only. An owner grants edit access from the Team page.'
            : 'Your role (owner / manager / viewer) is set by an owner and enforced by the server.'}
        </p>
      </Blueprint>
    </div>
  );
}
