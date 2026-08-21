import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  upsertCostRate,
  computeLotCost,
  computeConvertingCost,
  marginReport,
} from "../lib/costing.js";
import { AuthzError, type Actor } from "../lib/rbac.js";

const suite = process.env.DATABASE_URL ? describe : describe.skip;

suite("batch costing (integration)", () => {
  let prisma: PrismaClient;
  let companyId: string;
  let admin: Actor;
  let production: Actor;
  let ldpeId: string;
  let fgId: string;
  let locId: string;
  let machineId: string;
  let shiftId: string;
  let operatorId: string;
  let rollSeq = 0;

  const prodDate = new Date("2026-03-01T04:00:00Z");

  beforeAll(async () => {
    prisma = new PrismaClient();
    const company = await prisma.company.create({
      data: { name: `Cost Co ${Date.now()}` },
    });
    companyId = company.id;
    const ad = await prisma.user.create({
      data: {
        companyId,
        email: `co-ad-${Date.now()}@t.local`,
        name: "Ad",
        passwordHash: "x",
        role: "ADMIN",
      },
    });
    const pr = await prisma.user.create({
      data: {
        companyId,
        email: `co-pr-${Date.now()}@t.local`,
        name: "Pr",
        passwordHash: "x",
        role: "PRODUCTION",
      },
    });
    admin = { userId: ad.id, companyId, role: "ADMIN" };
    production = { userId: pr.id, companyId, role: "PRODUCTION" };
    // LDPE with a moving-average landed cost of ₹95/kg (from S20).
    ldpeId = (
      await prisma.item.create({
        data: {
          companyId,
          code: `LDPE-${Date.now()}`,
          name: "LDPE",
          type: "RAW_MATERIAL",
          uomBase: "KG",
          movingAvgCostPaise: 9500n,
        },
      })
    ).id;
    fgId = (
      await prisma.item.create({
        data: {
          companyId,
          code: `FG-${Date.now()}`,
          name: "EPE Sheet",
          type: "FINISHED_GOOD",
          uomBase: "M2",
        },
      })
    ).id;
    locId = (
      await prisma.location.create({
        data: { companyId, code: `L-${Date.now()}`, name: "Store" },
      })
    ).id;
    machineId = (
      await prisma.machine.create({
        data: { companyId, code: `M-${Date.now()}`, name: "FLY" },
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

    // Effective-dated rates: labour ₹3/kg from Jan, a higher ₹9/kg only from Jul (must NOT apply
    // to a March lot); energy ₹12/kWh; overhead ₹2/kg.
    await prisma.$transaction(async (tx) => {
      await upsertCostRate(tx, admin, {
        kind: "LABOUR",
        ratePaise: 300n,
        basis: "PER_KG",
        effectiveFrom: new Date("2026-01-01"),
      });
      await upsertCostRate(tx, admin, {
        kind: "LABOUR",
        ratePaise: 900n,
        basis: "PER_KG",
        effectiveFrom: new Date("2026-07-01"),
      });
      await upsertCostRate(tx, admin, {
        kind: "ENERGY",
        ratePaise: 1200n,
        basis: "PER_KWH",
        effectiveFrom: new Date("2026-01-01"),
      });
      await upsertCostRate(tx, admin, {
        kind: "OVERHEAD",
        ratePaise: 200n,
        basis: "PER_KG",
        effectiveFrom: new Date("2026-01-01"),
      });
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function roll(lotId: string | null, kg: string, m2: string) {
    rollSeq += 1;
    return prisma.roll.create({
      data: {
        companyId,
        itemId: fgId,
        lotId,
        locationId: locId,
        rollNo: `R-${Date.now()}-${rollSeq}`,
        state: "AVAILABLE",
        length_m: "100",
        width_m: "2",
        layersJson: [{ thickness_mm: 3, density_kg_m3: 25 }],
        qtyKgTheoretical: kg,
        qtyKgActual: kg,
        qtyM2: m2,
        densityKgM3: "25",
      },
    });
  }

  it("costs a lot: RM (landed) + regrind + energy + labour + overhead, allocated by weight", async () => {
    const lot = await prisma.lot.create({
      data: {
        companyId,
        lotNo: `LOT/T/${Date.now()}`,
        machineId,
        shiftId,
        operatorId,
        targetItemId: fgId,
        productionDate: prodDate,
        energyKwh: "250",
        status: "CLOSED",
      },
    });
    // Material issued: 100kg virgin + 20kg regrind, both LDPE at ₹95/kg.
    const iss = await prisma.materialIssue.create({
      data: { companyId, docNo: `ISS/T/${Date.now()}`, lotId: lot.id, status: "POSTED" },
    });
    await prisma.materialIssueLine.createMany({
      data: [
        {
          issueId: iss.id,
          itemId: ldpeId,
          locationId: locId,
          qtyBase: "100",
          isRegrind: false,
        },
        {
          issueId: iss.id,
          itemId: ldpeId,
          locationId: locId,
          qtyBase: "20",
          isRegrind: true,
        },
      ],
    });
    const r1 = await roll(lot.id, "46", "200");
    const r2 = await roll(lot.id, "46", "200");

    const cost = await prisma.$transaction((tx) => computeLotCost(tx, admin, lot.id));
    // rm 100×9500=9,50,000 ; regrind 20×9500=1,90,000 ; energy 250×1200=3,00,000 ;
    // labour 92×300=27,600 (the ₹3 rate, not the ₹9 that starts in July) ; overhead 92×200=18,400
    expect(cost.rmCostPaise).toBe(950000n);
    expect(cost.regrindCreditPaise).toBe(190000n);
    expect(cost.energyCostPaise).toBe(300000n);
    expect(cost.labourCostPaise).toBe(27600n);
    expect(cost.overheadCostPaise).toBe(18400n);
    expect(cost.totalCostPaise).toBe(1486000n);
    expect(cost.outputKg.toString()).toBe("92");

    // Per-roll cost allocates by weight and sums back to the lot total (no lost paise).
    const rolls = await prisma.roll.findMany({
      where: { lotId: lot.id },
      orderBy: { rollNo: "asc" },
    });
    const sum = rolls.reduce((s, r) => s + (r.unitCostPaise ?? 0n), 0n);
    expect(sum).toBe(1486000n);
    expect(rolls[0]!.unitCostPaise).toBe(743000n);

    // Recompute is idempotent (same total, one LotCost row).
    const again = await prisma.$transaction((tx) => computeLotCost(tx, admin, lot.id));
    expect(again.totalCostPaise).toBe(1486000n);
    expect(await prisma.lotCost.count({ where: { lotId: lot.id } })).toBe(1);
    // Keep the rolls for the margin test.
    (globalThis as Record<string, unknown>).__costedRollId = r1.id;
    void r2;
  });

  it("costs a converting order: parent cost + conversion, allocated to children", async () => {
    const lot = await prisma.lot.create({
      data: {
        companyId,
        lotNo: `LOT/CV/${Date.now()}`,
        machineId,
        shiftId,
        operatorId,
        targetItemId: fgId,
        productionDate: prodDate,
        status: "CLOSED",
      },
    });
    const p1 = await roll(lot.id, "50", "200");
    const p2 = await roll(lot.id, "50", "200");
    // Cost the parent lot (no material issues → RM 0; labour 100×3, overhead 100×2 = 500p/kg total 50,000).
    await prisma.$transaction((tx) => computeLotCost(tx, admin, lot.id));
    const parents = await prisma.roll.findMany({ where: { lotId: lot.id } });
    const parentCost = parents.reduce((s, r) => s + (r.unitCostPaise ?? 0n), 0n);

    const order = await prisma.convertingOrder.create({
      data: {
        companyId,
        docNo: `CV/T/${Date.now()}`,
        operation: "SLITTING",
        machineId,
        shiftId,
        operatorId,
        targetItemId: fgId,
        status: "CLOSED",
        endedAt: prodDate,
      },
    });
    await prisma.convertingInput.createMany({
      data: [
        { orderId: order.id, rollId: p1.id },
        { orderId: order.id, rollId: p2.id },
      ],
    });
    const child = await prisma.roll.create({
      data: {
        companyId,
        itemId: fgId,
        locationId: locId,
        convertingOrderId: order.id,
        rollNo: `RC-${Date.now()}`,
        state: "AVAILABLE",
        length_m: "90",
        width_m: "2",
        layersJson: [{ thickness_mm: 3, density_kg_m3: 25 }],
        qtyKgTheoretical: "90",
        qtyKgActual: "90",
        qtyM2: "180",
        densityKgM3: "25",
      },
    });

    const cost = await prisma.$transaction((tx) =>
      computeConvertingCost(tx, admin, order.id),
    );
    // conversion: labour 90×300 + overhead 90×200 = 45,000
    expect(cost.inputCostPaise).toBe(parentCost);
    expect(cost.conversionCostPaise).toBe(45000n);
    expect(cost.totalCostPaise).toBe(parentCost + 45000n);
    // Single child carries the whole total.
    const c = await prisma.roll.findUniqueOrThrow({ where: { id: child.id } });
    expect(c.unitCostPaise).toBe(parentCost + 45000n);
  });

  it("margin = net sale − dispatched-roll cost, by customer", async () => {
    const rollId = (globalThis as Record<string, unknown>).__costedRollId as string;
    const customer = await prisma.customer.create({
      data: { companyId, code: `C-${Date.now()}`, name: "Acme" },
    });
    const shipTo = await prisma.shipToAddress.create({
      data: { customerId: customer.id, label: "M", gstStateCode: "27", isDefault: true },
    });
    const dn = await prisma.dispatchNote.create({
      data: {
        companyId,
        docNo: `DN/T/${Date.now()}`,
        customerId: customer.id,
        shipToId: shipTo.id,
        status: "DISPATCHED",
      },
    });
    await prisma.dispatchRoll.create({ data: { dispatchNoteId: dn.id, rollId } });
    await prisma.invoice.create({
      data: {
        companyId,
        docNo: `INV/T/${Date.now()}`,
        dispatchNoteId: dn.id,
        customerId: customer.id,
        shipToId: shipTo.id,
        placeOfSupplyStateCode: "27",
        taxableValuePaise: 1000000n,
        totalPaise: 1180000n,
        status: "ISSUED",
      },
    });

    const report = await marginReport(prisma, companyId);
    const row = report.rows.find((r) => r.customerId === customer.id)!;
    expect(row.salePaise).toBe(1000000n); // net sale (taxable value)
    expect(row.costPaise).toBe(743000n); // the roll's snapshot cost
    expect(row.marginPaise).toBe(257000n);
  });

  it("denies a non-COSTING-writer from computing lot cost", async () => {
    const lot = await prisma.lot.create({
      data: {
        companyId,
        lotNo: `LOT/D/${Date.now()}`,
        machineId,
        shiftId,
        operatorId,
        targetItemId: fgId,
        productionDate: prodDate,
        status: "CLOSED",
      },
    });
    await expect(
      prisma.$transaction((tx) => computeLotCost(tx, production, lot.id)),
    ).rejects.toBeInstanceOf(AuthzError);
  });
});
