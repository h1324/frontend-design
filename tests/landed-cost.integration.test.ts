import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createGRN, cancelGRN } from "../lib/goods-receipt.js";
import { addGrnCharges, itemStockValue, LandedCostError } from "../lib/landed-cost.js";
import { AuthzError, type Actor } from "../lib/rbac.js";

const suite = process.env.DATABASE_URL ? describe : describe.skip;

suite("landed cost (integration)", () => {
  let prisma: PrismaClient;
  let companyId: string;
  let stores: Actor;
  let sales: Actor;
  let holdLocId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    const company = await prisma.company.create({
      data: { name: `LC Co ${Date.now()}` },
    });
    companyId = company.id;
    const st = await prisma.user.create({
      data: {
        companyId,
        email: `lc-st-${Date.now()}@t.local`,
        name: "St",
        passwordHash: "x",
        role: "STORES",
      },
    });
    const sa = await prisma.user.create({
      data: {
        companyId,
        email: `lc-sa-${Date.now()}@t.local`,
        name: "Sa",
        passwordHash: "x",
        role: "SALES",
      },
    });
    stores = { userId: st.id, companyId, role: "STORES" };
    sales = { userId: sa.id, companyId, role: "SALES" };
    holdLocId = (
      await prisma.location.create({
        data: { companyId, code: `QCH-${Date.now()}`, name: "QC Hold", isQcHold: true },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function rmItem(code: string) {
    return prisma.item.create({
      data: {
        companyId,
        code: `${code}-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        name: code,
        type: "RAW_MATERIAL",
        uomBase: "KG",
      },
    });
  }

  it("apportions a freight charge by value and builds landed cost + moving average", async () => {
    const ldpe = await rmItem("LDPE");
    const talc = await rmItem("TALC");
    const grn = await prisma.$transaction((tx) =>
      createGRN(tx, stores, {
        supplierId: null,
        holdLocationId: holdLocId,
        lines: [
          { itemId: ldpe.id, qtyReceived: "100", ratePaise: 5000 }, // ₹50/kg → value 5,00,000
          { itemId: talc.id, qtyReceived: "50", ratePaise: 8000 }, //  ₹80/kg → value 4,00,000
        ],
      }),
    );

    // ₹1,000 freight (1,00,000 p) apportioned by VALUE across 5,00,000 : 4,00,000.
    await prisma.$transaction((tx) =>
      addGrnCharges(tx, stores, grn.id, [
        { chargeType: "FREIGHT", amountPaise: 100000n, apportionBasis: "VALUE" },
      ]),
    );

    const lines = await prisma.goodsReceiptLine.findMany({ where: { grnId: grn.id } });
    const byItem = new Map(lines.map((l) => [l.itemId, l]));
    // LDPE share = 55,556 over 100kg → +556/kg → 5,556; TALC = 44,444 over 50kg → +889/kg → 8,889
    expect(byItem.get(ldpe.id)!.landedUnitCostPaise).toBe(5556n);
    expect(byItem.get(talc.id)!.landedUnitCostPaise).toBe(8889n);

    const ldpeAfter = await prisma.item.findUniqueOrThrow({ where: { id: ldpe.id } });
    expect(ldpeAfter.movingAvgCostPaise).toBe(5556n);
    expect(ldpeAfter.costedQtyBase.toString()).toBe("100");

    const val = await itemStockValue(prisma, companyId, ldpe.id);
    expect(val.qtyOnHand.toString()).toBe("100");
    expect(val.valuePaise).toBe(555600n); // 100 × 5,556
  });

  it("blends moving average across two receipts of the same item", async () => {
    const copo = await rmItem("COPO");
    const g1 = await prisma.$transaction((tx) =>
      createGRN(tx, stores, {
        supplierId: null,
        holdLocationId: holdLocId,
        lines: [{ itemId: copo.id, qtyReceived: "100", ratePaise: 5000 }],
      }),
    );
    await prisma.$transaction((tx) => addGrnCharges(tx, stores, g1.id, []));
    const g2 = await prisma.$transaction((tx) =>
      createGRN(tx, stores, {
        supplierId: null,
        holdLocationId: holdLocId,
        lines: [{ itemId: copo.id, qtyReceived: "100", ratePaise: 6000 }],
      }),
    );
    await prisma.$transaction((tx) => addGrnCharges(tx, stores, g2.id, []));

    const after = await prisma.item.findUniqueOrThrow({ where: { id: copo.id } });
    expect(after.movingAvgCostPaise).toBe(5500n); // (100·5000 + 100·6000)/200
    expect(after.costedQtyBase.toString()).toBe("200");
  });

  it("refuses double-costing and a non-STORES actor", async () => {
    const item = await rmItem("MB");
    const grn = await prisma.$transaction((tx) =>
      createGRN(tx, stores, {
        supplierId: null,
        holdLocationId: holdLocId,
        lines: [{ itemId: item.id, qtyReceived: "10", ratePaise: 9000 }],
      }),
    );
    await prisma.$transaction((tx) => addGrnCharges(tx, stores, grn.id, []));
    await expect(
      prisma.$transaction((tx) => addGrnCharges(tx, stores, grn.id, [])),
    ).rejects.toBeInstanceOf(LandedCostError);

    const grn2 = await prisma.$transaction((tx) =>
      createGRN(tx, stores, {
        supplierId: null,
        holdLocationId: holdLocId,
        lines: [{ itemId: item.id, qtyReceived: "10", ratePaise: 9000 }],
      }),
    );
    await expect(
      prisma.$transaction((tx) => addGrnCharges(tx, sales, grn2.id, [])),
    ).rejects.toBeInstanceOf(AuthzError);
  });

  it("cancelling a costed GRN unwinds the moving average and clears landed cost", async () => {
    const item = await rmItem("GMS");
    const grn = await prisma.$transaction((tx) =>
      createGRN(tx, stores, {
        supplierId: null,
        holdLocationId: holdLocId,
        lines: [{ itemId: item.id, qtyReceived: "100", ratePaise: 5000 }],
      }),
    );
    await prisma.$transaction((tx) => addGrnCharges(tx, stores, grn.id, []));
    expect(
      (await prisma.item.findUniqueOrThrow({ where: { id: item.id } }))
        .movingAvgCostPaise,
    ).toBe(5000n);

    await prisma.$transaction((tx) => cancelGRN(tx, stores, grn.id));
    const after = await prisma.item.findUniqueOrThrow({ where: { id: item.id } });
    expect(after.costedQtyBase.toString()).toBe("0");
    expect(after.movingAvgCostPaise).toBe(0n);
    const line = await prisma.goodsReceiptLine.findFirstOrThrow({
      where: { grnId: grn.id },
    });
    expect(line.landedUnitCostPaise).toBeNull();
  });
});
