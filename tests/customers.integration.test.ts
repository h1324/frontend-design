import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  createCustomer,
  updateCustomer,
  setCustomerActive,
  addShipTo,
  setDefaultShipTo,
  CustomerValidationError,
  type CustomerInput,
} from "../lib/customers.js";
import { AuthzError, type Actor } from "../lib/rbac.js";

const suite = process.env.DATABASE_URL ? describe : describe.skip;

suite("customer master (integration)", () => {
  let prisma: PrismaClient;
  let admin: Actor;
  let sales: Actor;

  beforeAll(async () => {
    prisma = new PrismaClient();
    const company = await prisma.company.create({
      data: { name: `Cust Co ${Date.now()}` },
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

  it("creates a customer with multiple ship-tos; each keeps its state code, exactly one default", async () => {
    const input: CustomerInput = {
      code: code("CUST"),
      name: "Mattress Co",
      creditLimit: "500000.50",
      creditDays: 30,
      shipTos: [
        { label: "MH", gstStateCode: "27", isDefault: true },
        { label: "GJ", gstStateCode: "24" },
      ],
    };
    const customer = await prisma.$transaction((tx) => createCustomer(tx, admin, input));

    const shipTos = await prisma.shipToAddress.findMany({
      where: { customerId: customer.id },
      orderBy: { label: "asc" },
    });
    expect(shipTos.map((s) => s.gstStateCode).sort()).toEqual(["24", "27"]);
    expect(shipTos.filter((s) => s.isDefault)).toHaveLength(1);
    expect(shipTos.find((s) => s.isDefault)?.gstStateCode).toBe("27");
    // credit fields persist as Decimal/int; tier defaults UNGRADED; no enforcement
    expect(customer.creditLimit.toString()).toBe("500000.5");
    expect(customer.creditDays).toBe(30);
    expect(customer.tier).toBe("UNGRADED");
  });

  it("accepts a null GSTIN and rejects a malformed one", async () => {
    const ok = await prisma.$transaction((tx) =>
      createCustomer(tx, admin, { code: code("CUST"), name: "No GST" }),
    );
    expect(ok.gstin).toBeNull();

    await expect(
      prisma.$transaction((tx) =>
        createCustomer(tx, admin, { code: code("CUST"), name: "Bad", gstin: "NOPE" }),
      ),
    ).rejects.toBeInstanceOf(CustomerValidationError);
  });

  it("denies a non-admin (SALES); nothing is written", async () => {
    const c = code("CUST");
    await expect(
      prisma.$transaction((tx) => createCustomer(tx, sales, { code: c, name: "X" })),
    ).rejects.toBeInstanceOf(AuthzError);
    expect(
      await prisma.customer.findFirst({ where: { companyId: sales.companyId, code: c } }),
    ).toBeNull();
  });

  it("addShipTo makes the first one default; setDefaultShipTo moves the default exclusively", async () => {
    const customer = await prisma.$transaction((tx) =>
      createCustomer(tx, admin, { code: code("CUST"), name: "Grower" }),
    );
    const first = await prisma.$transaction((tx) =>
      addShipTo(tx, admin, customer.id, { label: "First", gstStateCode: "27" }),
    );
    expect(first.isDefault).toBe(true); // first ship-to becomes default

    const second = await prisma.$transaction((tx) =>
      addShipTo(tx, admin, customer.id, { label: "Second", gstStateCode: "24" }),
    );
    expect(second.isDefault).toBe(false);

    await prisma.$transaction((tx) => setDefaultShipTo(tx, admin, second.id));
    const shipTos = await prisma.shipToAddress.findMany({
      where: { customerId: customer.id },
    });
    expect(shipTos.filter((s) => s.isDefault)).toHaveLength(1);
    expect(shipTos.find((s) => s.isDefault)?.id).toBe(second.id);
  });

  it("updates mutable fields (audited) and deactivates rather than deletes", async () => {
    const customer = await prisma.$transaction((tx) =>
      createCustomer(tx, admin, { code: code("CUST"), name: "Editable" }),
    );
    await prisma.$transaction((tx) =>
      updateCustomer(tx, admin, customer.id, {
        name: "Renamed",
        tier: "A",
        creditLimit: "250000",
      }),
    );
    const updated = await prisma.customer.findUniqueOrThrow({
      where: { id: customer.id },
    });
    expect(updated.name).toBe("Renamed");
    expect(updated.tier).toBe("A");
    expect(updated.creditLimit.toString()).toBe("250000");

    await prisma.$transaction((tx) => setCustomerActive(tx, admin, customer.id, false));
    const after = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
    expect(after.isActive).toBe(false);

    const audits = await prisma.auditLog.findMany({
      where: { entity: "Customer", entityId: customer.id },
    });
    expect(audits.map((a) => a.action)).toEqual(
      expect.arrayContaining(["CREATE", "UPDATE", "DEACTIVATE"]),
    );
  });
});
