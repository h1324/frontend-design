import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  salesSummary,
  receivablesSummary,
  productionSummary,
  oeeByLot,
} from "../lib/kpi.js";
import { customerOutstandingPaise } from "../lib/receivables.js";

const suite = process.env.DATABASE_URL ? describe : describe.skip;

suite("kpi gatherers (integration)", () => {
  let prisma: PrismaClient;
  let companyId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    companyId = (await prisma.company.create({ data: { name: `KPI Co ${Date.now()}` } }))
      .id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("sales summary reconciles with issued invoices (totals + top customer/SKU)", async () => {
    const item = await prisma.item.create({
      data: {
        companyId,
        code: `FG-${Date.now()}`,
        name: "EPE",
        type: "FINISHED_GOOD",
        uomBase: "M2",
      },
    });
    const customer = await prisma.customer.create({
      data: { companyId, code: `C-${Date.now()}`, name: "Acme" },
    });
    const shipTo = await prisma.shipToAddress.create({
      data: { customerId: customer.id, label: "M", gstStateCode: "27", isDefault: true },
    });
    const dn = await prisma.dispatchNote.create({
      data: {
        companyId,
        docNo: `DN/${Date.now()}`,
        customerId: customer.id,
        shipToId: shipTo.id,
        status: "DISPATCHED",
      },
    });
    await prisma.invoice.create({
      data: {
        companyId,
        docNo: `INV/${Date.now()}`,
        dispatchNoteId: dn.id,
        customerId: customer.id,
        shipToId: shipTo.id,
        placeOfSupplyStateCode: "27",
        taxableValuePaise: 500000n,
        totalPaise: 590000n,
        status: "ISSUED",
        lines: {
          create: [
            {
              itemId: item.id,
              description: "EPE",
              qtyKg: "100",
              qtyM2: "400",
              ratePaise: 1250n,
              gstRatePct: "18",
              taxableValuePaise: 500000n,
            },
          ],
        },
      },
    });

    const s = await salesSummary(prisma, companyId);
    expect(s.invoices).toBe(1);
    expect(s.netSalePaise).toBe(500000n);
    expect(s.dispatchedKg.toString()).toBe("100");
    expect(s.dispatchedM2.toString()).toBe("400");
    expect(s.byCustomer[0]!.name).toBe("Acme");
    expect(s.byCustomer[0]!.netSalePaise).toBe(500000n);
    expect(s.bySku[0]!.qtyM2.toString()).toBe("400");
  });

  it("receivables summary reconciles with S19 outstanding", async () => {
    const summary = await receivablesSummary(prisma, companyId);
    // The one issued invoice above is fully outstanding.
    expect(summary.outstandingPaise).toBe(590000n);
    // Sum of per-customer outstanding matches.
    const customers = await prisma.customer.findMany({ where: { companyId } });
    let manual = 0n;
    for (const c of customers)
      manual += await customerOutstandingPaise(prisma, companyId, c.id);
    expect(summary.outstandingPaise).toBe(manual);
    expect(summary.buckets.total).toBe(590000n); // due today (creditDays 0) → current bucket
    expect(summary.buckets.current).toBe(590000n);
  });

  it("production summary and per-lot OEE compute over a closed lot", async () => {
    const fg = await prisma.item.create({
      data: {
        companyId,
        code: `FG2-${Date.now()}`,
        name: "EPE2",
        type: "FINISHED_GOOD",
        uomBase: "M2",
      },
    });
    const machine = await prisma.machine.create({
      data: { companyId, code: `M-${Date.now()}`, name: "FLY", ratedCapacityKgHr: "250" },
    });
    const shift = await prisma.shift.create({
      data: {
        companyId,
        code: `SH-${Date.now()}`,
        name: "A",
        startTime: "08:00",
        endTime: "16:00",
      },
    });
    const op = await prisma.operator.create({
      data: { companyId, code: `O-${Date.now()}`, name: "Ravi" },
    });
    const loc = await prisma.location.create({
      data: { companyId, code: `L-${Date.now()}`, name: "S" },
    });
    const reason = await prisma.downtimeReason.create({
      data: {
        companyId,
        code: `DT-${Date.now()}`,
        description: "Die change",
        category: "DIE_CHANGE",
      },
    });
    const lot = await prisma.lot.create({
      data: {
        companyId,
        lotNo: `LOT/${Date.now()}`,
        machineId: machine.id,
        shiftId: shift.id,
        operatorId: op.id,
        targetItemId: fg.id,
        productionDate: new Date("2026-03-01T04:00:00Z"),
        startAt: new Date("2026-03-01T02:30:00Z"),
        endAt: new Date("2026-03-01T10:30:00Z"),
        status: "CLOSED",
        outputKg: "1800",
      },
    });
    await prisma.downtimeLog.create({
      data: { lotId: lot.id, reasonId: reason.id, minutes: 48 },
    });
    for (let i = 0; i < 2; i++) {
      await prisma.roll.create({
        data: {
          companyId,
          itemId: fg.id,
          lotId: lot.id,
          locationId: loc.id,
          rollNo: `R-${Date.now()}-${i}`,
          state: "AVAILABLE",
          length_m: "100",
          width_m: "2",
          layersJson: [{ thickness_mm: 3, density_kg_m3: 25 }],
          qtyKgTheoretical: "900",
          qtyKgActual: "900",
          qtyM2: "1000",
          densityKgM3: "25",
        },
      });
    }

    const prod = await productionSummary(prisma, companyId, {
      from: new Date("2026-02-01"),
      to: new Date("2026-04-01"),
    });
    expect(prod.lots).toBe(1);
    expect(prod.outputKg.toString()).toBe("1800");
    expect(prod.downtimeMin).toBe(48);

    const rows = await oeeByLot(prisma, companyId, {
      from: new Date("2026-02-01"),
      to: new Date("2026-04-01"),
    });
    const row = rows.find((r) => r.lotId === lot.id)!;
    // planned 480min, down 48 → avail 0.9; operating 7.2h × 250 = 1800 cap; actual 1800 → perf 1.0; quality 1.0
    expect(row.factors.availability).toBeCloseTo(0.9, 5);
    expect(row.factors.performance).toBeCloseTo(1, 5);
    expect(row.factors.quality).toBeCloseTo(1, 5);
    expect(row.factors.oee).toBeCloseTo(0.9, 5);
  });
});
