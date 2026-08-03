import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  openLot,
  addDowntime,
  closeLot,
  cancelLot,
  lotMetrics,
  ProductionValidationError,
} from "../lib/production.js";
import { createIssue } from "../lib/rm-stores.js";
import { post, itemBalance } from "../lib/stock-ledger.js";
import { AuthzError, type Actor } from "../lib/rbac.js";
import type { Dimensions } from "../lib/uom.js";

const suite = process.env.DATABASE_URL ? describe : describe.skip;

suite("production batch / lot (integration)", () => {
  let prisma: PrismaClient;
  let companyId: string;
  let prod: Actor;
  let stores: Actor;
  let sales: Actor;
  let machineId: string;
  let shiftId: string;
  let operatorId: string;
  let reasonId: string;
  let targetItemId: string; // finished good, 3-day aging
  let resinId: string; // RM
  let regrindId: string; // RM (regrind grade)
  let locationId: string;

  const roll = (
    kg: string,
  ): { locationId: string; dimensions: Dimensions; actualKg: string } => ({
    locationId,
    dimensions: {
      length_m: "100",
      width_m: "1.2",
      layers: [{ thickness_mm: "3", density_kg_m3: "25" }],
    },
    actualKg: kg,
  });

  beforeAll(async () => {
    prisma = new PrismaClient();
    const company = await prisma.company.create({
      data: { name: `Lot Co ${Date.now()}`, defaultAgingDays: 7 },
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
    const storesUser = await prisma.user.create({
      data: {
        companyId,
        email: `st-${Date.now()}@t.local`,
        name: "Stores",
        passwordHash: "x",
        role: "STORES",
      },
    });
    prod = { userId: prodUser.id, companyId, role: "PRODUCTION" };
    stores = { userId: storesUser.id, companyId, role: "STORES" };
    sales = { userId: salesUser.id, companyId, role: "SALES" };

    const machine = await prisma.machine.create({
      data: { companyId, code: `M-${Date.now()}`, name: "FLY-250" },
    });
    machineId = machine.id;
    const shift = await prisma.shift.create({
      data: {
        companyId,
        code: `S-${Date.now()}`,
        name: "A",
        startTime: "08:00",
        endTime: "16:00",
      },
    });
    shiftId = shift.id;
    const operator = await prisma.operator.create({
      data: { companyId, code: `O-${Date.now()}`, name: "Ravi" },
    });
    operatorId = operator.id;
    const reason = await prisma.downtimeReason.create({
      data: {
        companyId,
        code: `D-${Date.now()}`,
        description: "Die change",
        category: "DIE_CHANGE",
      },
    });
    reasonId = reason.id;

    const target = await prisma.item.create({
      data: {
        companyId,
        code: `FG-${Date.now()}`,
        name: "EPE 3mm 25kg roll",
        type: "FINISHED_GOOD",
        uomBase: "M2",
        agingDays: 3,
      },
    });
    targetItemId = target.id;
    const resin = await prisma.item.create({
      data: {
        companyId,
        code: `LDPE-${Date.now()}`,
        name: "LDPE",
        type: "RAW_MATERIAL",
        uomBase: "KG",
      },
    });
    resinId = resin.id;
    const regrind = await prisma.item.create({
      data: {
        companyId,
        code: `RG-${Date.now()}`,
        name: "Regrind",
        type: "RAW_MATERIAL",
        uomBase: "KG",
      },
    });
    regrindId = regrind.id;
    const location = await prisma.location.create({
      data: { companyId, name: "Store", code: `L-${Date.now()}` },
    });
    locationId = location.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // Seed RM stock directly on the ledger so issues have something to consume.
  async function stockRm(itemId: string, qty: string): Promise<void> {
    await prisma.$transaction((tx) =>
      post(tx, {
        grain: "BULK",
        direction: "IN",
        companyId,
        itemId,
        locationId,
        qtyBase: qty,
        reason: "GRN",
        actorUserId: prod.userId,
      }),
    );
  }

  it("openLot allocates a gapless FY lot number and opens OPEN", async () => {
    const lot = await prisma.$transaction((tx) =>
      openLot(tx, prod, { machineId, shiftId, operatorId, targetItemId }),
    );
    expect(lot.lotNo).toMatch(/^LOT\/\d{4}-\d{2}\/\d{6}$/);
    expect(lot.status).toBe("OPEN");

    const lot2 = await prisma.$transaction((tx) =>
      openLot(tx, prod, { machineId, shiftId, operatorId, targetItemId }),
    );
    const seq = (s: string) => Number(s.split("/")[2]);
    expect(seq(lot2.lotNo)).toBe(seq(lot.lotNo) + 1);
  });

  it("denies a non-production actor (SALES) opening a lot", async () => {
    await expect(
      prisma.$transaction((tx) =>
        openLot(tx, sales, { machineId, shiftId, operatorId, targetItemId }),
      ),
    ).rejects.toBeInstanceOf(AuthzError);
  });

  it("closeLot creates CURING rolls with aging-ready dates, sums output, and derives regrind %", async () => {
    await stockRm(resinId, "800");
    await stockRm(regrindId, "200");

    const productionDate = new Date("2026-08-03T04:00:00.000Z");
    const lot = await prisma.$transaction((tx) =>
      openLot(tx, prod, { machineId, shiftId, operatorId, targetItemId, productionDate }),
    );

    // Issue RM to the lot: 800 virgin + 200 regrind → 20% regrind blend.
    await prisma.$transaction((tx) =>
      createIssue(tx, stores, {
        lotId: lot.id,
        lines: [
          { itemId: resinId, locationId, qtyBase: "800", isRegrind: false },
          { itemId: regrindId, locationId, qtyBase: "200", isRegrind: true },
        ],
      }),
    );

    const closed = await prisma.$transaction((tx) =>
      closeLot(tx, prod, lot.id, {
        rolls: [roll("460"), roll("460")],
        scrapKg: "40",
        trimKg: "30",
        energyKwh: "125.5",
      }),
    );
    expect(closed.status).toBe("CLOSED");
    expect(closed.outputKg.toString()).toBe("920");
    expect(closed.regrindPct.toString()).toBe("20");
    expect(closed.scrapKg.toString()).toBe("40");
    expect(closed.energyKwh?.toString()).toBe("125.5");

    // Two output rolls, both CURING, aging-ready 3 days after production date.
    const rolls = await prisma.roll.findMany({ where: { lotId: lot.id } });
    expect(rolls).toHaveLength(2);
    for (const r of rolls) {
      expect(r.state).toBe("CURING");
      expect(r.agingReadyDate?.toISOString()).toBe("2026-08-06T04:00:00.000Z");
    }

    // SERIAL IN posted for each roll.
    const ins = await prisma.stockLedger.count({
      where: { grain: "SERIAL", direction: "IN", rollId: { in: rolls.map((r) => r.id) } },
    });
    expect(ins).toBe(2);

    // Metrics: input 1000, output 920, scrap 40, trim 30 → balance variance 10; yield 92%.
    const m = await lotMetrics(prisma, lot.id);
    expect(m.inputKg.toString()).toBe("1000");
    expect(m.outputKg.toString()).toBe("920");
    expect(m.yieldPct.toString()).toBe("92");
    expect(m.balanceVariance.toString()).toBe("10");
    expect(m.regrindPct.toString()).toBe("20");
  });

  it("addDowntime records minutes against an open lot and rejects a closed one", async () => {
    const lot = await prisma.$transaction((tx) =>
      openLot(tx, prod, { machineId, shiftId, operatorId, targetItemId }),
    );
    await prisma.$transaction((tx) =>
      addDowntime(tx, prod, lot.id, { reasonId, minutes: 45, note: "die swap" }),
    );
    const logs = await prisma.downtimeLog.findMany({ where: { lotId: lot.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0]?.minutes).toBe(45);

    await prisma.$transaction((tx) =>
      closeLot(tx, prod, lot.id, { rolls: [roll("100")] }),
    );
    // Downtime on a CLOSED lot is refused.
    await expect(
      prisma.$transaction((tx) =>
        addDowntime(tx, prod, lot.id, { reasonId, minutes: 10 }),
      ),
    ).rejects.toBeInstanceOf(ProductionValidationError);
  });

  it("cancelLot reverses output-roll stock and returns issued RM to stock", async () => {
    await stockRm(resinId, "500");
    const before = await itemBalance(prisma, companyId, resinId, locationId);

    const lot = await prisma.$transaction((tx) =>
      openLot(tx, prod, { machineId, shiftId, operatorId, targetItemId }),
    );
    await prisma.$transaction((tx) =>
      createIssue(tx, stores, {
        lotId: lot.id,
        lines: [{ itemId: resinId, locationId, qtyBase: "500", isRegrind: false }],
      }),
    );
    // Material consumed → balance dropped by 500.
    expect((await itemBalance(prisma, companyId, resinId, locationId)).toString()).toBe(
      before.minus(500).toString(),
    );

    const closed = await prisma.$transaction((tx) =>
      closeLot(tx, prod, lot.id, { rolls: [roll("480")] }),
    );
    const rollIds = (await prisma.roll.findMany({ where: { lotId: lot.id } })).map(
      (r) => r.id,
    );

    const cancelled = await prisma.$transaction((tx) => cancelLot(tx, prod, lot.id));
    expect(cancelled.status).toBe("CANCELLED");
    void closed;

    // RM back in stock.
    expect((await itemBalance(prisma, companyId, resinId, locationId)).toString()).toBe(
      before.toString(),
    );
    // Output rolls cancelled and their SERIAL INs reversed.
    const rolls = await prisma.roll.findMany({ where: { id: { in: rollIds } } });
    for (const r of rolls) expect(r.state).toBe("CANCELLED");
    const reversals = await prisma.stockLedger.count({
      where: { grain: "SERIAL", reason: "REVERSAL", rollId: { in: rollIds } },
    });
    expect(reversals).toBe(rollIds.length);
    // The consuming issue is marked CANCELLED, not deleted.
    const issues = await prisma.materialIssue.findMany({ where: { lotId: lot.id } });
    expect(issues.every((i) => i.status === "CANCELLED")).toBe(true);
  });
});
