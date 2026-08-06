import { collection, doc, getDoc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from './config';
import type { Role } from '../store/types';

export interface TeamUser {
  uid: string;
  email: string;
  name: string;
  role: Role;
}

/**
 * Ensure a signed-in user has a directory/profile doc. New users (incl. Google
 * sign-in) get a `viewer` doc so they show up in the owner's Team list and can
 * be promoted. Existing docs are left untouched (role is owner-managed).
 */
export async function ensureProfile(uid: string, email: string, name: string): Promise<void> {
  if (!db) return;
  const ref = doc(db, 'users', uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, { role: 'viewer', email, name });
  }
}

/** Live list of all users. Only owners can read the whole collection (see rules). */
export function subscribeUsers(cb: (users: TeamUser[]) => void): () => void {
  if (!db) return () => {};
  return onSnapshot(collection(db, 'users'), (snap) => {
    const users = snap.docs
      .map((d) => {
        const data = d.data();
        return {
          uid: d.id,
          email: (data.email as string) ?? '',
          name: (data.name as string) ?? '',
          role: ((data.role as Role) ?? 'viewer'),
        };
      })
      .sort((a, b) => (a.email || a.uid).localeCompare(b.email || b.uid));
    cb(users);
  });
}

/** Owner-only: change a teammate's role. Enforced in firestore.rules. */
export async function setUserRole(uid: string, role: Role): Promise<void> {
  if (!db) return;
  await setDoc(doc(db, 'users', uid), { role }, { merge: true });
}
