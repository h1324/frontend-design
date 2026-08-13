import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createPO } from "../lib/purchasing.js";
import {
  createGRN,
  cancelGRN,
  freeBulkBalance,
  heldBulkBalance,
  GrnValidationError,
} from "../lib/goods-receipt.js";
import { itemBalance, StockError } from "../lib/stock-ledger.js";
import { AuthzError, type Actor } from "../lib/rbac.js";

const suite = process.env.DATABASE_URL ? describe : describe.skip;

suite("goods receipt / GRN (integration)", () => {
  let prisma: PrismaClient;
  let companyId: string;
  let stores: Actor;
  let sales: Actor;
  let supplierId: string;
  let ldpeId: string;
  let holdLocId: string;
  let freeLocId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    const company = await prisma.company.create({
      data: { name: `GRN Co ${Date.now()}` },
    });
    companyId = company.id;
    const storesUser = await prisma.user.create({
      data: {
        companyId,
        email: `st-${Date.now()}@t.local`,
        name: "St",
        passwordHash: "x",
        role: "STORES",
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
    stores = { userId: storesUser.id, companyId, role: "STORES" };
    sales = { userId: salesUser.id, companyId, role: "SALES" };
    const supplier = await prisma.supplier.create({
      data: { companyId, code: `S-${Date.now()}`, name: "Reliance Polymers" },
    });
    supplierId = supplier.id;
    const ldpe = await prisma.item.create({
      data: {
        companyId,
        code: `LDPE-${Date.now()}`,
        name: "LDPE",
        type: "RAW_MATERIAL",
        uomBase: "KG",
      },
    });
    ldpeId = ldpe.id;
    const hold = await prisma.location.create({
      data: { companyId, code: `QCHOLD-${Date.now()}`, name: "QC Hold", isQcHold: true },
    });
    holdLocId = hold.id;
    const free = await prisma.location.create({
      data: { companyId, code: `MAIN-${Date.now()}`, name: "Main Store" },
    });
    freeLocId = free.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function openPO(qty: string, rate = 8500) {
    const po = await prisma.$transaction((tx) =>
      createPO(tx, stores, {
        supplierId,
        lines: [{ itemId: ldpeId, qtyOrdered: qty, ratePaise: rate }],
      }),
    );
    const line = await prisma.purchaseOrderLine.findFirstOrThrow({
      where: { poId: po.id },
    });
    return { po, line };
  }

  it("receiving against a PO lands stock on QC hold (not free) and bumps the PO balance", async () => {
    const { po, line } = await openPO("2000");
    const grn = await prisma.$transaction((tx) =>
      createGRN(tx, stores, {
        poId: po.id,
        lines: [{ poLineId: line.id, itemId: ldpeId, qtyReceived: "1200" }],
      }),
    );
    expect(grn.docNo).toMatch(/^GRN\/\d{4}-\d{2}\/\d{6}$/);

    // Stock is on the QC-hold location, not in free stock.
    expect((await heldBulkBalance(prisma, companyId, ldpeId)).toString()).toBe("1200");
    expect((await freeBulkBalance(prisma, companyId, ldpeId)).toString()).toBe("0");
    expect((await itemBalance(prisma, companyId, ldpeId, holdLocId)).toString()).toBe(
      "1200",
    );
    expect((await itemBalance(prisma, companyId, ldpeId, freeLocId)).toString()).toBe(
      "0",
    );

    // PO line received bumped; line rate carried onto the GRN line.
    const poLine = await prisma.purchaseOrderLine.findUniqueOrThrow({
      where: { id: line.id },
    });
    expect(poLine.qtyReceived.toString()).toBe("1200");
    const grnLine = await prisma.goodsReceiptLine.findFirstOrThrow({
      where: { grnId: grn.id },
    });
    expect(grnLine.qcStatus).toBe("PENDING");
    expect(grnLine.ratePaise).toBe(8500n);
    expect(grnLine.ledgerId).toBeTruthy();
  });

  it("blocks over-receipt beyond the ordered quantity", async () => {
    const { po, line } = await openPO("100");
    await prisma.$transaction((tx) =>
      createGRN(tx, stores, {
        poId: po.id,
        lines: [{ poLineId: line.id, itemId: ldpeId, qtyReceived: "80" }],
      }),
    );
    // 80 already received; receiving 30 more (>100) is rejected.
    await expect(
      prisma.$transaction((tx) =>
        createGRN(tx, stores, {
          poId: po.id,
          lines: [{ poLineId: line.id, itemId: ldpeId, qtyReceived: "30" }],
        }),
      ),
    ).rejects.toBeInstanceOf(GrnValidationError);
    // balance unchanged at 80
    const poLine = await prisma.purchaseOrderLine.findUniqueOrThrow({
      where: { id: line.id },
    });
    expect(poLine.qtyReceived.toString()).toBe("80");
  });

  it("cancelling a GRN reverses the hold stock and restores the PO balance", async () => {
    const { po, line } = await openPO("500");
    const grn = await prisma.$transaction((tx) =>
      createGRN(tx, stores, {
        poId: po.id,
        lines: [{ poLineId: line.id, itemId: ldpeId, qtyReceived: "500" }],
      }),
    );
    const heldBefore = await heldBulkBalance(prisma, companyId, ldpeId);

    await prisma.$transaction((tx) => cancelGRN(tx, stores, grn.id));

    // Hold stock dropped back by 500; PO balance restored to 0 received.
    expect((await heldBulkBalance(prisma, companyId, ldpeId)).toString()).toBe(
      heldBefore.minus(500).toString(),
    );
    const poLine = await prisma.purchaseOrderLine.findUniqueOrThrow({
      where: { id: line.id },
    });
    expect(poLine.qtyReceived.toString()).toBe("0");
    expect(
      (await prisma.goodsReceipt.findUniqueOrThrow({ where: { id: grn.id } })).status,
    ).toBe("CANCELLED");
  });

  it("refuses to cancel once QC has actioned a line, and blocks a reversal that would go negative", async () => {
    const { po, line } = await openPO("300");
    const grn = await prisma.$transaction((tx) =>
      createGRN(tx, stores, {
        poId: po.id,
        lines: [{ poLineId: line.id, itemId: ldpeId, qtyReceived: "300" }],
      }),
    );
    // Simulate QC passing the line (S16 will do this properly).
    await prisma.goodsReceiptLine.updateMany({
      where: { grnId: grn.id },
      data: { qcStatus: "PASSED" },
    });
    await expect(
      prisma.$transaction((tx) => cancelGRN(tx, stores, grn.id)),
    ).rejects.toBeInstanceOf(GrnValidationError);

    // A still-PENDING GRN whose hold stock was drained elsewhere cannot be reversed (negative).
    const { po: po2, line: l2 } = await openPO("50");
    const grn2 = await prisma.$transaction((tx) =>
      createGRN(tx, stores, {
        poId: po2.id,
        lines: [{ poLineId: l2.id, itemId: ldpeId, qtyReceived: "50" }],
      }),
    );
    // Drain the hold location directly (as a QC move would).
    const { post } = await import("../lib/stock-ledger.js");
    const heldNow = (await heldBulkBalance(prisma, companyId, ldpeId)).toString();
    await prisma.$transaction((tx) =>
      post(tx, {
        grain: "BULK",
        direction: "OUT",
        companyId,
        itemId: ldpeId,
        locationId: holdLocId,
        qtyBase: heldNow,
        reason: "ADJUSTMENT",
        actorUserId: stores.userId,
      }),
    );
    await expect(
      prisma.$transaction((tx) => cancelGRN(tx, stores, grn2.id)),
    ).rejects.toBeInstanceOf(StockError);
  });

  it("requires a QC-hold location and denies a non-stores actor", async () => {
    const { po, line } = await openPO("10");
    await expect(
      prisma.$transaction((tx) =>
        createGRN(tx, sales, {
          poId: po.id,
          lines: [{ poLineId: line.id, itemId: ldpeId, qtyReceived: "10" }],
        }),
      ),
    ).rejects.toBeInstanceOf(AuthzError);

    // A company with no QC-hold location is rejected.
    const c2 = await prisma.company.create({ data: { name: `NoHold ${Date.now()}` } });
    const u2 = await prisma.user.create({
      data: {
        companyId: c2.id,
        email: `x-${Date.now()}@t.local`,
        name: "X",
        passwordHash: "x",
        role: "STORES",
      },
    });
    const it2 = await prisma.item.create({
      data: {
        companyId: c2.id,
        code: `I-${Date.now()}`,
        name: "I",
        type: "RAW_MATERIAL",
        uomBase: "KG",
      },
    });
    await expect(
      prisma.$transaction((tx) =>
        createGRN(
          tx,
          { userId: u2.id, companyId: c2.id, role: "STORES" },
          {
            lines: [{ itemId: it2.id, qtyReceived: "5" }],
          },
        ),
      ),
    ).rejects.toBeInstanceOf(GrnValidationError);
  });
});
