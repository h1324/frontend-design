import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { receiveRoll } from "../lib/stock-ledger.js";
import {
  createSO,
  confirmSO,
  overrideCredit,
  allocateSO,
  fulfilSalesOrder,
  cancelSO,
  recomputeTier,
  SalesOrderValidationError,
} from "../lib/sales-order.js";
import { AuthzError, type Actor } from "../lib/rbac.js";
import type { Dimensions } from "../lib/uom.js";

const suite = process.env.DATABASE_URL ? describe : describe.skip;

suite("sales orders & credit (integration)", () => {
  let prisma: PrismaClient;
  let companyId: string;
  let sales: Actor;
  let accounts: Actor;
  let itemId: string;
  let customerId: string;
  let shipToId: string;
  let locationId: string;
  let userId: string;

  // 100m × 2m × 3mm × 25 kg/m³ → 200 m² per roll.
  const dims: Dimensions = {
    length_m: "100",
    width_m: "2",
    layers: [{ thickness_mm: "3", density_kg_m3: "25" }],
  };

  beforeAll(async () => {
    prisma = new PrismaClient();
    const company = await prisma.company.create({
      data: {
        name: `SO Co ${Date.now()}`,
        gstin: "27AABCE1234F1Z5",
        defaultAgingDays: 3,
      },
    });
    companyId = company.id;
    const salesUser = await prisma.user.create({
      data: {
        companyId,
        email: `so-sa-${Date.now()}@t.local`,
        name: "Sa",
        passwordHash: "x",
        role: "SALES",
      },
    });
    const acctUser = await prisma.user.create({
      data: {
        companyId,
        email: `so-ac-${Date.now()}@t.local`,
        name: "Ac",
        passwordHash: "x",
        role: "ACCOUNTS",
      },
    });
    userId = salesUser.id;
    sales = { userId: salesUser.id, companyId, role: "SALES" };
    accounts = { userId: acctUser.id, companyId, role: "ACCOUNTS" };
    itemId = (
      await prisma.item.create({
        data: {
          companyId,
          code: `FG-${Date.now()}`,
          name: "EPE Sheet",
          type: "FINISHED_GOOD",
          uomBase: "M2",
          gstRatePct: "18",
          agingDays: 3,
        },
      })
    ).id;
    locationId = (
      await prisma.location.create({
        data: { companyId, code: `L-${Date.now()}`, name: "Store" },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function makeCustomer(creditLimit: string) {
    const customer = await prisma.customer.create({
      data: {
        companyId,
        code: `C-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: "Acme",
        creditLimit,
      },
    });
    const shipTo = await prisma.shipToAddress.create({
      data: {
        customerId: customer.id,
        label: "Main",
        gstStateCode: "27",
        isDefault: true,
      },
    });
    return { customerId: customer.id, shipToId: shipTo.id };
  }

  async function availableRoll() {
    const { roll } = await prisma.$transaction((tx) =>
      receiveRoll(tx, {
        companyId,
        itemId,
        locationId,
        dimensions: dims,
        actualKg: "15",
        initialState: "AVAILABLE",
        actorUserId: userId,
      }),
    );
    return roll;
  }

  it("confirms within the credit limit, allocates and fulfils a dispatch", async () => {
    const c = await makeCustomer("20000"); // ₹20,000 limit
    customerId = c.customerId;
    shipToId = c.shipToId;
    const roll = await availableRoll(); // 200 m²

    const so = await prisma.$transaction((tx) =>
      createSO(tx, sales, {
        customerId,
        shipToId,
        lines: [
          { itemId, qtyOrdered: "200", uom: "M2", ratePaise: 5000, gstRatePct: "18" },
        ],
      }),
    );
    expect(so.docNo).toMatch(/^SO\/\d{4}-\d{2}\/\d{6}$/);
    expect(so.status).toBe("DRAFT");

    // order total = 200*5000 + 18% = 11,80,000 paise < 20,00,000 limit → OK
    const res = await prisma.$transaction((tx) => confirmSO(tx, sales, so.id));
    expect(res.creditStatus).toBe("OK");
    expect(res.order.status).toBe("CONFIRMED");

    await prisma.$transaction((tx) => allocateSO(tx, sales, so.id, [roll.id]));
    expect((await prisma.roll.findUniqueOrThrow({ where: { id: roll.id } })).state).toBe(
      "ALLOCATED",
    );

    const note = await prisma.$transaction((tx) =>
      fulfilSalesOrder(tx, sales, so.id, { rollIds: [roll.id] }),
    );
    expect(note.salesOrderId).toBe(so.id);
    expect(note.docNo).toMatch(/^DN\/\d{4}-\d{2}\/\d{6}$/);

    const after = await prisma.salesOrder.findUniqueOrThrow({
      where: { id: so.id },
      include: { lines: true },
    });
    expect(after.status).toBe("FULFILLED");
    expect(after.lines[0]!.qtyFulfilled.toString()).toBe("200");
    // roll is on the note, ready to invoice via S13.
    expect(
      await prisma.dispatchRoll.count({
        where: { dispatchNoteId: note.id, rollId: roll.id },
      }),
    ).toBe(1);
  });

  it("blocks over the limit; only ACCOUNTS/ADMIN can override with a reason", async () => {
    const c = await makeCustomer("5000"); // ₹5,000 limit — order of ₹11,800 exceeds it
    const so = await prisma.$transaction((tx) =>
      createSO(tx, sales, {
        customerId: c.customerId,
        shipToId: c.shipToId,
        lines: [
          { itemId, qtyOrdered: "200", uom: "M2", ratePaise: 5000, gstRatePct: "18" },
        ],
      }),
    );
    const res = await prisma.$transaction((tx) => confirmSO(tx, sales, so.id));
    expect(res.creditStatus).toBe("BLOCKED");
    expect(res.order.status).toBe("DRAFT"); // not confirmed

    // A SALES user may not override.
    await expect(
      prisma.$transaction((tx) => overrideCredit(tx, sales, so.id, "manager approved")),
    ).rejects.toBeInstanceOf(AuthzError);

    // Override needs a reason.
    await expect(
      prisma.$transaction((tx) => overrideCredit(tx, accounts, so.id, "  ")),
    ).rejects.toBeInstanceOf(SalesOrderValidationError);

    const overridden = await prisma.$transaction((tx) =>
      overrideCredit(tx, accounts, so.id, "advance received, cleared by accounts"),
    );
    expect(overridden.creditStatus).toBe("OVERRIDDEN");
    expect(overridden.status).toBe("CONFIRMED");
    expect(overridden.creditOverrideById).toBe(accounts.userId);
  });

  it("prevents over-fulfilment beyond the ordered quantity", async () => {
    const c = await makeCustomer("50000");
    const roll = await availableRoll(); // 200 m²
    const so = await prisma.$transaction((tx) =>
      createSO(tx, sales, {
        customerId: c.customerId,
        shipToId: c.shipToId,
        lines: [
          { itemId, qtyOrdered: "100", uom: "M2", ratePaise: 5000, gstRatePct: "18" },
        ], // only 100 ordered
      }),
    );
    await prisma.$transaction((tx) => confirmSO(tx, sales, so.id));
    await prisma.$transaction((tx) => allocateSO(tx, sales, so.id, [roll.id]));
    // shipping a 200 m² roll against a 100 m² line over-fulfils.
    await expect(
      prisma.$transaction((tx) =>
        fulfilSalesOrder(tx, sales, so.id, { rollIds: [roll.id] }),
      ),
    ).rejects.toBeInstanceOf(SalesOrderValidationError);
  });

  it("cancelling releases reserved rolls and keeps the number", async () => {
    const c = await makeCustomer("50000");
    const roll = await availableRoll();
    const so = await prisma.$transaction((tx) =>
      createSO(tx, sales, {
        customerId: c.customerId,
        shipToId: c.shipToId,
        lines: [
          { itemId, qtyOrdered: "200", uom: "M2", ratePaise: 5000, gstRatePct: "18" },
        ],
      }),
    );
    await prisma.$transaction((tx) => confirmSO(tx, sales, so.id));
    await prisma.$transaction((tx) => allocateSO(tx, sales, so.id, [roll.id]));
    expect((await prisma.roll.findUniqueOrThrow({ where: { id: roll.id } })).state).toBe(
      "ALLOCATED",
    );

    const cancelled = await prisma.$transaction((tx) => cancelSO(tx, sales, so.id));
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.docNo).toBe(so.docNo); // number retained
    expect((await prisma.roll.findUniqueOrThrow({ where: { id: roll.id } })).state).toBe(
      "AVAILABLE",
    );
  });

  it("recomputeTier is UNGRADED without enough history", async () => {
    const c = await makeCustomer("50000");
    const tier = await prisma.$transaction((tx) =>
      recomputeTier(tx, sales, c.customerId),
    );
    expect(tier).toBe("UNGRADED");
  });
});
