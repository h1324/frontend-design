import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  resolvePrice,
  resolveOrderDiscount,
  createQuotation,
  sendQuotation,
  winQuotation,
  convertToSalesOrder,
  overrideMargin,
  upsertPriceContract,
  upsertValueDiscountTier,
  cancelPriceContract,
  QuotationError,
} from "../lib/pricing.js";
import { AuthzError, type Actor } from "../lib/rbac.js";

const suite = process.env.DATABASE_URL ? describe : describe.skip;

suite("quotations & price contracts (integration)", () => {
  let prisma: PrismaClient;
  let companyId: string;
  let sales: Actor;
  let accounts: Actor;
  let customerId: string; // tier A
  let shipToId: string;
  let itemId: string; // FG sold by M2, has a list price
  let seq = 0;

  beforeAll(async () => {
    prisma = new PrismaClient();
    const company = await prisma.company.create({
      data: { name: `PR Co ${Date.now()}`, gstin: "27AABCE1234F1Z5" },
    });
    companyId = company.id;
    const sa = await prisma.user.create({
      data: {
        companyId,
        email: `pr-sa-${Date.now()}@t.local`,
        name: "Sa",
        passwordHash: "x",
        role: "SALES",
      },
    });
    const ac = await prisma.user.create({
      data: {
        companyId,
        email: `pr-ac-${Date.now()}@t.local`,
        name: "Ac",
        passwordHash: "x",
        role: "ACCOUNTS",
      },
    });
    sales = { userId: sa.id, companyId, role: "SALES" };
    accounts = { userId: ac.id, companyId, role: "ACCOUNTS" };
    const customer = await prisma.customer.create({
      data: { companyId, code: `C-${Date.now()}`, name: "Acme Foam", tier: "A" },
    });
    customerId = customer.id;
    shipToId = (
      await prisma.shipToAddress.create({
        data: {
          customerId: customer.id,
          label: "M",
          gstStateCode: "27",
          isDefault: true,
        },
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

  it("resolves customer > tier > list, honouring bands and validity", async () => {
    // Tier A contract: ₹95 from qty 0, ₹90 from qty 1000.
    await prisma.$transaction((tx) =>
      upsertPriceContract(tx, sales, {
        scope: "TIER",
        tier: "A",
        lines: [
          { itemId, minQty: "0", ratePaise: 9500, gstRatePct: "18" },
          { itemId, minQty: "1000", ratePaise: 9000, gstRatePct: "18" },
        ],
      }),
    );

    // No customer contract yet → tier applies; band by qty.
    expect(
      (await resolvePrice(prisma, companyId, { customerId, itemId, qty: "100" }))
        ?.ratePaise,
    ).toBe(9500n);
    expect(
      (await resolvePrice(prisma, companyId, { customerId, itemId, qty: "1500" }))
        ?.ratePaise,
    ).toBe(9000n);

    // Customer-specific contract beats the tier.
    await prisma.$transaction((tx) =>
      upsertPriceContract(tx, sales, {
        scope: "CUSTOMER",
        customerId,
        lines: [{ itemId, minQty: "0", ratePaise: 9200, gstRatePct: "18" }],
      }),
    );
    const hit = await resolvePrice(prisma, companyId, { customerId, itemId, qty: "100" });
    expect(hit).toMatchObject({ source: "CUSTOMER", ratePaise: 9200n });

    // An unknown item with no contract and no list price → null.
    const bare = await prisma.item.create({
      data: {
        companyId,
        code: `X-${Date.now()}`,
        name: "bare",
        type: "CONSUMABLE",
        uomBase: "NOS",
      },
    });
    expect(
      await resolvePrice(prisma, companyId, { customerId, itemId: bare.id, qty: "1" }),
    ).toBeNull();
  });

  it("resolves the whole-order value discount (customer > tier, highest threshold)", async () => {
    await prisma.$transaction(async (tx) => {
      await upsertValueDiscountTier(tx, sales, {
        scope: "TIER",
        tier: "A",
        minOrderValuePaise: 100_000_00n,
        discountPct: "3",
      });
      await upsertValueDiscountTier(tx, sales, {
        scope: "CUSTOMER",
        customerId,
        minOrderValuePaise: 200_000_00n,
        discountPct: "5",
      });
    });
    // ₹1.5L clears only the tier 1L threshold → 3%.
    expect(
      (
        await resolveOrderDiscount(prisma, companyId, {
          customerId,
          orderValuePaise: 150_000_00n,
        })
      )?.discountPct,
    ).toBe("3");
    // ₹2.5L clears the customer 2L threshold → 5% (customer wins).
    expect(
      (
        await resolveOrderDiscount(prisma, companyId, {
          customerId,
          orderValuePaise: 250_000_00n,
        })
      )?.discountPct,
    ).toBe("5");
    // Below every threshold → null (0%).
    expect(
      await resolveOrderDiscount(prisma, companyId, {
        customerId,
        orderValuePaise: 10_000_00n,
      }),
    ).toBeNull();
  });

  it("creates a quote (rate auto-resolved), then wins & converts to a DRAFT SO carrying the discount", async () => {
    // Big enough to clear the customer 2L value tier (5%): 3000 m² × ₹92 = ₹2.76L.
    const q = await prisma.$transaction((tx) =>
      createQuotation(tx, sales, {
        customerId,
        shipToId,
        lines: [{ itemId, qtyQuoted: "3000", uom: "M2" }],
      }),
    );
    const loaded = await prisma.quotation.findUniqueOrThrow({
      where: { id: q.id },
      include: { lines: true },
    });
    expect(loaded.docNo).toMatch(/^QT\//);
    expect(loaded.lines[0]!.ratePaise).toBe(9200n); // customer contract
    expect(loaded.orderDiscountPct.toString()).toBe("5"); // resolved value discount

    await prisma.$transaction((tx) => winQuotation(tx, sales, q.id));
    const so = await prisma.$transaction((tx) => convertToSalesOrder(tx, sales, q.id));

    const soFull = await prisma.salesOrder.findUniqueOrThrow({
      where: { id: so.id },
      include: { lines: true },
    });
    expect(soFull.status).toBe("DRAFT");
    expect(soFull.orderDiscountPct.toString()).toBe("5");
    expect(soFull.lines[0]!.qtyOrdered.toString()).toBe("3000");
    expect(soFull.lines[0]!.ratePaise).toBe(9200n);

    // A second convert of the same quote is refused (create-only).
    await expect(
      prisma.$transaction((tx) => convertToSalesOrder(tx, sales, q.id)),
    ).rejects.toBeInstanceOf(QuotationError);
  });

  it("blocks a below-floor send until an ACCOUNTS/ADMIN margin override is logged", async () => {
    // Give the item a real cost so margin is defined, then quote a manual rate below the floor.
    await prisma.item.update({
      where: { id: itemId },
      data: { movingAvgCostPaise: 9500n },
    });
    const q = await prisma.$transaction((tx) =>
      createQuotation(tx, sales, {
        customerId,
        shipToId,
        lines: [
          { itemId, qtyQuoted: "10", uom: "M2", ratePaise: 10000, gstRatePct: "18" },
        ],
      }),
    );
    // rate 10000, cost 9500 → 5% margin < 10% floor → send refused.
    await expect(
      prisma.$transaction((tx) => sendQuotation(tx, sales, q.id)),
    ).rejects.toBeInstanceOf(QuotationError);

    // SALES cannot override; ACCOUNTS can.
    await expect(
      prisma.$transaction((tx) => overrideMargin(tx, sales, q.id, "strategic account")),
    ).rejects.toBeInstanceOf(AuthzError);
    await prisma.$transaction((tx) =>
      overrideMargin(tx, accounts, q.id, "strategic account"),
    );

    // Now it sends.
    const sent = await prisma.$transaction((tx) => sendQuotation(tx, sales, q.id));
    expect(sent.status).toBe("SENT");
    // reset cost so later tests are unaffected
    await prisma.item.update({ where: { id: itemId }, data: { movingAvgCostPaise: 0n } });
  });

  it("rejects an overlapping active contract for the same scope+item+band, and denies non-SALES", async () => {
    // A fresh tier-B contract, then an overlapping duplicate band is rejected.
    await prisma.$transaction((tx) =>
      upsertPriceContract(tx, sales, {
        scope: "TIER",
        tier: "B",
        lines: [{ itemId, minQty: "0", ratePaise: 9600, gstRatePct: "18" }],
      }),
    );
    await expect(
      prisma.$transaction((tx) =>
        upsertPriceContract(tx, sales, {
          scope: "TIER",
          tier: "B",
          lines: [{ itemId, minQty: "0", ratePaise: 9400, gstRatePct: "18" }],
        }),
      ),
    ).rejects.toBeInstanceOf(QuotationError);

    // A read-only VIEWER cannot write contracts.
    const viewer: Actor = { userId: sales.userId, companyId, role: "VIEWER" };
    await expect(
      prisma.$transaction((tx) =>
        upsertPriceContract(tx, viewer, {
          scope: "TIER",
          tier: "C",
          lines: [{ itemId, minQty: "0", ratePaise: 9000, gstRatePct: "18" }],
        }),
      ),
    ).rejects.toBeInstanceOf(AuthzError);
  });

  it("cancels a contract keeping it out of resolution", async () => {
    const pc = await prisma.$transaction((tx) =>
      upsertPriceContract(tx, sales, {
        scope: "TIER",
        tier: "UNGRADED",
        lines: [{ itemId, minQty: "0", ratePaise: 7777, gstRatePct: "18" }],
      }),
    );
    const ungraded = await prisma.customer.create({
      data: {
        companyId,
        code: `U-${++seq}-${Date.now()}`,
        name: "Ungraded Co",
        tier: "UNGRADED",
      },
    });
    expect(
      (
        await resolvePrice(prisma, companyId, {
          customerId: ungraded.id,
          itemId,
          qty: "1",
        })
      )?.ratePaise,
    ).toBe(7777n);
    await prisma.$transaction((tx) => cancelPriceContract(tx, sales, pc.id));
    // Falls back to the item list price now that the contract is cancelled.
    expect(
      (
        await resolvePrice(prisma, companyId, {
          customerId: ungraded.id,
          itemId,
          qty: "1",
        })
      )?.source,
    ).toBe("LIST");
  });
});
