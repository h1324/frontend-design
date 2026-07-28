import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// S0 seed: the single operating company and one admin so the app can be logged into.
// Master/reference seed data (real SKUs, customers, suppliers) arrives with S5–S7.
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

  console.log("Seeded company + admin user (admin@epe.local / admin1234)");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
