import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { receiveRoll } from "../lib/stock-ledger.js";
import {
  openConverting,
  pickParents,
  closeConverting,
  cancelConverting,
  convertingMetrics,
  traceRoll,
  ConvertingValidationError,
} from "../lib/converting.js";
import { AuthzError, type Actor } from "../lib/rbac.js";
import type { Dimensions } from "../lib/uom.js";

const suite = process.env.DATABASE_URL ? describe : describe.skip;

suite("converting orders (integration)", () => {
  let prisma: PrismaClient;
  let companyId: string;
  let prod: Actor;
  let sales: Actor;
  let itemId: string;
  let locationId: string;
  let machineId: string;
  let shiftId: string;
  let operatorId: string;
  let lotId: string;

  const parentDims: Dimensions = {
    length_m: "200",
    width_m: "1.5",
    layers: [{ thickness_mm: "3", density_kg_m3: "25" }],
  };
  const slitChild: Dimensions = {
    length_m: "200",
    width_m: "0.75",
    layers: [{ thickness_mm: "3", density_kg_m3: "25" }],
  };

  beforeAll(async () => {
    prisma = new PrismaClient();
    const company = await prisma.company.create({
      data: { name: `CV Co ${Date.now()}`, defaultAgingDays: 3 },
    });
    companyId = company.id;
    const prodUser = await prisma.user.create({
      data: {
        companyId,
        email: `pr-${Date.now()}@t.local`,
        name: "Pr",
        passwordHash: "x",
        role: "PRODUCTION",
      },
    });
    const salesUser = await prisma.user.create({
      data: {
        companyId,
        email: `sa-${Date.now()}@t.local`,
        name: "Sa",
        passwordHash: "x",
        role: "SALES",
      },
    });
    prod = { userId: prodUser.id, companyId, role: "PRODUCTION" };
    sales = { userId: salesUser.id, companyId, role: "SALES" };
    itemId = (
      await prisma.item.create({
        data: {
          companyId,
          code: `FG-${Date.now()}`,
          name: "EPE",
          type: "FINISHED_GOOD",
          uomBase: "M2",
          agingDays: 3,
        },
      })
    ).id;
    locationId = (
      await prisma.location.create({
        data: { companyId, code: `L-${Date.now()}`, name: "Store" },
      })
    ).id;
    machineId = (
      await prisma.machine.create({
        data: { companyId, code: `M-${Date.now()}`, name: "SLIT" },
      })
    ).id;
    shiftId = (
      await prisma.shift.create({
        data: {
          companyId,
          code: `SH-${Date.now()}`,
          name: "A",
          startTime: "08:00",
          endTime: "16:00",
        },
      })
    ).id;
    operatorId = (
      await prisma.operator.create({
        data: { companyId, code: `O-${Date.now()}`, name: "Ravi" },
      })
    ).id;
    lotId = (
      await prisma.lot.create({
        data: {
          companyId,
          lotNo: `LOT/2026-27/${Date.now().toString().slice(-6)}`,
          machineId,
          shiftId,
          operatorId,
          targetItemId: itemId,
          productionDate: new Date("2026-08-01T04:00:00Z"),
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** An AVAILABLE parent roll, optionally traceable to the extrusion lot. */
  async function parentRoll(withLot = true) {
    const { roll } = await prisma.$transaction((tx) =>
      receiveRoll(tx, {
        companyId,
        itemId,
        locationId,
        dimensions: parentDims,
        actualKg: "22.5",
        initialState: "AVAILABLE",
        lotId: withLot ? lotId : null,
        actorUserId: prod.userId,
      }),
    );
    return roll;
  }

  it("slitting consumes the parent and creates AVAILABLE children with genealogy", async () => {
    const parent = await parentRoll();
    const order = await prisma.$transaction((tx) =>
      openConverting(tx, prod, {
        operation: "SLITTING",
        machineId,
        shiftId,
        operatorId,
        targetItemId: itemId,
      }),
    );
    expect(order.docNo).toMatch(/^CV\/\d{4}-\d{2}\/\d{6}$/);

    await prisma.$transaction((tx) => pickParents(tx, prod, order.id, [parent.id]));
    expect(
      (await prisma.roll.findUniqueOrThrow({ where: { id: parent.id } })).state,
    ).toBe("ALLOCATED");

    const closed = await prisma.$transaction((tx) =>
      closeConverting(tx, prod, order.id, {
        children: [
          { locationId, dimensions: slitChild, actualKg: "11" },
          { locationId, dimensions: slitChild, actualKg: "11" },
        ],
        trimKg: "0.5",
      }),
    );
    expect(closed.status).toBe("CLOSED");

    // Parent consumed with a SERIAL OUT.
    expect(
      (await prisma.roll.findUniqueOrThrow({ where: { id: parent.id } })).state,
    ).toBe("CONSUMED");
    expect(
      await prisma.stockLedger.count({
        where: {
          rollId: parent.id,
          grain: "SERIAL",
          direction: "OUT",
          reason: "CONVERT_OUT",
        },
      }),
    ).toBe(1);

    // Two children: AVAILABLE, QC-passed, linked to the order, numbered, with SERIAL INs.
    const children = await prisma.roll.findMany({
      where: { convertingOrderId: order.id },
    });
    expect(children).toHaveLength(2);
    for (const c of children) {
      expect(c.state).toBe("AVAILABLE");
      expect(c.qcStatus).toBe("PASSED");
      expect(c.rollNo).toMatch(/^R\d{4}-\d{6}$/);
    }
    expect(
      await prisma.stockLedger.count({
        where: {
          rollId: { in: children.map((c) => c.id) },
          grain: "SERIAL",
          direction: "IN",
          reason: "CONVERT_IN",
        },
      }),
    ).toBe(2);

    // Metrics: input 22.5, output 22, trim 0.5 → balance 0.
    const m = await convertingMetrics(prisma, order.id);
    expect(m.inputKg.toString()).toBe("22.5");
    expect(m.outputKg.toString()).toBe("22");
    expect(m.balanceVariance.toString()).toBe("0");

    // Genealogy: a child traces to its parent, and the parent to its extrusion lot.
    const trace = await traceRoll(prisma, companyId, children[0]!.id);
    expect(trace?.convertingOrder?.id).toBe(order.id);
    const tracedParent = trace?.convertingOrder?.inputs[0]?.roll;
    expect(tracedParent?.id).toBe(parent.id);
    expect(tracedParent?.lot?.id).toBe(lotId);
  });

  it("lamination children start CURING with an aging-ready date", async () => {
    const parent = await parentRoll(false);
    const order = await prisma.$transaction((tx) =>
      openConverting(tx, prod, {
        operation: "LAMINATION",
        machineId,
        shiftId,
        operatorId,
        targetItemId: itemId,
      }),
    );
    await prisma.$transaction((tx) => pickParents(tx, prod, order.id, [parent.id]));
    await prisma.$transaction((tx) =>
      closeConverting(tx, prod, order.id, {
        children: [
          {
            locationId,
            dimensions: {
              length_m: "200",
              width_m: "1.5",
              layers: [
                { thickness_mm: "3", density_kg_m3: "25" },
                { thickness_mm: "3", density_kg_m3: "25" },
              ],
            },
            actualKg: "22",
          },
        ],
      }),
    );
    const child = await prisma.roll.findFirstOrThrow({
      where: { convertingOrderId: order.id },
    });
    expect(child.state).toBe("CURING");
    expect(child.agingReadyDate).not.toBeNull();
    expect(child.qcStatus).toBe("PASSED"); // inherited, so aging alone will release it
  });

  it("cancelling a CLOSED order reverses both sides; an OPEN order releases its parents", async () => {
    // CLOSED cancel
    const parent = await parentRoll(false);
    const order = await prisma.$transaction((tx) =>
      openConverting(tx, prod, {
        operation: "SLITTING",
        machineId,
        shiftId,
        operatorId,
        targetItemId: itemId,
      }),
    );
    await prisma.$transaction((tx) => pickParents(tx, prod, order.id, [parent.id]));
    await prisma.$transaction((tx) =>
      closeConverting(tx, prod, order.id, {
        children: [{ locationId, dimensions: slitChild, actualKg: "22" }],
      }),
    );
    const child = await prisma.roll.findFirstOrThrow({
      where: { convertingOrderId: order.id },
    });

    const cancelled = await prisma.$transaction((tx) =>
      cancelConverting(tx, prod, order.id),
    );
    expect(cancelled.status).toBe("CANCELLED");
    expect(
      (await prisma.roll.findUniqueOrThrow({ where: { id: parent.id } })).state,
    ).toBe("AVAILABLE");
    expect((await prisma.roll.findUniqueOrThrow({ where: { id: child.id } })).state).toBe(
      "CANCELLED",
    );
    expect(
      await prisma.stockLedger.count({
        where: { rollId: child.id, grain: "SERIAL", reason: "REVERSAL" },
      }),
    ).toBe(1);

    // OPEN cancel: parent returns to AVAILABLE (never consumed).
    const p2 = await parentRoll(false);
    const order2 = await prisma.$transaction((tx) =>
      openConverting(tx, prod, {
        operation: "SLITTING",
        machineId,
        shiftId,
        operatorId,
        targetItemId: itemId,
      }),
    );
    await prisma.$transaction((tx) => pickParents(tx, prod, order2.id, [p2.id]));
    expect((await prisma.roll.findUniqueOrThrow({ where: { id: p2.id } })).state).toBe(
      "ALLOCATED",
    );
    await prisma.$transaction((tx) => cancelConverting(tx, prod, order2.id));
    expect((await prisma.roll.findUniqueOrThrow({ where: { id: p2.id } })).state).toBe(
      "AVAILABLE",
    );
  });

  it("denies a non-production actor and rejects closing with no children", async () => {
    const parent = await parentRoll(false);
    await expect(
      prisma.$transaction((tx) =>
        openConverting(tx, sales, {
          operation: "SLITTING",
          machineId,
          shiftId,
          operatorId,
          targetItemId: itemId,
        }),
      ),
    ).rejects.toBeInstanceOf(AuthzError);

    const order = await prisma.$transaction((tx) =>
      openConverting(tx, prod, {
        operation: "SLITTING",
        machineId,
        shiftId,
        operatorId,
        targetItemId: itemId,
      }),
    );
    await prisma.$transaction((tx) => pickParents(tx, prod, order.id, [parent.id]));
    await expect(
      prisma.$transaction((tx) => closeConverting(tx, prod, order.id, { children: [] })),
    ).rejects.toBeInstanceOf(ConvertingValidationError);
  });
});
