import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  createPO,
  updatePO,
  closePO,
  cancelPO,
  poBalance,
  PurchaseValidationError,
} from "../lib/purchasing.js";
import { AuthzError, type Actor } from "../lib/rbac.js";

const suite = process.env.DATABASE_URL ? describe : describe.skip;

suite("purchase orders (integration)", () => {
  let prisma: PrismaClient;
  let companyId: string;
  let stores: Actor;
  let sales: Actor;
  let supplierId: string;
  let ldpeId: string;
  let butaneId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    const company = await prisma.company.create({
      data: { name: `PO Co ${Date.now()}` },
    });
    companyId = company.id;
    const storesUser = await prisma.user.create({
      data: {
        companyId,
        email: `st-${Date.now()}@t.local`,
        name: "Stores",
        passwordHash: "x",
        role: "STORES",
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
    stores = { userId: storesUser.id, companyId, role: "STORES" };
    sales = { userId: salesUser.id, companyId, role: "SALES" };
    const supplier = await prisma.supplier.create({
      data: {
        companyId,
        code: `S-${Date.now()}`,
        name: "Reliance Polymers",
        paymentTerms: "30 days",
      },
    });
    supplierId = supplier.id;
    const ldpe = await prisma.item.create({
      data: {
        companyId,
        code: `LDPE-${Date.now()}`,
        name: "LDPE film grade",
        type: "RAW_MATERIAL",
        uomBase: "KG",
      },
    });
    ldpeId = ldpe.id;
    const butane = await prisma.item.create({
      data: {
        companyId,
        code: `BUT-${Date.now()}`,
        name: "Butane",
        type: "RAW_MATERIAL",
        uomBase: "KG",
      },
    });
    butaneId = butane.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const seq = (docNo: string) => Number(docNo.split("/")[2]);

  it("creates a PO with a gapless number; lines default uom/terms; commitment computed", async () => {
    const po = await prisma.$transaction((tx) =>
      createPO(tx, stores, {
        supplierId,
        lines: [
          { itemId: ldpeId, qtyOrdered: "2000", ratePaise: 8500 },
          { itemId: butaneId, qtyOrdered: "500", ratePaise: 12000 },
        ],
      }),
    );
    expect(po.docNo).toMatch(/^PO\/\d{4}-\d{2}\/\d{6}$/);
    expect(po.status).toBe("OPEN");
    expect(po.paymentTerms).toBe("30 days"); // defaulted from supplier

    const lines = await prisma.purchaseOrderLine.findMany({ where: { poId: po.id } });
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => l.uom === "KG")).toBe(true); // defaulted from item base UOM

    const bal = await poBalance(prisma, po.id);
    expect(bal.commitmentPaise).toBe(23_000_000); // 2000×8500 + 500×12000
    expect(bal.fullyReceived).toBe(false);

    // gapless: a second PO increments the sequence
    const po2 = await prisma.$transaction((tx) =>
      createPO(tx, stores, {
        supplierId,
        lines: [{ itemId: ldpeId, qtyOrdered: "10", ratePaise: 8500 }],
      }),
    );
    expect(seq(po2.docNo)).toBe(seq(po.docNo) + 1);
  });

  it("denies a non-stores actor and rejects an empty PO", async () => {
    await expect(
      prisma.$transaction((tx) =>
        createPO(tx, sales, {
          supplierId,
          lines: [{ itemId: ldpeId, qtyOrdered: "1", ratePaise: 1 }],
        }),
      ),
    ).rejects.toBeInstanceOf(AuthzError);
    await expect(
      prisma.$transaction((tx) => createPO(tx, stores, { supplierId, lines: [] })),
    ).rejects.toBeInstanceOf(PurchaseValidationError);
  });

  it("amends a DRAFT PO's lines and releases it; refuses line edits after receipt", async () => {
    const po = await prisma.$transaction((tx) =>
      createPO(tx, stores, {
        supplierId,
        status: "DRAFT",
        lines: [{ itemId: ldpeId, qtyOrdered: "100", ratePaise: 8000 }],
      }),
    );
    const released = await prisma.$transaction((tx) =>
      updatePO(tx, stores, po.id, {
        notes: "urgent",
        lines: [{ itemId: ldpeId, qtyOrdered: "150", ratePaise: 8200 }],
        release: true,
      }),
    );
    expect(released.status).toBe("OPEN");
    expect(released.notes).toBe("urgent");
    const lines = await prisma.purchaseOrderLine.findMany({ where: { poId: po.id } });
    expect(lines).toHaveLength(1);
    expect(lines[0]?.qtyOrdered.toString()).toBe("150");

    // Simulate a receipt (S15 will do this) and then line edits are refused.
    await prisma.purchaseOrderLine.update({
      where: { id: lines[0]!.id },
      data: { qtyReceived: "50" },
    });
    await expect(
      prisma.$transaction((tx) =>
        updatePO(tx, stores, po.id, {
          lines: [{ itemId: ldpeId, qtyOrdered: "200", ratePaise: 8000 }],
        }),
      ),
    ).rejects.toBeInstanceOf(PurchaseValidationError);
  });

  it("short-close requires a reason; full receipt closes cleanly", async () => {
    const po = await prisma.$transaction((tx) =>
      createPO(tx, stores, {
        supplierId,
        lines: [{ itemId: ldpeId, qtyOrdered: "100", ratePaise: 8000 }],
      }),
    );
    const line = await prisma.purchaseOrderLine.findFirstOrThrow({
      where: { poId: po.id },
    });

    // Not fully received → close without a reason is refused.
    await expect(
      prisma.$transaction((tx) => closePO(tx, stores, po.id)),
    ).rejects.toBeInstanceOf(PurchaseValidationError);

    // With a reason → short-closed.
    const short = await prisma.$transaction((tx) =>
      closePO(tx, stores, po.id, "supplier could not deliver balance"),
    );
    expect(short.status).toBe("CLOSED");
    expect(short.closeReason).toBe("supplier could not deliver balance");

    // A fully-received PO closes without a reason.
    const po2 = await prisma.$transaction((tx) =>
      createPO(tx, stores, {
        supplierId,
        lines: [{ itemId: ldpeId, qtyOrdered: "40", ratePaise: 8000 }],
      }),
    );
    const l2 = await prisma.purchaseOrderLine.findFirstOrThrow({
      where: { poId: po2.id },
    });
    await prisma.purchaseOrderLine.update({
      where: { id: l2.id },
      data: { qtyReceived: "40" },
    });
    const closed = await prisma.$transaction((tx) => closePO(tx, stores, po2.id));
    expect(closed.status).toBe("CLOSED");
    expect(closed.closeReason).toBeNull();
    void line;
  });

  it("cancels an unreceived PO (keeps its number); refuses once goods are received", async () => {
    const po = await prisma.$transaction((tx) =>
      createPO(tx, stores, {
        supplierId,
        lines: [{ itemId: ldpeId, qtyOrdered: "10", ratePaise: 8000 }],
      }),
    );
    const cancelled = await prisma.$transaction((tx) => cancelPO(tx, stores, po.id));
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.docNo).toBe(po.docNo); // number retained

    const po2 = await prisma.$transaction((tx) =>
      createPO(tx, stores, {
        supplierId,
        lines: [{ itemId: ldpeId, qtyOrdered: "10", ratePaise: 8000 }],
      }),
    );
    const l = await prisma.purchaseOrderLine.findFirstOrThrow({
      where: { poId: po2.id },
    });
    await prisma.purchaseOrderLine.update({
      where: { id: l.id },
      data: { qtyReceived: "5" },
    });
    await expect(
      prisma.$transaction((tx) => cancelPO(tx, stores, po2.id)),
    ).rejects.toBeInstanceOf(PurchaseValidationError);
  });
});
