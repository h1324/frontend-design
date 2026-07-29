import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import {
  createUser,
  setUserRole,
  setUserActive,
  verifyCredentials,
} from "../lib/users.js";
import { AuthzError, type Actor } from "../lib/rbac.js";

const suite = process.env.DATABASE_URL ? describe : describe.skip;

suite("user administration (integration)", () => {
  let prisma: PrismaClient;
  let companyId: string;
  let admin: Actor;

  beforeAll(async () => {
    prisma = new PrismaClient();
    const company = await prisma.company.create({
      data: { name: `Auth Co ${Date.now()}` },
    });
    companyId = company.id;
    const adminUser = await prisma.user.create({
      data: {
        companyId,
        email: `admin-${Date.now()}@test.local`,
        name: "Root",
        passwordHash: await bcrypt.hash("irrelevant", 10),
        role: "ADMIN",
      },
    });
    admin = { userId: adminUser.id, companyId, role: "ADMIN" };
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const uniqueEmail = (p: string) => `${p}-${crypto.randomUUID()}@test.local`;

  describe("createUser", () => {
    it("admin creates a user with a hashed password and an audit row", async () => {
      const email = uniqueEmail("new");
      const user = await prisma.$transaction((tx) =>
        createUser(tx, admin, {
          email,
          name: "New Person",
          password: "secret-123",
          role: "SALES",
        }),
      );

      expect(user.role).toBe("SALES");
      // password is hashed, never stored in plaintext
      expect(user.passwordHash).not.toBe("secret-123");
      expect(await bcrypt.compare("secret-123", user.passwordHash)).toBe(true);

      const audit = await prisma.auditLog.findFirst({
        where: { entity: "User", entityId: user.id, action: "CREATE" },
      });
      expect(audit).not.toBeNull();
      expect(audit?.actorUserId).toBe(admin.userId);
    });

    it("a non-admin actor is denied (AuthzError), and no user is created", async () => {
      const sales: Actor = { userId: "someone", companyId, role: "SALES" };
      const email = uniqueEmail("denied");
      await expect(
        prisma.$transaction((tx) =>
          createUser(tx, sales, {
            email,
            name: "Nope",
            password: "secret-123",
            role: "VIEWER",
          }),
        ),
      ).rejects.toBeInstanceOf(AuthzError);
      expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
    });
  });

  describe("setUserRole / setUserActive", () => {
    it("records a role change with before→after in the audit log", async () => {
      const target = await prisma.$transaction((tx) =>
        createUser(tx, admin, {
          email: uniqueEmail("role"),
          name: "Mover",
          password: "secret-123",
          role: "VIEWER",
        }),
      );
      await prisma.$transaction((tx) => setUserRole(tx, admin, target.id, "DISPATCH"));

      const updated = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
      expect(updated.role).toBe("DISPATCH");
      const audit = await prisma.auditLog.findFirst({
        where: { entity: "User", entityId: target.id, action: "ROLE_CHANGE" },
      });
      expect(audit?.beforeJson).toEqual({ role: "VIEWER" });
      expect(audit?.afterJson).toEqual({ role: "DISPATCH" });
    });

    it("deactivates rather than deletes, and audits it", async () => {
      const target = await prisma.$transaction((tx) =>
        createUser(tx, admin, {
          email: uniqueEmail("deact"),
          name: "Leaver",
          password: "secret-123",
          role: "VIEWER",
        }),
      );
      await prisma.$transaction((tx) => setUserActive(tx, admin, target.id, false));

      const updated = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
      expect(updated.isActive).toBe(false); // row still exists, just inactive
      const audit = await prisma.auditLog.findFirst({
        where: { entity: "User", entityId: target.id, action: "DEACTIVATE" },
      });
      expect(audit).not.toBeNull();
    });
  });

  describe("verifyCredentials", () => {
    it("accepts the right password, rejects the wrong one, and stamps lastLoginAt", async () => {
      const email = uniqueEmail("login");
      const user = await prisma.$transaction((tx) =>
        createUser(tx, admin, {
          email,
          name: "Logger",
          password: "correct-horse",
          role: "STORES",
        }),
      );

      expect(await verifyCredentials(prisma, email, "wrong-password")).toBeNull();

      const ok = await verifyCredentials(prisma, email, "correct-horse");
      expect(ok?.id).toBe(user.id);
      expect(ok?.role).toBe("STORES");

      const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(after.lastLoginAt).not.toBeNull();
    });

    it("rejects an inactive user even with the right password", async () => {
      const email = uniqueEmail("inactive");
      const user = await prisma.$transaction((tx) =>
        createUser(tx, admin, {
          email,
          name: "Gone",
          password: "correct-horse",
          role: "VIEWER",
        }),
      );
      await prisma.$transaction((tx) => setUserActive(tx, admin, user.id, false));
      expect(await verifyCredentials(prisma, email, "correct-horse")).toBeNull();
    });
  });
});
