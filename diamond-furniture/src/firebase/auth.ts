import { useEffect, useState } from 'react';
import {
  GoogleAuthProvider, signInWithEmailAndPassword, signInWithPopup, signOut,
  onAuthStateChanged, type User,
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from './config';
import type { Identity, Role } from '../store/types';
import type { Role as DomainRole } from '../domain/types';

const ROLES: DomainRole[] = ['owner', 'manager', 'viewer'];
const asRole = (v: unknown): Role => (ROLES.includes(v as DomainRole) ? (v as Role) : 'viewer');

/**
 * Resolve a user's role. Custom claims are the source of truth (set server-side
 * so they can't be spoofed by the client and can be enforced in security rules);
 * a users/{uid} doc is the fallback for projects not yet using claims.
 */
async function resolveRole(user: User): Promise<Role> {
  try {
    const token = await user.getIdTokenResult();
    if (token.claims.role) return asRole(token.claims.role);
  } catch {
    /* ignore */
  }
  if (db) {
    try {
      const snap = await getDoc(doc(db, 'users', user.uid));
      if (snap.exists()) return asRole(snap.data().role);
    } catch {
      /* ignore */
    }
  }
  return 'viewer';
}

export type AuthStatus = 'loading' | 'signed-out' | 'signed-in';

export interface FirebaseAuthState {
  status: AuthStatus;
  identity: Identity | null;
  error: string;
  signInEmail: (email: string, password: string) => Promise<void>;
  signInGoogle: () => Promise<void>;
  signOutUser: () => Promise<void>;
}

export function useFirebaseAuth(): FirebaseAuthState {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!auth) {
      setStatus('signed-out');
      return;
    }
    return onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setIdentity(null);
        setStatus('signed-out');
        return;
      }
      const role = await resolveRole(user);
      setIdentity({ uid: user.uid, name: user.displayName || user.email || 'User', role });
      setStatus('signed-in');
    });
  }, []);

  const wrap = (fn: () => Promise<unknown>) => async () => {
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed');
    }
  };

  return {
    status,
    identity,
    error,
    signInEmail: (email, password) => wrap(() => signInWithEmailAndPassword(auth!, email, password))(),
    signInGoogle: wrap(() => signInWithPopup(auth!, new GoogleAuthProvider())),
    signOutUser: wrap(() => signOut(auth!)),
  };
}
