import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  createReceipt,
  cancelReceipt,
  createIssue,
  cancelIssue,
  StoresValidationError,
} from "../lib/rm-stores.js";
import { itemBalance, StockError } from "../lib/stock-ledger.js";
import { AuthzError, type Actor } from "../lib/rbac.js";

const suite = process.env.DATABASE_URL ? describe : describe.skip;

suite("RM stores (integration)", () => {
  let prisma: PrismaClient;
  let companyId: string;
  let stores: Actor;
  let sales: Actor;
  let ldpeId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    const company = await prisma.company.create({
      data: { name: `Stores Co ${Date.now()}` },
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
    const ldpe = await prisma.item.create({
      data: {
        companyId,
        code: "LDPE-1",
        name: "LDPE",
        type: "RAW_MATERIAL",
        uomBase: "KG",
      },
    });
    ldpeId = ldpe.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function freshLocation(): Promise<string> {
    const l = await prisma.location.create({
      data: { companyId, name: "Store", code: `L-${crypto.randomUUID()}` },
    });
    return l.id;
  }
  const bal = (loc: string) => itemBalance(prisma, companyId, ldpeId, loc);

  it("a receipt raises the item balance and persists lines with a ledger link", async () => {
    const loc = await freshLocation();
    const receipt = await prisma.$transaction((tx) =>
      createReceipt(tx, stores, {
        lines: [{ itemId: ldpeId, locationId: loc, qtyBase: "1000", ratePaise: 8500 }],
      }),
    );
    expect(receipt.docNo).toMatch(/^RCPT\/\d{4}-\d{2}\/\d{6}$/);
    expect((await bal(loc)).toString()).toBe("1000");
    const lines = await prisma.materialReceiptLine.findMany({
      where: { receiptId: receipt.id },
    });
    expect(lines[0]?.ledgerId).toBeTruthy();
    expect(lines[0]?.ratePaise).toBe(8500);
  });

  it("an issue lowers the balance; issuing more than stock is rejected and leaves it unchanged", async () => {
    const loc = await freshLocation();
    await prisma.$transaction((tx) =>
      createReceipt(tx, stores, {
        lines: [{ itemId: ldpeId, locationId: loc, qtyBase: "500" }],
      }),
    );
    await prisma.$transaction((tx) =>
      createIssue(tx, stores, {
        lines: [{ itemId: ldpeId, locationId: loc, qtyBase: "200", isRegrind: false }],
      }),
    );
    expect((await bal(loc)).toString()).toBe("300");

    await expect(
      prisma.$transaction((tx) =>
        createIssue(tx, stores, {
          lines: [{ itemId: ldpeId, locationId: loc, qtyBase: "1000" }],
        }),
      ),
    ).rejects.toBeInstanceOf(StockError);
    expect((await bal(loc)).toString()).toBe("300"); // untouched by the rejected issue
  });

  it("cancelling a receipt reverses its stock; cancelling one whose stock is consumed is refused", async () => {
    const loc = await freshLocation();
    const receipt = await prisma.$transaction((tx) =>
      createReceipt(tx, stores, {
        lines: [{ itemId: ldpeId, locationId: loc, qtyBase: "100" }],
      }),
    );
    expect((await bal(loc)).toString()).toBe("100");
    await prisma.$transaction((tx) => cancelReceipt(tx, stores, receipt.id));
    expect((await bal(loc)).toString()).toBe("0");
    expect(
      (await prisma.materialReceipt.findUniqueOrThrow({ where: { id: receipt.id } }))
        .status,
    ).toBe("CANCELLED");

    // A second receipt, then issue it all out, then try to cancel → refused (would go negative)
    const r2 = await prisma.$transaction((tx) =>
      createReceipt(tx, stores, {
        lines: [{ itemId: ldpeId, locationId: loc, qtyBase: "50" }],
      }),
    );
    await prisma.$transaction((tx) =>
      createIssue(tx, stores, {
        lines: [{ itemId: ldpeId, locationId: loc, qtyBase: "50" }],
      }),
    );
    await expect(
      prisma.$transaction((tx) => cancelReceipt(tx, stores, r2.id)),
    ).rejects.toBeInstanceOf(StockError);
  });

  it("cancelling an issue adds the material back", async () => {
    const loc = await freshLocation();
    await prisma.$transaction((tx) =>
      createReceipt(tx, stores, {
        lines: [{ itemId: ldpeId, locationId: loc, qtyBase: "80" }],
      }),
    );
    const issue = await prisma.$transaction((tx) =>
      createIssue(tx, stores, {
        lines: [{ itemId: ldpeId, locationId: loc, qtyBase: "30", isRegrind: true }],
      }),
    );
    expect((await bal(loc)).toString()).toBe("50");
    // regrind flag persisted
    const line = await prisma.materialIssueLine.findFirstOrThrow({
      where: { issueId: issue.id },
    });
    expect(line.isRegrind).toBe(true);

    await prisma.$transaction((tx) => cancelIssue(tx, stores, issue.id));
    expect((await bal(loc)).toString()).toBe("80");
  });

  it("denies a non-stores actor (SALES) and rejects an empty receipt", async () => {
    const loc = await freshLocation();
    await expect(
      prisma.$transaction((tx) =>
        createReceipt(tx, sales, {
          lines: [{ itemId: ldpeId, locationId: loc, qtyBase: "1" }],
        }),
      ),
    ).rejects.toBeInstanceOf(AuthzError);

    await expect(
      prisma.$transaction((tx) => createReceipt(tx, stores, { lines: [] })),
    ).rejects.toBeInstanceOf(StoresValidationError);
  });
});
