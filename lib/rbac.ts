// lib/rbac.ts — role-based authorization (spec S4). Pure and server-authoritative:
// every protected route handler and server action checks this; UI hiding is cosmetic.

import type { Role } from "@prisma/client";
import type { Session } from "next-auth";

export type Area =
  "MASTERS" | "PRODUCTION" | "STORES" | "SALES" | "DISPATCH" | "COSTING" | "USER_ADMIN";

export type Access = "NONE" | "R" | "RW";
export type Action = "read" | "write";

/** The default role → area access matrix (spec S4). Individual module specs may refine,
 *  but never widen a role beyond what its area grants here without an explicit change. */
export const ACCESS_MATRIX: Record<Role, Record<Area, Access>> = {
  ADMIN: {
    MASTERS: "RW",
    PRODUCTION: "RW",
    STORES: "RW",
    SALES: "RW",
    DISPATCH: "RW",
    COSTING: "RW",
    USER_ADMIN: "RW",
  },
  PRODUCTION: {
    MASTERS: "R",
    PRODUCTION: "RW",
    STORES: "R",
    SALES: "R",
    DISPATCH: "R",
    COSTING: "R",
    USER_ADMIN: "NONE",
  },
  STORES: {
    MASTERS: "R",
    PRODUCTION: "R",
    STORES: "RW",
    SALES: "R",
    DISPATCH: "R",
    COSTING: "R",
    USER_ADMIN: "NONE",
  },
  SALES: {
    MASTERS: "R",
    PRODUCTION: "R",
    STORES: "R",
    SALES: "RW",
    DISPATCH: "R",
    COSTING: "R",
    USER_ADMIN: "NONE",
  },
  DISPATCH: {
    MASTERS: "R",
    PRODUCTION: "R",
    STORES: "R",
    SALES: "R",
    DISPATCH: "RW",
    COSTING: "R",
    USER_ADMIN: "NONE",
  },
  ACCOUNTS: {
    MASTERS: "R",
    PRODUCTION: "R",
    STORES: "R",
    SALES: "R",
    DISPATCH: "RW",
    COSTING: "RW",
    USER_ADMIN: "NONE",
  },
  VIEWER: {
    MASTERS: "R",
    PRODUCTION: "R",
    STORES: "R",
    SALES: "R",
    DISPATCH: "R",
    COSTING: "R",
    USER_ADMIN: "NONE",
  },
};

/** Raised when an actor lacks the required access. Callers map it to a 403. */
export class AuthzError extends Error {
  override name = "AuthzError";
}

/** The authenticated subject of a request. */
export interface Actor {
  userId: string;
  companyId: string;
  role: Role;
}

/** True if `role` may perform `action` in `area`. */
export function can(role: Role, area: Area, action: Action): boolean {
  const access = ACCESS_MATRIX[role][area];
  return action === "read" ? access === "R" || access === "RW" : access === "RW";
}

/** Derive an Actor from a session, or throw if unauthenticated. */
export function requireActor(session: Session | null): Actor {
  const user = session?.user;
  if (!user?.id) throw new AuthzError("not authenticated");
  return { userId: user.id, companyId: user.companyId, role: user.role };
}

/** Throw AuthzError unless the actor has `action` access to `area`. */
export function requireAccess(actor: Actor, area: Area, action: Action): void {
  if (!can(actor.role, area, action)) {
    throw new AuthzError(`${actor.role} is not permitted to ${action} ${area}`);
  }
}

/** Throw AuthzError unless the actor holds one of the given roles. */
export function requireRole(actor: Actor, ...roles: Role[]): void {
  if (!roles.includes(actor.role)) {
    throw new AuthzError(`requires role: ${roles.join(", ")}`);
  }
}
