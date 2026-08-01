import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient, type DowntimeCategory } from "@prisma/client";
import {
  createMachine,
  updateMachine,
  setMachineActive,
  createShift,
  createDowntimeReason,
  ProductionMasterValidationError,
} from "../lib/production-masters.js";
import { AuthzError, type Actor } from "../lib/rbac.js";

const suite = process.env.DATABASE_URL ? describe : describe.skip;

suite("production masters (integration)", () => {
  let prisma: PrismaClient;
  let admin: Actor;
  let sales: Actor;

  beforeAll(async () => {
    prisma = new PrismaClient();
    const company = await prisma.company.create({
      data: { name: `Prod Co ${Date.now()}` },
    });
    const adminUser = await prisma.user.create({
      data: {
        companyId: company.id,
        email: `a-${Date.now()}@t.local`,
        name: "A",
        passwordHash: "x",
        role: "ADMIN",
      },
    });
    const salesUser = await prisma.user.create({
      data: {
        companyId: company.id,
        email: `s-${Date.now()}@t.local`,
        name: "S",
        passwordHash: "x",
        role: "SALES",
      },
    });
    admin = { userId: adminUser.id, companyId: company.id, role: "ADMIN" };
    sales = { userId: salesUser.id, companyId: company.id, role: "SALES" };
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const code = (p: string) => `${p}-${crypto.randomUUID().slice(0, 8)}`;

  it("admin creates a machine (audited); update and deactivate work", async () => {
    const c = code("M");
    const machine = await prisma.$transaction((tx) =>
      createMachine(tx, admin, { code: c, name: "FLY-250", ratedCapacityKgHr: "120" }),
    );
    expect(machine.ratedCapacityKgHr?.toString()).toBe("120");
    expect(
      await prisma.auditLog.findFirst({
        where: { entity: "Machine", entityId: machine.id, action: "CREATE" },
      }),
    ).not.toBeNull();

    await prisma.$transaction((tx) =>
      updateMachine(tx, admin, machine.id, { name: "FLY-250 (renamed)" }),
    );
    expect(
      (await prisma.machine.findUniqueOrThrow({ where: { id: machine.id } })).name,
    ).toBe("FLY-250 (renamed)");

    await prisma.$transaction((tx) => setMachineActive(tx, admin, machine.id, false));
    expect(
      (await prisma.machine.findUniqueOrThrow({ where: { id: machine.id } })).isActive,
    ).toBe(false);
  });

  it("denies a non-admin (SALES); nothing is written", async () => {
    const c = code("M");
    await expect(
      prisma.$transaction((tx) => createMachine(tx, sales, { code: c, name: "X" })),
    ).rejects.toBeInstanceOf(AuthzError);
    expect(
      await prisma.machine.findFirst({ where: { companyId: sales.companyId, code: c } }),
    ).toBeNull();
  });

  it("rejects a bad shift time and a bad downtime category", async () => {
    await expect(
      prisma.$transaction((tx) =>
        createShift(tx, admin, {
          code: code("S"),
          name: "Bad",
          startTime: "8am",
          endTime: "16:00",
        }),
      ),
    ).rejects.toBeInstanceOf(ProductionMasterValidationError);

    const badCategory = "NOPE" as unknown as DowntimeCategory;
    await expect(
      prisma.$transaction((tx) =>
        createDowntimeReason(tx, admin, {
          code: code("D"),
          description: "x",
          category: badCategory,
        }),
      ),
    ).rejects.toBeInstanceOf(ProductionMasterValidationError);
  });

  it("creates a valid shift and downtime reason", async () => {
    const shift = await prisma.$transaction((tx) =>
      createShift(tx, admin, {
        code: code("S"),
        name: "A",
        startTime: "08:00",
        endTime: "16:00",
      }),
    );
    expect(shift.startTime).toBe("08:00");

    const reason = await prisma.$transaction((tx) =>
      createDowntimeReason(tx, admin, {
        code: code("D"),
        description: "Die change",
        category: "DIE_CHANGE",
      }),
    );
    expect(reason.category).toBe("DIE_CHANGE");
  });
});
