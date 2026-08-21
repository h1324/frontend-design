// Stress test for the append-only stock ledger (CLAUDE.md rules 2 & 6): at volume, the derived
// balance must reconcile to sum(IN) − sum(OUT) with zero drift (the failure mode floating-point
// maths would cause), and the ledger must remain immutable — UPDATE and DELETE rejected by the
// DB trigger. Gated on DATABASE_URL like the other integration tests; skipped without a DB.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { Decimal } from "../lib/decimal.js";
import { post } from "../lib/stock-ledger.js";

const suite = process.env.DATABASE_URL ? describe : describe.skip;

// How many random movements to push. Kept modest so the suite stays fast; still far more than a
// foam plant generates in a day, and enough that any per-row drift would compound and be caught.
const N = 1500;

suite("stock ledger — stress & append-only (integration)", () => {
  let prisma: PrismaClient;
  let companyId: string;
  let itemId: string;
  let locationId: string;
  let expected: Decimal;

  beforeAll(async () => {
    prisma = new PrismaClient();
    const company = await prisma.company.create({
      data: { name: `Stress Co ${Date.now()}` },
    });
    companyId = company.id;
    itemId = (
      await prisma.item.create({
        data: {
          companyId,
          code: `STRESS-${Date.now()}`,
          name: "Stress RM",
          type: "RAW_MATERIAL",
          uomBase: "KG",
        },
      })
    ).id;
    locationId = (
      await prisma.location.create({
        data: { companyId, name: "Stress Store", code: `SS-${Date.now()}` },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it(`reconciles the balance across ${N} random movements and stays append-only`, async () => {
    // Large opening receipt so random OUTs never underflow the balance.
    expected = new Decimal("1000000");
    await prisma.$transaction((tx) =>
      post(tx, {
        grain: "BULK",
        direction: "IN",
        companyId,
        reason: "GRN",
        itemId,
        locationId,
        qtyBase: expected.toString(),
      }),
    );

    for (let i = 0; i < N; i++) {
      const isIn = Math.random() < 0.5;
      const qty = String(1 + Math.floor(Math.random() * 50)); // 1..50 kg
      await prisma.$transaction((tx) =>
        post(tx, {
          grain: "BULK",
          direction: isIn ? "IN" : "OUT",
          companyId,
          reason: isIn ? "GRN" : "DISPATCH",
          itemId,
          locationId,
          qtyBase: qty,
        }),
      );
      expected = isIn ? expected.plus(qty) : expected.minus(qty);
    }

    // Derived balance must equal sum(IN) − sum(OUT), exactly — no floating-point drift.
    const bal = await prisma.stockBalance.findFirst({
      where: { companyId, itemId, locationId },
    });
    expect(bal!.qtyBase.toString()).toBe(expected.toString());

    // Every movement produced exactly one immutable ledger row (opening + N).
    const ledgerCount = await prisma.stockLedger.count({ where: { companyId } });
    expect(ledgerCount).toBe(N + 1);

    // Append-only: a direct UPDATE or DELETE must be rejected by the DB trigger.
    const row = await prisma.stockLedger.findFirst({ where: { companyId } });
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE "StockLedger" SET "qtyBase" = 999 WHERE id = $1`,
        row!.id,
      ),
    ).rejects.toThrow();
    await expect(
      prisma.$executeRawUnsafe(`DELETE FROM "StockLedger" WHERE id = $1`, row!.id),
    ).rejects.toThrow();

    // The rejected UPDATE must not have changed the value.
    const after = await prisma.stockLedger.findUnique({ where: { id: row!.id } });
    expect(after!.qtyBase.toString()).toBe(row!.qtyBase.toString());
  }, 120_000);

  it("refuses an OUT that would drive the balance negative", async () => {
    // Fresh item with no stock; an OUT must be rejected rather than going negative.
    const emptyItem = await prisma.item.create({
      data: {
        companyId,
        code: `EMPTY-${Date.now()}`,
        name: "Empty RM",
        type: "RAW_MATERIAL",
        uomBase: "KG",
      },
    });
    await expect(
      prisma.$transaction((tx) =>
        post(tx, {
          grain: "BULK",
          direction: "OUT",
          companyId,
          reason: "DISPATCH",
          itemId: emptyItem.id,
          locationId,
          qtyBase: "1",
        }),
      ),
    ).rejects.toThrow();
  });
});
