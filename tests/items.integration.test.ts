import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  createItem,
  updateItem,
  setItemActive,
  resolveItemAging,
  ItemValidationError,
  type ItemInput,
} from "../lib/items.js";
import { AuthzError, type Actor } from "../lib/rbac.js";

const suite = process.env.DATABASE_URL ? describe : describe.skip;

suite("item master (integration)", () => {
  let prisma: PrismaClient;
  let admin: Actor;
  let sales: Actor;

  const foam = (code: string): ItemInput => ({
    code,
    name: "EPE roll",
    type: "FINISHED_GOOD",
    uomBase: "M2",
    hsnCode: "39211900",
    thickness_mm: "2",
    width_mm: "1200",
    density_kg_m3: "22",
    layerCount: 1,
    surfaceTreatment: "PLAIN",
  });

  beforeAll(async () => {
    prisma = new PrismaClient();
    const company = await prisma.company.create({
      data: { name: `Item Co ${Date.now()}`, defaultAgingDays: 7 },
    });
    // Real user rows: writeAudit FKs actorUserId → User.
    const adminUser = await prisma.user.create({
      data: {
        companyId: company.id,
        email: `admin-${Date.now()}@test.local`,
        name: "Admin",
        passwordHash: "x",
        role: "ADMIN",
      },
    });
    const salesUser = await prisma.user.create({
      data: {
        companyId: company.id,
        email: `sales-${Date.now()}@test.local`,
        name: "Sales",
        passwordHash: "x",
        role: "SALES",
      },
    });
    admin = { userId: adminUser.id, companyId: company.id, role: "ADMIN" };
    sales = { userId: salesUser.id, companyId: company.id, role: "SALES" };
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const code = (p: string) => `${p}-${crypto.randomUUID().slice(0, 8)}`;

  it("admin creates a valid item and it is audited", async () => {
    const c = code("FG");
    const item = await prisma.$transaction((tx) => createItem(tx, admin, foam(c)));
    expect(item.code).toBe(c);
    expect(item.density_kg_m3?.toString()).toBe("22");

    const audit = await prisma.auditLog.findFirst({
      where: { entity: "Item", entityId: item.id, action: "CREATE" },
    });
    expect(audit).not.toBeNull();
  });

  it("rejects a FINISHED_GOOD without foam attributes (field errors)", async () => {
    const bad: ItemInput = {
      code: code("FG"),
      name: "x",
      type: "FINISHED_GOOD",
      uomBase: "M2",
    };
    await expect(
      prisma.$transaction((tx) => createItem(tx, admin, bad)),
    ).rejects.toBeInstanceOf(ItemValidationError);
  });

  it("accepts a RAW_MATERIAL without foam attributes", async () => {
    const rm: ItemInput = {
      code: code("RM"),
      name: "LDPE",
      type: "RAW_MATERIAL",
      uomBase: "KG",
    };
    const item = await prisma.$transaction((tx) => createItem(tx, admin, rm));
    expect(item.type).toBe("RAW_MATERIAL");
    expect(item.thickness_mm).toBeNull();
  });

  it("denies a non-admin (SALES) creating an item, and nothing is written", async () => {
    const c = code("FG");
    await expect(
      prisma.$transaction((tx) => createItem(tx, sales, foam(c))),
    ).rejects.toBeInstanceOf(AuthzError);
    expect(
      await prisma.item.findFirst({ where: { companyId: sales.companyId, code: c } }),
    ).toBeNull();
  });

  it("updates a mutable field with an audit row", async () => {
    const item = await prisma.$transaction((tx) =>
      createItem(tx, admin, foam(code("FG"))),
    );
    await prisma.$transaction((tx) =>
      updateItem(tx, admin, item.id, { name: "EPE roll (renamed)" }),
    );
    const updated = await prisma.item.findUniqueOrThrow({ where: { id: item.id } });
    expect(updated.name).toBe("EPE roll (renamed)");
    const audit = await prisma.auditLog.findFirst({
      where: { entity: "Item", entityId: item.id, action: "UPDATE" },
    });
    expect(audit).not.toBeNull();
  });

  it("deactivates rather than deletes", async () => {
    const item = await prisma.$transaction((tx) =>
      createItem(tx, admin, foam(code("FG"))),
    );
    await prisma.$transaction((tx) => setItemActive(tx, admin, item.id, false));
    const after = await prisma.item.findUniqueOrThrow({ where: { id: item.id } });
    expect(after.isActive).toBe(false); // row remains
  });

  it("resolves aging to the item override when set, else the company default", async () => {
    const usesDefault = await prisma.$transaction((tx) =>
      createItem(tx, admin, { ...foam(code("FG")), agingDays: null }),
    );
    expect(await resolveItemAging(prisma, usesDefault.id)).toBe(7); // company default

    const overrides = await prisma.$transaction((tx) =>
      createItem(tx, admin, { ...foam(code("FG")), agingDays: 14 }),
    );
    expect(await resolveItemAging(prisma, overrides.id)).toBe(14);
  });
});
