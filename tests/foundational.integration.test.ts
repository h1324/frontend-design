import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { nextDocNumber } from "../lib/doc-number.js";
import { writeAudit } from "../lib/audit.js";

// DB-backed. Runs only when DATABASE_URL is set (loaded from .env in tests/setup.ts);
// self-skips otherwise so the pure suite still passes on a database-less machine.
const suite = process.env.DATABASE_URL ? describe : describe.skip;

const FY_2026 = new Date("2026-05-15T00:00:00Z"); // → FY 2026-27

suite("foundational schema (integration)", () => {
  let prisma: PrismaClient;
  let companyId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    // Namespaced company per run so counters and audit rows never collide across runs.
    const company = await prisma.company.create({
      data: { name: `Test Co ${Date.now()}` },
    });
    companyId = company.id;
  });

  afterAll(async () => {
    // AuditLog is intentionally append-only (trigger blocks DELETE), so we leave rows
    // behind; the per-run company namespace keeps them out of other runs' way.
    await prisma.$disconnect();
  });

  describe("nextDocNumber", () => {
    it("allocates gapless sequential numbers within one FY", async () => {
      const nums = await prisma.$transaction(async (tx) => [
        await nextDocNumber(tx, companyId, "INVOICE", { prefix: "INV", now: FY_2026 }),
        await nextDocNumber(tx, companyId, "INVOICE", { prefix: "INV", now: FY_2026 }),
        await nextDocNumber(tx, companyId, "INVOICE", { prefix: "INV", now: FY_2026 }),
      ]);
      expect(nums).toEqual([
        "INV/2026-27/000001",
        "INV/2026-27/000002",
        "INV/2026-27/000003",
      ]);
    });

    it("never issues the same number to concurrent allocations", async () => {
      const N = 5;
      const results = await Promise.all(
        Array.from({ length: N }, () =>
          prisma.$transaction((tx) =>
            nextDocNumber(tx, companyId, "DN", { prefix: "DN", now: FY_2026 }),
          ),
        ),
      );
      const seqs = results.map((s) => Number(s.split("/").at(-1))).sort((a, b) => a - b);
      expect(seqs).toEqual([1, 2, 3, 4, 5]); // distinct and contiguous — the row lock held
    });

    it("resets to 1 in a new financial year", async () => {
      const a = await prisma.$transaction((tx) =>
        nextDocNumber(tx, companyId, "FYT", { prefix: "FY", now: FY_2026 }),
      );
      const b = await prisma.$transaction((tx) =>
        nextDocNumber(tx, companyId, "FYT", {
          prefix: "FY",
          now: new Date("2026-01-15T00:00:00Z"), // FY 2025-26
        }),
      );
      expect(a).toBe("FY/2026-27/000001");
      expect(b).toBe("FY/2025-26/000001");
    });
  });

  describe("writeAudit", () => {
    it("captures actor, before, after, and timestamp", async () => {
      const user = await prisma.user.create({
        data: {
          companyId,
          email: `auditor-${Date.now()}@test.local`,
          name: "Auditor",
          passwordHash: "x",
          role: "ADMIN",
        },
      });

      const row = await prisma.$transaction((tx) =>
        writeAudit(tx, {
          companyId,
          entity: "Item",
          entityId: "item-1",
          action: "UPDATE",
          actorUserId: user.id,
          before: { name: "old" },
          after: { name: "new" },
        }),
      );

      expect(row.actorUserId).toBe(user.id);
      expect(row.beforeJson).toEqual({ name: "old" });
      expect(row.afterJson).toEqual({ name: "new" });
      expect(row.at).toBeInstanceOf(Date);
    });

    it("is append-only: UPDATE and DELETE are rejected by the DB", async () => {
      const row = await prisma.$transaction((tx) =>
        writeAudit(tx, {
          companyId,
          entity: "Item",
          entityId: "item-2",
          action: "CREATE",
          after: { name: "created" },
        }),
      );

      await expect(
        prisma.auditLog.update({ where: { id: row.id }, data: { action: "TAMPER" } }),
      ).rejects.toThrow();
      await expect(prisma.auditLog.delete({ where: { id: row.id } })).rejects.toThrow();
    });
  });
});
