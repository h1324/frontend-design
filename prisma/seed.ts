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
    update: { gstin: "27AABCE1234F1Z5", einvoiceApplicable: true },
    create: {
      id: "seed-company",
      name: "EPE Foam Unit",
      legalName: "EPE Foam Unit Pvt Ltd",
      // Placeholder GSTIN — Maharashtra (state 27). Replace with the real GSTIN before go-live.
      gstin: "27AABCE1234F1Z5",
      // An operating foam plant is over the ₹5 cr AATO threshold, so e-invoicing applies to its
      // B2B sales. Flip false if a sub-threshold unit uses this seed.
      einvoiceApplicable: true,
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

  // A QC-hold location where goods receipt (S15) quarantines incoming stock until QC (S16)
  // passes it. Backfill isQcHold on an already-seeded location.
  await prisma.location.upsert({
    where: { companyId_code: { companyId: company.id, code: "QC-HOLD" } },
    update: { isQcHold: true },
    create: { companyId: company.id, name: "QC Hold", code: "QC-HOLD", isQcHold: true },
  });

  // A reject location where QC (S16) segregates failed stock, kept out of free/issuable stock.
  await prisma.location.upsert({
    where: { companyId_code: { companyId: company.id, code: "REJECT" } },
    update: { isReject: true },
    create: { companyId: company.id, name: "QC Reject", code: "REJECT", isReject: true },
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

  // Predictive-reorder thresholds (S28) for the inputs the brief calls out — butane and
  // masterbatch above all — plus resin and talc. Lead time + safety stock let the scan compute a
  // reorder point from real consumption; without these an item stays out of the reorder watch.
  const REORDER_SEED: Record<string, { leadTimeDays: number; safetyStock: string }> = {
    "RM-BUTANE": { leadTimeDays: 5, safetyStock: "300" }, // imported, tightly held — short cover
    "RM-MB-WHITE": { leadTimeDays: 21, safetyStock: "150" }, // long lead, colour-critical
    "RM-LDPE-FILM": { leadTimeDays: 10, safetyStock: "1500" },
    "RM-LDPE-EXT": { leadTimeDays: 10, safetyStock: "1500" },
    "RM-TALC": { leadTimeDays: 14, safetyStock: "200" },
  };
  for (const [code, cfg] of Object.entries(REORDER_SEED)) {
    await prisma.item.update({
      where: { companyId_code: { companyId: company.id, code } },
      data: {
        leadTimeDays: cfg.leadTimeDays,
        safetyStock: cfg.safetyStock,
        reorderPolicy: "AUTO_SUGGEST",
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

  // --- S25 sell-side: list prices + an illustrative price contract & value tier ---------
  // Give finished goods a default list price so quotations can auto-price out of the box
  // (the lowest-precedence tier the S25 resolver falls back to). Idempotent per item code.
  const fgItems = await prisma.item.findMany({
    where: { companyId: company.id, type: "FINISHED_GOOD" },
    orderBy: { code: "asc" },
    take: 3,
  });
  const listPrices = [12000n, 9000n, 15000n]; // ₹/m² in paise, illustrative
  for (let i = 0; i < fgItems.length; i++) {
    const it = fgItems[i];
    if (!it) continue;
    await prisma.item.update({
      where: { id: it.id },
      data: { listPricePaise: listPrices[i % listPrices.length] ?? 12000n },
    });
  }
  // A tier-A price contract (customer-grade rate, quantity-slab-banded) beating the list price,
  // plus a whole-order value discount tier — the second, orthogonal pricing axis. Fixed ids keep
  // the seed idempotent; the doc number is illustrative (real ones are gapless per FY).
  const anchor = fgItems[0];
  if (anchor) {
    const gst = anchor.gstRatePct?.toString() ?? "18";
    await prisma.priceContract.upsert({
      where: { id: "seed-pc-tier-a" },
      update: {},
      create: {
        id: "seed-pc-tier-a",
        companyId: company.id,
        docNo: "PC/SEED/000001",
        scope: "TIER",
        tier: "A",
        lines: {
          create: [
            { itemId: anchor.id, minQty: "0", ratePaise: 11500n, gstRatePct: gst },
            { itemId: anchor.id, minQty: "1000", ratePaise: 11000n, gstRatePct: gst },
          ],
        },
      },
    });
  }
  await prisma.valueDiscountTier.upsert({
    where: { id: "seed-vdt-tier-a" },
    update: {},
    create: {
      id: "seed-vdt-tier-a",
      companyId: company.id,
      scope: "TIER",
      tier: "A",
      minOrderValuePaise: 20_000_000n, // ₹2,00,000 pre-tax
      discountPct: "2.5",
    },
  });

  console.log(
    `Seeded company + admin (admin@epe.local / admin1234) + ${LAUNCH_CATALOGUE.length} items + ${SUPPLIER_SEED.length} suppliers + ${CUSTOMER_SEED.length} customers + production masters + S25 list prices/price contract`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
