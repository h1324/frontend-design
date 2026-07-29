// lib/users.ts — user administration and credential verification (spec S4).
// Authorization is enforced here (server-side), passwords are hashed, and every change
// writes an audit row. The HTTP layer (server actions) is a thin wrapper over these.

import type { Prisma, Role, User } from "@prisma/client";
import bcrypt from "bcryptjs";
import { AuthzError, requireAccess, type Actor } from "./rbac.js";
import { writeAudit } from "./audit.js";

type Tx = Prisma.TransactionClient;

const BCRYPT_ROUNDS = 12;

export interface CreateUserInput {
  email: string;
  name: string;
  password: string;
  role: Role;
}

/** Public (session-safe) shape returned to the auth layer on a successful login. */
export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  companyId: string;
}

/** Create a user in the actor's company. Admin-only; password is hashed; change audited. */
export async function createUser(
  tx: Tx,
  actor: Actor,
  input: CreateUserInput,
): Promise<User> {
  requireAccess(actor, "USER_ADMIN", "write");
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
  const user = await tx.user.create({
    data: {
      companyId: actor.companyId,
      email: input.email,
      name: input.name,
      passwordHash,
      role: input.role,
    },
  });
  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "User",
    entityId: user.id,
    action: "CREATE",
    actorUserId: actor.userId,
    after: { email: user.email, name: user.name, role: user.role },
  });
  return user;
}

async function loadInCompany(tx: Tx, actor: Actor, userId: string): Promise<User> {
  const user = await tx.user.findFirst({
    where: { id: userId, companyId: actor.companyId },
  });
  if (!user) throw new AuthzError("user not found");
  return user;
}

/** Change a user's role (admin-only; audited before→after). */
export async function setUserRole(
  tx: Tx,
  actor: Actor,
  userId: string,
  role: Role,
): Promise<User> {
  requireAccess(actor, "USER_ADMIN", "write");
  const before = await loadInCompany(tx, actor, userId);
  const user = await tx.user.update({ where: { id: userId }, data: { role } });
  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "User",
    entityId: userId,
    action: "ROLE_CHANGE",
    actorUserId: actor.userId,
    before: { role: before.role },
    after: { role },
  });
  return user;
}

/** Activate or deactivate a user (admin-only; audited). Users are deactivated, never
 *  deleted, to preserve referential integrity with audit/actor rows (spec S4 rule 5). */
export async function setUserActive(
  tx: Tx,
  actor: Actor,
  userId: string,
  isActive: boolean,
): Promise<User> {
  requireAccess(actor, "USER_ADMIN", "write");
  const before = await loadInCompany(tx, actor, userId);
  const user = await tx.user.update({ where: { id: userId }, data: { isActive } });
  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "User",
    entityId: userId,
    action: isActive ? "ACTIVATE" : "DEACTIVATE",
    actorUserId: actor.userId,
    before: { isActive: before.isActive },
    after: { isActive },
  });
  return user;
}

/**
 * Verify login credentials for the auth layer. Returns the session-safe user on success
 * (and stamps lastLoginAt), or null for unknown/inactive users or a bad password —
 * never distinguishing which, to avoid leaking account existence.
 */
export async function verifyCredentials(
  db: Tx,
  email: string,
  password: string,
): Promise<AuthenticatedUser | null> {
  const user = await db.user.findUnique({ where: { email } });
  if (!user || !user.isActive) return null;
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return null;
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    companyId: user.companyId,
  };
}
