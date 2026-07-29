import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { LAUNCH_CATALOGUE } from "../lib/catalogue.js";
import { validateItemInput } from "../lib/items.js";

const prisma = new PrismaClient();

// Seed: the operating company, an admin, and the representative launch catalogue
// (planned EPE items — replace with actuals via the item master before go-live).
async function main() {
  const company = await prisma.company.upsert({
    where: { id: "seed-company" },
    update: {},
    create: { id: "seed-company", name: "EPE Foam Unit" },
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

  console.log(
    `Seeded company + admin (admin@epe.local / admin1234) + ${LAUNCH_CATALOGUE.length} catalogue items`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
