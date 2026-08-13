import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { receiveRoll, availableRolls } from "../lib/stock-ledger.js";
import { agingSweep, releaseEarly, AgingValidationError } from "../lib/aging.js";
import { AuthzError, type Actor } from "../lib/rbac.js";
import type { Dimensions } from "../lib/uom.js";

const suite = process.env.DATABASE_URL ? describe : describe.skip;

suite("aging queue (integration)", () => {
  let prisma: PrismaClient;
  let companyId: string;
  let prod: Actor;
  let sales: Actor;
  let itemId: string;
  let locationId: string;

  const dims: Dimensions = {
    length_m: "100",
    width_m: "1.2",
    layers: [{ thickness_mm: "3", density_kg_m3: "25" }],
  };

  beforeAll(async () => {
    prisma = new PrismaClient();
    const company = await prisma.company.create({
      data: { name: `Aging Co ${Date.now()}` },
    });
    companyId = company.id;
    const prodUser = await prisma.user.create({
      data: {
        companyId,
        email: `pr-${Date.now()}@t.local`,
        name: "Prod",
        passwordHash: "x",
        role: "PRODUCTION",
      },
    });
    const salesUser = await prisma.user.create({
      data: {
        companyId,
        email: `sa-${Date.now()}@t.local`,
        name: "Sales",
        passwordHash: "x",
        role: "SALES",
      },
    });
    prod = { userId: prodUser.id, companyId, role: "PRODUCTION" };
    sales = { userId: salesUser.id, companyId, role: "SALES" };
    const item = await prisma.item.create({
      data: {
        companyId,
        code: `FG-${Date.now()}`,
        name: "EPE roll",
        type: "FINISHED_GOOD",
        uomBase: "M2",
      },
    });
    itemId = item.id;
    const location = await prisma.location.create({
      data: { companyId, name: "Store", code: `L-${Date.now()}` },
    });
    locationId = location.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** A CURING roll with a specific aging-ready date. QC pass is the other, independent gate
   *  (S16); default these test rolls QC-passed so the sweep tests exercise aging in isolation. */
  async function curingRoll(readyDate: Date, qcStatus: "PASSED" | "PENDING" = "PASSED") {
    const { roll } = await prisma.$transaction((tx) =>
      receiveRoll(tx, {
        companyId,
        itemId,
        locationId,
        dimensions: dims,
        actualKg: "45",
        initialState: "CURING",
        agingReadyDate: readyDate,
        actorUserId: prod.userId,
      }),
    );
    await prisma.roll.update({ where: { id: roll.id }, data: { qcStatus } });
    return roll;
  }

  it("sweep flips exactly the due rolls, is idempotent, and audits each transition", async () => {
    const asOf = new Date("2026-08-10T06:00:00.000Z");
    const dueA = await curingRoll(new Date("2026-08-08T06:00:00.000Z")); // past → due
    const dueB = await curingRoll(new Date("2026-08-10T05:00:00.000Z")); // past → due
    const notDue = await curingRoll(new Date("2026-08-12T06:00:00.000Z")); // future → stays

    const res = await prisma.$transaction((tx) => agingSweep(tx, companyId, asOf));
    expect(res.flipped).toBe(2);
    expect(res.rollIds.sort()).toEqual([dueA.id, dueB.id].sort());

    const states = async (id: string) =>
      (await prisma.roll.findUniqueOrThrow({ where: { id } })).state;
    expect(await states(dueA.id)).toBe("AVAILABLE");
    expect(await states(dueB.id)).toBe("AVAILABLE");
    expect(await states(notDue.id)).toBe("CURING");

    // QC gate (S16): an aged roll that is NOT QC-passed is left curing by the sweep.
    const agedButPending = await curingRoll(
      new Date("2026-08-09T06:00:00.000Z"),
      "PENDING",
    );
    const res2 = await prisma.$transaction((tx) => agingSweep(tx, companyId, asOf));
    expect(res2.rollIds).not.toContain(agedButPending.id);
    expect(await states(agedButPending.id)).toBe("CURING");

    // One CURE_COMPLETE audit per flipped roll.
    expect(
      await prisma.auditLog.count({
        where: { entity: "Roll", action: "CURE_COMPLETE", entityId: { in: res.rollIds } },
      }),
    ).toBe(2);

    // Idempotent: running again flips nothing and adds no audits.
    const again = await prisma.$transaction((tx) => agingSweep(tx, companyId, asOf));
    expect(again.flipped).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: { entity: "Roll", action: "CURE_COMPLETE", entityId: { in: res.rollIds } },
      }),
    ).toBe(2);

    // availableRolls now returns the swept rolls (and not the still-curing one).
    const avail = await availableRolls(prisma, companyId, itemId, asOf);
    const availIds = avail.map((r) => r.id);
    expect(availIds).toContain(dueA.id);
    expect(availIds).toContain(dueB.id);
    expect(availIds).not.toContain(notDue.id);
  });

  it("early release flips a still-curing roll with a logged override; a reason is required", async () => {
    const roll = await curingRoll(new Date("2027-01-01T00:00:00.000Z")); // far future

    // No reason → refused, roll untouched.
    await expect(
      prisma.$transaction((tx) => releaseEarly(tx, prod, roll.id, "   ")),
    ).rejects.toBeInstanceOf(AgingValidationError);
    expect((await prisma.roll.findUniqueOrThrow({ where: { id: roll.id } })).state).toBe(
      "CURING",
    );

    // Non-production actor → denied.
    await expect(
      prisma.$transaction((tx) => releaseEarly(tx, sales, roll.id, "urgent order")),
    ).rejects.toBeInstanceOf(AuthzError);

    // With a reason → flipped and audited.
    const released = await prisma.$transaction((tx) =>
      releaseEarly(tx, prod, roll.id, "urgent customer order, QC cleared"),
    );
    expect(released.state).toBe("AVAILABLE");
    const audit = await prisma.auditLog.findFirst({
      where: { entity: "Roll", entityId: roll.id, action: "RELEASE_EARLY" },
    });
    expect(audit).not.toBeNull();

    // Releasing again (now AVAILABLE) is refused — it's not curing.
    await expect(
      prisma.$transaction((tx) => releaseEarly(tx, prod, roll.id, "again")),
    ).rejects.toBeInstanceOf(AgingValidationError);
  });
});
