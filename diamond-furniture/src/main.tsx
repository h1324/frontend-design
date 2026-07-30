import { StrictMode, useMemo } from 'react';
import { createRoot } from 'react-dom/client';

import '@fontsource/barlow/400.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow/600.css';
import '@fontsource/barlow-condensed/600.css';
import './styles/tokens.css';
import './styles/app.css';

import { App } from './App';
import { ToastProvider } from './components/Toast';
import { AppProvider } from './store/store';
import { firebaseEnabled } from './firebase/config';
import { DemoRepo } from './firebase/repoDemo';
import { FirebaseRepo } from './firebase/repoFirebase';
import { useFirebaseAuth } from './firebase/auth';
import { Login } from './views/Login';

/** Firebase mode: gate on sign-in, then run against Firestore. */
function FirebaseRoot() {
  const auth = useFirebaseAuth();
  const repo = useMemo(() => (auth.identity ? new FirebaseRepo(auth.identity) : null), [auth.identity]);

  if (auth.status === 'loading') {
    return <div style={{ padding: 80, textAlign: 'center', color: 'var(--color-neutral-600)' }}>Connecting…</div>;
  }
  if (auth.status === 'signed-out' || !repo || !auth.identity) {
    return <Login auth={auth} />;
  }
  return (
    <ToastProvider>
      <AppProvider repo={repo} mode="firebase" identity={auth.identity}>
        <App onSignOut={auth.signOutUser} />
      </AppProvider>
    </ToastProvider>
  );
}

/** Demo mode: local data + localStorage, no sign-in required. */
function DemoRoot() {
  const repo = useMemo(() => new DemoRepo(), []);
  return (
    <ToastProvider>
      <AppProvider repo={repo} mode="demo" identity={null}>
        <App />
      </AppProvider>
    </ToastProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>{firebaseEnabled ? <FirebaseRoot /> : <DemoRoot />}</StrictMode>,
);
