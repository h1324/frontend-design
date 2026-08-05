import { Prisma, PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { LAUNCH_CATALOGUE } from "../lib/catalogue.js";
import { validateItemInput } from "../lib/items.js";
import { SUPPLIER_SEED, validateSupplierInput } from "../lib/suppliers.js";
import { CUSTOMER_SEED, validateCustomerInput } from "../lib/customers.js";
import {
  MACHINE_SEED,
  SHIFT_SEED,
  OPERATOR_SEED,
  DOWNTIME_REASON_SEED,
} from "../lib/production-masters.js";

const prisma = new PrismaClient();

// Seed: the operating company, an admin, and the representative launch catalogue
// (planned EPE items — replace with actuals via the item master before go-live).
async function main() {
  const company = await prisma.company.upsert({
    where: { id: "seed-company" },
    // Backfill the GSTIN on an already-seeded company so dispatch can determine GST.
    update: { gstin: "27AABCE1234F1Z5" },
    create: {
      id: "seed-company",
      name: "EPE Foam Unit",
      legalName: "EPE Foam Unit Pvt Ltd",
      // Placeholder GSTIN — Maharashtra (state 27). Replace with the real GSTIN before go-live.
      gstin: "27AABCE1234F1Z5",
    },
  });

  const passwordHash = await bcrypt.hash("admin1234", 10);
  await prisma.user.upsert({
    where: { email: "admin@epe.local" },
    update: {},
    create: {
      email: "admin@epe.local",
      name: "Administrator",
      passwordHash,
      role: Role.ADMIN,
      companyId: company.id,
    },
  });

  // A default storage location so downstream modules have somewhere to place stock.
  await prisma.location.upsert({
    where: { companyId_code: { companyId: company.id, code: "MAIN" } },
    update: {},
    create: { companyId: company.id, name: "Main Warehouse", code: "MAIN" },
  });

  for (const input of LAUNCH_CATALOGUE) {
    const errors = validateItemInput(input);
    if (errors.length)
      throw new Error(`Catalogue item ${input.code} invalid: ${errors.join("; ")}`);
    await prisma.item.upsert({
      where: { companyId_code: { companyId: company.id, code: input.code } },
      update: {},
      create: {
        companyId: company.id,
        code: input.code,
        name: input.name,
        type: input.type,
        uomBase: input.uomBase,
        hsnCode: input.hsnCode ?? null,
        gstRatePct: input.gstRatePct != null ? String(input.gstRatePct) : null,
        grade: input.grade ?? null,
        thickness_mm: input.thickness_mm != null ? String(input.thickness_mm) : null,
        width_mm: input.width_mm != null ? String(input.width_mm) : null,
        density_kg_m3: input.density_kg_m3 != null ? String(input.density_kg_m3) : null,
        colour: input.colour ?? null,
        layerCount: input.layerCount ?? null,
        surfaceTreatment: input.surfaceTreatment ?? null,
        agingDays: input.agingDays ?? null,
        reorderLevel: input.reorderLevel != null ? String(input.reorderLevel) : null,
      },
    });
  }

  for (const input of SUPPLIER_SEED) {
    const errors = validateSupplierInput(input);
    if (errors.length)
      throw new Error(`Supplier ${input.code} invalid: ${errors.join("; ")}`);
    await prisma.supplier.upsert({
      where: { companyId_code: { companyId: company.id, code: input.code } },
      update: {},
      create: {
        companyId: company.id,
        code: input.code,
        name: input.name,
        legalName: input.legalName ?? null,
        gstin: input.gstin ?? null,
        paymentTerms: input.paymentTerms ?? null,
        addressJson: input.address
          ? (input.address as Prisma.InputJsonObject)
          : undefined,
        suppliesJson: input.supplies ?? undefined,
      },
    });
  }

  for (const input of CUSTOMER_SEED) {
    const errors = validateCustomerInput(input);
    if (errors.length)
      throw new Error(`Customer ${input.code} invalid: ${errors.join("; ")}`);
    const existing = await prisma.customer.findUnique({
      where: { companyId_code: { companyId: company.id, code: input.code } },
    });
    if (existing) continue; // idempotent: skip if already seeded
    const shipTos = input.shipTos ?? [];
    const defIdx = shipTos.findIndex((s) => s.isDefault);
    await prisma.customer.create({
      data: {
        companyId: company.id,
        code: input.code,
        name: input.name,
        gstin: input.gstin ?? null,
        tier: input.tier ?? "UNGRADED",
        creditLimit: input.creditLimit != null ? String(input.creditLimit) : "0",
        creditDays: input.creditDays ?? 0,
        paymentTerms: input.paymentTerms ?? null,
        shipTos: {
          create: shipTos.map((s, i) => ({
            label: s.label,
            gstStateCode: s.gstStateCode,
            addressJson: s.address ? (s.address as Prisma.InputJsonObject) : undefined,
            isDefault: i === (defIdx >= 0 ? defIdx : 0),
          })),
        },
      },
    });
  }

  const cid = { companyId: company.id };
  for (const m of MACHINE_SEED) {
    await prisma.machine.upsert({
      where: { companyId_code: { companyId: company.id, code: m.code } },
      update: {},
      create: {
        ...cid,
        code: m.code,
        name: m.name,
        ratedCapacityKgHr:
          m.ratedCapacityKgHr != null ? String(m.ratedCapacityKgHr) : null,
      },
    });
  }
  for (const s of SHIFT_SEED) {
    await prisma.shift.upsert({
      where: { companyId_code: { companyId: company.id, code: s.code } },
      update: {},
      create: {
        ...cid,
        code: s.code,
        name: s.name,
        startTime: s.startTime,
        endTime: s.endTime,
      },
    });
  }
  for (const o of OPERATOR_SEED) {
    await prisma.operator.upsert({
      where: { companyId_code: { companyId: company.id, code: o.code } },
      update: {},
      create: { ...cid, code: o.code, name: o.name },
    });
  }
  for (const d of DOWNTIME_REASON_SEED) {
    await prisma.downtimeReason.upsert({
      where: { companyId_code: { companyId: company.id, code: d.code } },
      update: {},
      create: { ...cid, code: d.code, description: d.description, category: d.category },
    });
  }

  console.log(
    `Seeded company + admin (admin@epe.local / admin1234) + ${LAUNCH_CATALOGUE.length} items + ${SUPPLIER_SEED.length} suppliers + ${CUSTOMER_SEED.length} customers + production masters`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
