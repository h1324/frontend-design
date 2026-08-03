import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { receiveRoll } from "../lib/stock-ledger.js";
import {
  printLabel,
  lookupRollByNo,
  labelModelFromRoll,
  RollError,
} from "../lib/rolls.js";
import { AuthzError, type Actor } from "../lib/rbac.js";
import type { Dimensions } from "../lib/uom.js";

const suite = process.env.DATABASE_URL ? describe : describe.skip;

suite("roll registry & labels (integration)", () => {
  let prisma: PrismaClient;
  let companyId: string;
  let prod: Actor;
  let sales: Actor;
  let itemId: string;
  let locationId: string;

  const dims: Dimensions = {
    length_m: "100",
    width_m: "1.2",
    layers: [{ thickness_mm: "3", density_kg_m3: "25" }],
  };

  beforeAll(async () => {
    prisma = new PrismaClient();
    const company = await prisma.company.create({
      data: { name: `Roll Co ${Date.now()}` },
    });
    companyId = company.id;
    const prodUser = await prisma.user.create({
      data: {
        companyId,
        email: `pr-${Date.now()}@t.local`,
        name: "Prod",
        passwordHash: "x",
        role: "PRODUCTION",
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
    prod = { userId: prodUser.id, companyId, role: "PRODUCTION" };
    sales = { userId: salesUser.id, companyId, role: "SALES" };
    const item = await prisma.item.create({
      data: {
        companyId,
        code: `FG-${Date.now()}`,
        name: "EPE 3mm roll",
        type: "FINISHED_GOOD",
        uomBase: "M2",
      },
    });
    itemId = item.id;
    const location = await prisma.location.create({
      data: { companyId, name: "Store", code: `L-${Date.now()}` },
    });
    locationId = location.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function makeRoll(kg: string, at?: Date) {
    return prisma.$transaction((tx) =>
      receiveRoll(tx, {
        companyId,
        itemId,
        locationId,
        dimensions: dims,
        actualKg: kg,
        initialState: "AVAILABLE",
        actorUserId: prod.userId,
        ...(at ? { at } : {}),
      }),
    );
  }

  it("assigns a gapless R<FY>-seq number at creation; two rolls never collide", async () => {
    const at = new Date("2026-08-03T04:00:00.000Z"); // FY 2026-27
    const a = await makeRoll("46", at);
    const b = await makeRoll("47", at);
    expect(a.roll.rollNo).toMatch(/^R2627-\d{6}$/);
    expect(b.roll.rollNo).toMatch(/^R2627-\d{6}$/);
    const seq = (n: string) => Number(n.split("-")[1]);
    expect(seq(b.roll.rollNo)).toBe(seq(a.roll.rollNo) + 1);
    expect(a.roll.rollNo).not.toBe(b.roll.rollNo);
    expect(a.roll.state).toBe("AVAILABLE");
    expect(a.roll.labelPrintCount).toBe(0);
  });

  it("looks a roll up by its number (case-insensitive), returning label data", async () => {
    const { roll } = await makeRoll("48");
    const found = await lookupRollByNo(prisma, companyId, roll.rollNo.toLowerCase());
    expect(found?.id).toBe(roll.id);
    expect(found?.item.code).toBeTruthy();
    // The label model derives from the loaded roll.
    const label = labelModelFromRoll(found!);
    expect(label.rollNo).toBe(roll.rollNo);
    expect(label.thicknessMm).toBe("3");
    expect(label.gsm).toBe("75");
    expect(await lookupRollByNo(prisma, companyId, "R9999-000001")).toBeNull();
  });

  it("printLabel increments the count, stamps the time, and audits it", async () => {
    const { roll } = await makeRoll("49");
    const p1 = await prisma.$transaction((tx) => printLabel(tx, prod, roll.id));
    expect(p1.labelPrintCount).toBe(1);
    expect(p1.labelPrintedAt).not.toBeNull();
    const p2 = await prisma.$transaction((tx) => printLabel(tx, prod, roll.id));
    expect(p2.labelPrintCount).toBe(2);

    const audits = await prisma.auditLog.count({
      where: { entity: "Roll", entityId: roll.id, action: "LABEL_PRINT" },
    });
    expect(audits).toBe(2);
  });

  it("denies a non-production actor and rejects an unknown roll", async () => {
    const { roll } = await makeRoll("50");
    await expect(
      prisma.$transaction((tx) => printLabel(tx, sales, roll.id)),
    ).rejects.toBeInstanceOf(AuthzError);
    await expect(
      prisma.$transaction((tx) => printLabel(tx, prod, "no-such-roll")),
    ).rejects.toBeInstanceOf(RollError);
  });
});
