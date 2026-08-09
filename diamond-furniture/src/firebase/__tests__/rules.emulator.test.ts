import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest';
import {
  initializeTestEnvironment, assertSucceeds, assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, deleteDoc } from 'firebase/firestore';
import { readFileSync } from 'node:fs';

/**
 * Firestore security-rules tests. Run with `npm run test:rules` (starts the
 * Firestore emulator; requires Java). Guards the role model — especially the
 * regression where a bare request.auth.token.role threw for users without a
 * custom claim and denied EVERY write.
 */
let env: RulesTestEnvironment;

const OWNER = 'owner-uid';       // users doc role=owner, NO custom claim (the fixed path)
const MANAGER = 'manager-uid';   // users doc role=manager
const VIEWER = 'viewer-uid';     // users doc role=viewer
const NOPROFILE = 'noprofile';   // no users doc, no claim → must default to viewer

const sku = (uid: string) => ({
  uid, line: 'XUV', model: '8002 (Y)', colour: 'B.Gold/Spl',
  opening: 100, sold: 40, closing: 60,
});

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-diamond',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});
afterAll(async () => { await env.cleanup(); });

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users', OWNER), { role: 'owner', email: 'o@x.com' });
    await setDoc(doc(db, 'users', MANAGER), { role: 'manager', email: 'm@x.com' });
    await setDoc(doc(db, 'users', VIEWER), { role: 'viewer', email: 'v@x.com' });
    await setDoc(doc(db, 'skus', 'seed'), sku('seed'));
    await setDoc(doc(db, 'settings', 'app'), { period: 'April 2026' });
  });
});

const as = (uid: string, claims?: object) => env.authenticatedContext(uid, claims).firestore();

describe('SKU writes', () => {
  it('owner (users-doc role, NO claim) can write — the regression that denied everyone', async () => {
    await assertSucceeds(setDoc(doc(as(OWNER), 'skus', 'a'), sku('a')));
  });
  it('owner can bulk-write many SKUs individually', async () => {
    for (let i = 0; i < 20; i++) await assertSucceeds(setDoc(doc(as(OWNER), 'skus', 'b' + i), sku('b' + i)));
  });
  it('owner can delete a SKU (import orphan cleanup)', async () => {
    await assertSucceeds(deleteDoc(doc(as(OWNER), 'skus', 'seed')));
  });
  it('manager can write SKUs', async () => {
    await assertSucceeds(setDoc(doc(as(MANAGER), 'skus', 'c'), sku('c')));
  });
  it('viewer CANNOT write SKUs', async () => {
    await assertFails(setDoc(doc(as(VIEWER), 'skus', 'd'), sku('d')));
  });
  it('user with no profile doc is treated as viewer (denied)', async () => {
    await assertFails(setDoc(doc(as(NOPROFILE), 'skus', 'e'), sku('e')));
  });
  it('a custom claim role=owner also grants writes (claim path)', async () => {
    await assertSucceeds(setDoc(doc(as('claimed', { role: 'owner' }), 'skus', 'f'), sku('f')));
  });
  it('everyone signed in can READ skus', async () => {
    await assertSucceeds(getDoc(doc(as(VIEWER), 'skus', 'seed')));
    await assertSucceeds(getDoc(doc(as(NOPROFILE), 'skus', 'seed')));
  });
});

describe('settings + production log', () => {
  it('manager can write settings; viewer cannot', async () => {
    await assertSucceeds(setDoc(doc(as(MANAGER), 'settings', 'app'), { period: 'May 2026' }));
    await assertFails(setDoc(doc(as(VIEWER), 'settings', 'app'), { period: 'May 2026' }));
  });
  it('editors can append to productionLog; viewer cannot', async () => {
    await assertSucceeds(setDoc(doc(as(OWNER), 'productionLog', 'p1'), { machine: 'M-1', date: '2026-04-01', line: 'XUV', qty: 5 }));
    await assertFails(setDoc(doc(as(VIEWER), 'productionLog', 'p2'), { machine: 'M-1', date: '2026-04-01', line: 'XUV', qty: 5 }));
  });
});

describe('audit trail', () => {
  it('editors can create audit entries', async () => {
    await assertSucceeds(setDoc(doc(as(MANAGER), 'audit', 'x1'), { at: 1, user: 'm', role: 'manager', action: 'edit-sku' }));
  });
  it('ONLY owners can read the audit log', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'audit', 'x2'), { at: 1, user: 'o', role: 'owner', action: 'import' });
    });
    await assertSucceeds(getDoc(doc(as(OWNER), 'audit', 'x2')));
    await assertFails(getDoc(doc(as(MANAGER), 'audit', 'x2')));
    await assertFails(getDoc(doc(as(VIEWER), 'audit', 'x2')));
  });
  it('audit entries cannot be edited or deleted', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'audit', 'x3'), { at: 1, user: 'o', role: 'owner', action: 'import' });
    });
    await assertFails(setDoc(doc(as(OWNER), 'audit', 'x3'), { at: 2 }, { merge: true }));
    await assertFails(deleteDoc(doc(as(OWNER), 'audit', 'x3')));
  });
});

describe('user directory + in-app role management', () => {
  it('a new user can create ONLY their own profile and ONLY as viewer', async () => {
    await assertSucceeds(setDoc(doc(as('newbie'), 'users', 'newbie'), { role: 'viewer', email: 'n@x.com' }));
    await assertFails(setDoc(doc(as('newbie2'), 'users', 'newbie2'), { role: 'owner' })); // no self-promotion
    await assertFails(setDoc(doc(as('newbie3'), 'users', 'someone-else'), { role: 'viewer' })); // not your doc
  });
  it('owners can change a teammate role; non-owners cannot', async () => {
    await assertSucceeds(setDoc(doc(as(OWNER), 'users', VIEWER), { role: 'manager' }, { merge: true }));
    await assertFails(setDoc(doc(as(MANAGER), 'users', VIEWER), { role: 'manager' }, { merge: true }));
  });
  it('an owner cannot demote themselves (no lock-out)', async () => {
    await assertFails(setDoc(doc(as(OWNER), 'users', OWNER), { role: 'viewer' }, { merge: true }));
  });
  it('owners can read any profile; a viewer can read only their own', async () => {
    await assertSucceeds(getDoc(doc(as(OWNER), 'users', VIEWER)));
    await assertSucceeds(getDoc(doc(as(VIEWER), 'users', VIEWER)));
    await assertFails(getDoc(doc(as(VIEWER), 'users', OWNER)));
  });
});
