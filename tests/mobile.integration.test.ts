import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  applyMobileSubmission,
  mobileCatalogueFor,
  MobileSyncError,
} from "../lib/mobile/mobile.js";
import { AuthzError, type Actor } from "../lib/rbac.js";

const suite = process.env.DATABASE_URL ? describe : describe.skip;

suite("mobile order-taking (integration)", () => {
  let prisma: PrismaClient;
  let companyId: string;
  let sales: Actor;
  let viewer: Actor;
  let goodCustomerId: string; // high credit limit
  let goodShipToId: string;
  let cashCustomerId: string; // zero credit limit → cash
  let cashShipToId: string;
  let itemId: string; // FG with a ₹100/m² list price
  let seq = 0;

  const cri = () => `crq-${Date.now()}-${++seq}`;

  beforeAll(async () => {
    prisma = new PrismaClient();
    const company = await prisma.company.create({
      data: { name: `MO Co ${Date.now()}`, gstin: "27AABCE1234F1Z5" },
    });
    companyId = company.id;
    const sa = await prisma.user.create({
      data: {
        companyId,
        email: `mo-sa-${Date.now()}@t.local`,
        name: "Sa",
        passwordHash: "x",
        role: "SALES",
      },
    });
    sales = { userId: sa.id, companyId, role: "SALES" };
    viewer = { userId: sa.id, companyId, role: "VIEWER" };

    const good = await prisma.customer.create({
      data: {
        companyId,
        code: `G-${Date.now()}`,
        name: "Good Credit Co",
        creditLimit: "1000000",
      },
    });
    goodCustomerId = good.id;
    goodShipToId = (
      await prisma.shipToAddress.create({
        data: { customerId: good.id, label: "Main", gstStateCode: "27", isDefault: true },
      })
    ).id;

    const cash = await prisma.customer.create({
      data: {
        companyId,
        code: `K-${Date.now()}`,
        name: "Cash Only Co",
        creditLimit: "0",
      },
    });
    cashCustomerId = cash.id;
    cashShipToId = (
      await prisma.shipToAddress.create({
        data: { customerId: cash.id, label: "Main", gstStateCode: "27", isDefault: true },
      })
    ).id;

    itemId = (
      await prisma.item.create({
        data: {
          companyId,
          code: `FG-${Date.now()}`,
          name: "EPE 3mm",
          type: "FINISHED_GOOD",
          uomBase: "M2",
          gstRatePct: "18",
          listPricePaise: 10000n, // ₹100/m²
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("is idempotent — the same clientRequestId yields one SO and identical results", async () => {
    const clientRequestId = cri();
    const input = {
      clientRequestId,
      customerId: goodCustomerId,
      shipToId: goodShipToId,
      lines: [{ itemId, qtyOrdered: "10", uom: "M2" }],
    };
    const first = await prisma.$transaction((tx) =>
      applyMobileSubmission(tx, sales, input),
    );
    const second = await prisma.$transaction((tx) =>
      applyMobileSubmission(tx, sales, input),
    );

    expect(first.soId).toBeTruthy();
    expect(second.soId).toBe(first.soId);
    expect(second.status).toBe("APPLIED");
    expect(
      await prisma.orderDraftSubmission.count({ where: { companyId, clientRequestId } }),
    ).toBe(1);
    expect(await prisma.salesOrder.count({ where: { id: first.soId! } })).toBe(1);
  });

  it("re-prices on the server (device price is advisory), reports a delta, and the SO uses the server price", async () => {
    const res = await prisma.$transaction((tx) =>
      applyMobileSubmission(tx, sales, {
        clientRequestId: cri(),
        customerId: goodCustomerId,
        shipToId: goodShipToId,
        // device thought ₹95 but the list price is ₹100 → server wins.
        lines: [{ itemId, qtyOrdered: "10", uom: "M2", devicePricePaise: 9500n }],
      }),
    );
    expect(res.priceDelta).toEqual([
      { itemId, devicePricePaise: "9500", serverPricePaise: "10000" },
    ]);
    const so = await prisma.salesOrder.findUniqueOrThrow({
      where: { id: res.soId! },
      include: { lines: true },
    });
    expect(so.lines[0]!.ratePaise).toBe(10000n); // server price, not the device's 9500
    expect(so.source).toBe("MOBILE");
    expect(so.status).toBe("CONFIRMED"); // within the generous credit limit
  });

  it("a credit-over-limit order syncs as a DRAFT SO (blocked), never auto-confirmed", async () => {
    const res = await prisma.$transaction((tx) =>
      applyMobileSubmission(tx, sales, {
        clientRequestId: cri(),
        customerId: cashCustomerId, // zero limit → any exposure blocks
        shipToId: cashShipToId,
        lines: [{ itemId, qtyOrdered: "10", uom: "M2" }],
      }),
    );
    expect(res.soStatus).toBe("DRAFT");
    expect(res.creditStatus).toBe("BLOCKED");
    const so = await prisma.salesOrder.findUniqueOrThrow({ where: { id: res.soId! } });
    expect(so.status).toBe("DRAFT");
    expect(so.source).toBe("MOBILE");
  });

  it("the catalogue projection carries prices but no cost/margin (safe to ship to a device)", async () => {
    const cat = await mobileCatalogueFor(prisma, sales, goodCustomerId);
    expect(cat.customerName).toBe("Good Credit Co");
    expect(cat.shipTos.length).toBeGreaterThan(0);
    const line = cat.lines.find((l) => l.itemId === itemId)!;
    expect(line.ratePaise).toBe("10000");
    expect(line.priceSource).toBe("LIST");
    // No cost/margin keys leak into the device projection.
    const keys = Object.keys(line);
    expect(keys).not.toContain("costPaise");
    expect(keys).not.toContain("unitCostPaise");
    expect(keys).not.toContain("marginPaise");
    // It is a read (SALES read) — a VIEWER may read it, but writing an order is SALES-write
    // (asserted below); the point is the projection is cost-free and safe to cache on a device.
    const asViewer = await mobileCatalogueFor(prisma, viewer, goodCustomerId);
    expect(Object.keys(asViewer.lines[0] ?? {})).not.toContain("unitCostPaise");
  });

  it("rejects an empty order and denies a non-SALES actor from applying", async () => {
    await expect(
      prisma.$transaction((tx) =>
        applyMobileSubmission(tx, sales, {
          clientRequestId: cri(),
          customerId: goodCustomerId,
          shipToId: goodShipToId,
          lines: [],
        }),
      ),
    ).rejects.toBeInstanceOf(MobileSyncError);

    await expect(
      prisma.$transaction((tx) =>
        applyMobileSubmission(tx, viewer, {
          clientRequestId: cri(),
          customerId: goodCustomerId,
          shipToId: goodShipToId,
          lines: [{ itemId, qtyOrdered: "1", uom: "M2" }],
        }),
      ),
    ).rejects.toBeInstanceOf(AuthzError);
  });
});
