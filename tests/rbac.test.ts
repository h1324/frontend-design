import { describe, it, expect } from "vitest";
import type { Role } from "@prisma/client";
import {
  can,
  requireAccess,
  requireRole,
  requireActor,
  AuthzError,
  type Actor,
} from "../lib/rbac.js";

const ALL_ROLES: Role[] = [
  "ADMIN",
  "PRODUCTION",
  "STORES",
  "SALES",
  "DISPATCH",
  "ACCOUNTS",
  "QC",
  "VIEWER",
];

function actor(role: Role): Actor {
  return { userId: "u1", companyId: "c1", role };
}

describe("can()", () => {
  it("SALES may write SALES but only read MASTERS", () => {
    expect(can("SALES", "SALES", "write")).toBe(true);
    expect(can("SALES", "MASTERS", "read")).toBe(true);
    expect(can("SALES", "MASTERS", "write")).toBe(false);
  });

  it("VIEWER can read every area but write none", () => {
    for (const area of [
      "MASTERS",
      "PRODUCTION",
      "STORES",
      "SALES",
      "DISPATCH",
      "COSTING",
    ] as const) {
      expect(can("VIEWER", area, "read")).toBe(true);
      expect(can("VIEWER", area, "write")).toBe(false);
    }
  });

  it("USER_ADMIN is ADMIN-only, read and write", () => {
    expect(can("ADMIN", "USER_ADMIN", "write")).toBe(true);
    expect(can("ADMIN", "USER_ADMIN", "read")).toBe(true);
    for (const role of ALL_ROLES.filter((r) => r !== "ADMIN")) {
      expect(can(role, "USER_ADMIN", "read")).toBe(false);
      expect(can(role, "USER_ADMIN", "write")).toBe(false);
    }
  });

  it("each operational role writes only its own area", () => {
    expect(can("PRODUCTION", "PRODUCTION", "write")).toBe(true);
    expect(can("PRODUCTION", "STORES", "write")).toBe(false);
    expect(can("STORES", "STORES", "write")).toBe(true);
    // ACCOUNTS writes dispatch/invoice and costing
    expect(can("ACCOUNTS", "DISPATCH", "write")).toBe(true);
    expect(can("ACCOUNTS", "COSTING", "write")).toBe(true);
    expect(can("ACCOUNTS", "SALES", "write")).toBe(false);
    // DISPATCH writes dispatch, not costing
    expect(can("DISPATCH", "DISPATCH", "write")).toBe(true);
    expect(can("DISPATCH", "COSTING", "write")).toBe(false);
    // QC writes QC only; everyone else reads QC but cannot write it
    expect(can("QC", "QC", "write")).toBe(true);
    expect(can("QC", "STORES", "write")).toBe(false);
    expect(can("STORES", "QC", "write")).toBe(false);
    expect(can("ADMIN", "QC", "write")).toBe(true);
    expect(can("VIEWER", "QC", "read")).toBe(true);
  });
});

describe("requireAccess()", () => {
  it("throws AuthzError when denied, is silent when allowed", () => {
    expect(() => requireAccess(actor("SALES"), "MASTERS", "write")).toThrow(AuthzError);
    expect(() => requireAccess(actor("VIEWER"), "PRODUCTION", "write")).toThrow(
      AuthzError,
    );
    expect(() => requireAccess(actor("ADMIN"), "USER_ADMIN", "write")).not.toThrow();
    expect(() => requireAccess(actor("SALES"), "MASTERS", "read")).not.toThrow();
  });
});

describe("requireRole()", () => {
  it("passes only for a listed role", () => {
    expect(() => requireRole(actor("ADMIN"), "ADMIN")).not.toThrow();
    expect(() => requireRole(actor("SALES"), "ADMIN", "ACCOUNTS")).toThrow(AuthzError);
  });
});

describe("requireActor()", () => {
  it("throws when there is no authenticated user", () => {
    expect(() => requireActor(null)).toThrow(AuthzError);
    // @ts-expect-error — partial session missing user
    expect(() => requireActor({})).toThrow(AuthzError);
  });

  it("extracts the actor from a session", () => {
    const a = requireActor({
      user: { id: "u9", companyId: "c9", role: "PRODUCTION", name: "X", email: "x@y.z" },
      expires: "2999-01-01",
    });
    expect(a).toEqual({ userId: "u9", companyId: "c9", role: "PRODUCTION" });
  });
});
