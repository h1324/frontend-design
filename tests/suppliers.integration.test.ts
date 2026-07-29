import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  createSupplier,
  updateSupplier,
  setSupplierActive,
  SupplierValidationError,
  type SupplierInput,
} from "../lib/suppliers.js";
import { AuthzError, type Actor } from "../lib/rbac.js";

const suite = process.env.DATABASE_URL ? describe : describe.skip;

suite("supplier master (integration)", () => {
  let prisma: PrismaClient;
  let admin: Actor;
  let sales: Actor;

  beforeAll(async () => {
    prisma = new PrismaClient();
    const company = await prisma.company.create({
      data: { name: `Sup Co ${Date.now()}` },
    });
    const adminUser = await prisma.user.create({
      data: {
        companyId: company.id,
        email: `a-${Date.now()}@t.local`,
        name: "A",
        passwordHash: "x",
        role: "ADMIN",
      },
    });
    const salesUser = await prisma.user.create({
      data: {
        companyId: company.id,
        email: `s-${Date.now()}@t.local`,
        name: "S",
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
  const base = (c: string): SupplierInput => ({
    code: c,
    name: "Resin Co",
    supplies: ["LDPE"],
  });

  it("creates a supplier (null GSTIN ok) and audits it", async () => {
    const c = code("SUP");
    const supplier = await prisma.$transaction((tx) =>
      createSupplier(tx, admin, base(c)),
    );
    expect(supplier.gstin).toBeNull();
    expect(supplier.suppliesJson).toEqual(["LDPE"]);
    const audit = await prisma.auditLog.findFirst({
      where: { entity: "Supplier", entityId: supplier.id, action: "CREATE" },
    });
    expect(audit).not.toBeNull();
  });

  it("accepts a valid GSTIN and stores its state code path", async () => {
    const s = await prisma.$transaction((tx) =>
      createSupplier(tx, admin, { ...base(code("SUP")), gstin: "27ABCDE1234F1Z5" }),
    );
    expect(s.gstin).toBe("27ABCDE1234F1Z5");
  });

  it("rejects a malformed GSTIN", async () => {
    await expect(
      prisma.$transaction((tx) =>
        createSupplier(tx, admin, { ...base(code("SUP")), gstin: "NOTVALID" }),
      ),
    ).rejects.toBeInstanceOf(SupplierValidationError);
  });

  it("denies a non-admin (SALES); nothing is written", async () => {
    const c = code("SUP");
    await expect(
      prisma.$transaction((tx) => createSupplier(tx, sales, base(c))),
    ).rejects.toBeInstanceOf(AuthzError);
    expect(
      await prisma.supplier.findFirst({ where: { companyId: sales.companyId, code: c } }),
    ).toBeNull();
  });

  it("updates a mutable field (audited) and deactivates rather than deletes", async () => {
    const supplier = await prisma.$transaction((tx) =>
      createSupplier(tx, admin, base(code("SUP"))),
    );
    await prisma.$transaction((tx) =>
      updateSupplier(tx, admin, supplier.id, {
        name: "Renamed Resin Co",
        paymentTerms: "45 days",
      }),
    );
    const updated = await prisma.supplier.findUniqueOrThrow({
      where: { id: supplier.id },
    });
    expect(updated.name).toBe("Renamed Resin Co");
    expect(updated.paymentTerms).toBe("45 days");

    await prisma.$transaction((tx) => setSupplierActive(tx, admin, supplier.id, false));
    const after = await prisma.supplier.findUniqueOrThrow({ where: { id: supplier.id } });
    expect(after.isActive).toBe(false); // row remains

    const audits = await prisma.auditLog.findMany({
      where: { entity: "Supplier", entityId: supplier.id },
    });
    expect(audits.map((a) => a.action)).toEqual(
      expect.arrayContaining(["CREATE", "UPDATE", "DEACTIVATE"]),
    );
  });
});
