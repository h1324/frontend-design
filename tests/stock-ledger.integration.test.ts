import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  post,
  reverse,
  receiveRoll,
  allocateRolls,
  itemBalance,
  rollBalance,
  availableRolls,
  StockError,
} from "../lib/stock-ledger.js";

// DB-backed; self-skips without DATABASE_URL (loaded from .env in tests/setup.ts).
const suite = process.env.DATABASE_URL ? describe : describe.skip;

suite("stock ledger (integration)", () => {
  let prisma: PrismaClient;
  let companyId: string;
  let locationId: string;
  let bulkItemId: string; // RAW_MATERIAL (e.g. LDPE), measured in kg
  let foamItemId: string; // FINISHED_GOOD roll

  const PAST = new Date("2020-01-01T00:00:00Z");
  const FUTURE = new Date("2999-01-01T00:00:00Z");

  beforeAll(async () => {
    prisma = new PrismaClient();
    const company = await prisma.company.create({
      data: { name: `Stock Co ${Date.now()}` },
    });
    companyId = company.id;
    const location = await prisma.location.create({
      data: { companyId, name: "Main Store", code: "MAIN" },
    });
    locationId = location.id;
    const bulk = await prisma.item.create({
      data: {
        companyId,
        code: "LDPE-1",
        name: "LDPE resin",
        type: "RAW_MATERIAL",
        uomBase: "KG",
      },
    });
    bulkItemId = bulk.id;
    const foam = await prisma.item.create({
      data: {
        companyId,
        code: "FG-1",
        name: "EPE roll",
        type: "FINISHED_GOOD",
        uomBase: "M2",
      },
    });
    foamItemId = foam.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("bulk balance", () => {
    it("IN then OUT of equal magnitude nets to zero", async () => {
      const loc = await freshLocation();
      await prisma.$transaction((tx) =>
        post(tx, {
          grain: "BULK",
          direction: "IN",
          companyId,
          itemId: bulkItemId,
          locationId: loc,
          qtyBase: "500.25",
          reason: "GRN",
        }),
      );
      await prisma.$transaction((tx) =>
        post(tx, {
          grain: "BULK",
          direction: "OUT",
          companyId,
          itemId: bulkItemId,
          locationId: loc,
          qtyBase: "500.25",
          reason: "PRODUCTION",
        }),
      );
      const bal = await itemBalance(prisma, companyId, bulkItemId, loc);
      expect(bal.toString()).toBe("0");
    });

    it("blocks an OUT that would drive the balance negative", async () => {
      const loc = await freshLocation();
      await prisma.$transaction((tx) =>
        post(tx, {
          grain: "BULK",
          direction: "IN",
          companyId,
          itemId: bulkItemId,
          locationId: loc,
          qtyBase: "10",
          reason: "GRN",
        }),
      );
      await expect(
        prisma.$transaction((tx) =>
          post(tx, {
            grain: "BULK",
            direction: "OUT",
            companyId,
            itemId: bulkItemId,
            locationId: loc,
            qtyBase: "10.001",
            reason: "PRODUCTION",
          }),
        ),
      ).rejects.toBeInstanceOf(StockError);
      // balance untouched by the rejected posting
      expect((await itemBalance(prisma, companyId, bulkItemId, loc)).toString()).toBe(
        "10",
      );
    });

    it("two concurrent OUTs cannot both succeed and drive it negative", async () => {
      const loc = await freshLocation();
      await prisma.$transaction((tx) =>
        post(tx, {
          grain: "BULK",
          direction: "IN",
          companyId,
          itemId: bulkItemId,
          locationId: loc,
          qtyBase: "10",
          reason: "GRN",
        }),
      );
      const out = () =>
        prisma.$transaction((tx) =>
          post(tx, {
            grain: "BULK",
            direction: "OUT",
            companyId,
            itemId: bulkItemId,
            locationId: loc,
            qtyBase: "7",
            reason: "PRODUCTION",
          }),
        );
      const results = await Promise.allSettled([out(), out()]);
      const ok = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.filter((r) => r.status === "rejected").length;
      expect(ok).toBe(1);
      expect(failed).toBe(1);
      expect((await itemBalance(prisma, companyId, bulkItemId, loc)).toString()).toBe(
        "3",
      );
    });
  });

  describe("reversal", () => {
    it("restores the balance and leaves both rows in place (append-only)", async () => {
      const loc = await freshLocation();
      const inEntry = await prisma.$transaction((tx) =>
        post(tx, {
          grain: "BULK",
          direction: "IN",
          companyId,
          itemId: bulkItemId,
          locationId: loc,
          qtyBase: "5",
          reason: "GRN",
        }),
      );
      expect((await itemBalance(prisma, companyId, bulkItemId, loc)).toString()).toBe(
        "5",
      );

      await prisma.$transaction((tx) => reverse(tx, inEntry.id, null, "mis-keyed GRN"));
      expect((await itemBalance(prisma, companyId, bulkItemId, loc)).toString()).toBe(
        "0",
      );

      const rows = await prisma.stockLedger.findMany({
        where: { companyId, itemId: bulkItemId, locationId: loc },
      });
      expect(rows).toHaveLength(2); // original + reversal, nothing deleted
      const reversal = rows.find((r) => r.reason === "REVERSAL");
      expect(reversal?.reversesLedgerId).toBe(inEntry.id);
    });

    it("refuses to reverse the same entry twice", async () => {
      const loc = await freshLocation();
      const inEntry = await prisma.$transaction((tx) =>
        post(tx, {
          grain: "BULK",
          direction: "IN",
          companyId,
          itemId: bulkItemId,
          locationId: loc,
          qtyBase: "5",
          reason: "GRN",
        }),
      );
      await prisma.$transaction((tx) => reverse(tx, inEntry.id, null, "first"));
      await expect(
        prisma.$transaction((tx) => reverse(tx, inEntry.id, null, "second")),
      ).rejects.toBeInstanceOf(StockError);
    });
  });

  describe("append-only journal", () => {
    it("rejects UPDATE and DELETE on StockLedger at the DB level", async () => {
      const loc = await freshLocation();
      const entry = await prisma.$transaction((tx) =>
        post(tx, {
          grain: "BULK",
          direction: "IN",
          companyId,
          itemId: bulkItemId,
          locationId: loc,
          qtyBase: "1",
          reason: "GRN",
        }),
      );
      await expect(
        prisma.stockLedger.update({
          where: { id: entry.id },
          data: { reason: "ADJUSTMENT" },
        }),
      ).rejects.toThrow();
      await expect(
        prisma.stockLedger.delete({ where: { id: entry.id } }),
      ).rejects.toThrow();
    });
  });

  describe("serial rolls", () => {
    it("receiveRoll derives m²/theoretical/density via UOM and posts both kg and m²", async () => {
      // 100 m × 2 m × 5 mm × 25 kg/m³ → theoretical 25 kg, area 200 m², density 25
      const { roll, ledger } = await prisma.$transaction((tx) =>
        receiveRoll(tx, {
          companyId,
          itemId: foamItemId,
          locationId,
          dimensions: {
            length_m: "100",
            width_m: "2",
            layers: [{ thickness_mm: "5", density_kg_m3: "25" }],
          },
          actualKg: "24.6", // weighed differs from theoretical — that's the KPI
          initialState: "AVAILABLE",
          agingReadyDate: PAST,
        }),
      );
      expect(roll.qtyKgTheoretical.toString()).toBe("25");
      expect(roll.qtyM2.toString()).toBe("200");
      expect(roll.densityKgM3.toString()).toBe("25");
      expect(roll.qtyKgActual.toString()).toBe("24.6");
      // ledger row carries BOTH units (actual kg, and m² from dimensions)
      expect(ledger.grain).toBe("SERIAL");
      expect(ledger.qtyKg?.toString()).toBe("24.6");
      expect(ledger.qtyM2?.toString()).toBe("200");
    });

    it("availableRolls excludes curing and non-AVAILABLE rolls", async () => {
      const item = await freshFoamItem();
      const dims = {
        length_m: "10",
        width_m: "1",
        layers: [{ thickness_mm: "3", density_kg_m3: "20" }],
      };

      const available = await prisma.$transaction((tx) =>
        receiveRoll(tx, {
          companyId,
          itemId: item,
          locationId,
          dimensions: dims,
          actualKg: "0.6",
          initialState: "AVAILABLE",
          agingReadyDate: PAST,
        }),
      );
      // AVAILABLE but aging-ready date still in the future → not yet sellable
      await prisma.$transaction((tx) =>
        receiveRoll(tx, {
          companyId,
          itemId: item,
          locationId,
          dimensions: dims,
          actualKg: "0.6",
          initialState: "AVAILABLE",
          agingReadyDate: FUTURE,
        }),
      );
      // physically present but curing
      await prisma.$transaction((tx) =>
        receiveRoll(tx, {
          companyId,
          itemId: item,
          locationId,
          dimensions: dims,
          actualKg: "0.6",
          initialState: "CURING",
          agingReadyDate: FUTURE,
        }),
      );

      const rolls = await availableRolls(prisma, companyId, item, new Date());
      expect(rolls.map((r) => r.id)).toEqual([available.roll.id]);
    });
  });

  describe("allocation (reserve specific rolls at picking)", () => {
    it("reserves an AVAILABLE roll and refuses to double-allocate it", async () => {
      const item = await freshFoamItem();
      const dims = {
        length_m: "10",
        width_m: "1",
        layers: [{ thickness_mm: "3", density_kg_m3: "20" }],
      };
      const { roll } = await prisma.$transaction((tx) =>
        receiveRoll(tx, {
          companyId,
          itemId: item,
          locationId,
          dimensions: dims,
          actualKg: "0.6",
          initialState: "AVAILABLE",
          agingReadyDate: PAST,
        }),
      );

      await prisma.$transaction((tx) =>
        allocateRolls(tx, companyId, [roll.id], { refType: "PICKLIST", refId: "PL-1" }),
      );
      const after = await prisma.roll.findUniqueOrThrow({ where: { id: roll.id } });
      expect(after.state).toBe("ALLOCATED");

      await expect(
        prisma.$transaction((tx) => allocateRolls(tx, companyId, [roll.id])),
      ).rejects.toBeInstanceOf(StockError);
    });

    it("refuses a curing roll without override, allows it with a logged override", async () => {
      const item = await freshFoamItem();
      const dims = {
        length_m: "10",
        width_m: "1",
        layers: [{ thickness_mm: "3", density_kg_m3: "20" }],
      };
      const { roll } = await prisma.$transaction((tx) =>
        receiveRoll(tx, {
          companyId,
          itemId: item,
          locationId,
          dimensions: dims,
          actualKg: "0.6",
          initialState: "CURING",
          agingReadyDate: FUTURE,
        }),
      );

      await expect(
        prisma.$transaction((tx) => allocateRolls(tx, companyId, [roll.id])),
      ).rejects.toBeInstanceOf(StockError);

      await prisma.$transaction((tx) =>
        allocateRolls(tx, companyId, [roll.id], {
          override: { reason: "urgent customer, supervisor approved" },
        }),
      );
      const after = await prisma.roll.findUniqueOrThrow({ where: { id: roll.id } });
      expect(after.state).toBe("ALLOCATED");

      const override = await prisma.auditLog.findFirst({
        where: { entity: "Roll", entityId: roll.id, action: "ALLOCATE_OVERRIDE" },
      });
      expect(override).not.toBeNull();
    });
  });

  describe("rollBalance", () => {
    it("aggregates count, kg and m² for a state", async () => {
      const item = await freshFoamItem();
      const dims = {
        length_m: "10",
        width_m: "1",
        layers: [{ thickness_mm: "3", density_kg_m3: "20" }],
      };
      await prisma.$transaction((tx) =>
        receiveRoll(tx, {
          companyId,
          itemId: item,
          locationId,
          dimensions: dims,
          actualKg: "0.6",
          initialState: "AVAILABLE",
          agingReadyDate: PAST,
        }),
      );
      await prisma.$transaction((tx) =>
        receiveRoll(tx, {
          companyId,
          itemId: item,
          locationId,
          dimensions: dims,
          actualKg: "0.5",
          initialState: "AVAILABLE",
          agingReadyDate: PAST,
        }),
      );
      const bal = await rollBalance(prisma, companyId, {
        itemId: item,
        state: "AVAILABLE",
      });
      expect(bal.count).toBe(2);
      expect(bal.qtyKg.toString()).toBe("1.1"); // 0.6 + 0.5, exact (no float drift)
      expect(bal.qtyM2.toString()).toBe("20"); // 10 + 10
    });
  });

  // helpers — fresh namespaced rows so cases don't interfere
  async function freshLocation(): Promise<string> {
    const l = await prisma.location.create({
      data: { companyId, name: "Loc", code: `L-${crypto.randomUUID()}` },
    });
    return l.id;
  }
  async function freshFoamItem(): Promise<string> {
    const i = await prisma.item.create({
      data: {
        companyId,
        code: `FG-${crypto.randomUUID()}`,
        name: "EPE roll",
        type: "FINISHED_GOOD",
        uomBase: "M2",
      },
    });
    return i.id;
  }
});
