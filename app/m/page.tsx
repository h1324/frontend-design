import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { requireActor, requireAccess } from "@/lib/rbac";
import { MobileApp } from "./MobileApp";

export default async function MobileOrdersPage() {
  const actor = requireActor(await auth());
  // The PWA is a SALES capture surface (spec S27, reps only). Read is enough to load it; the
  // submit server action enforces SALES-write when an order syncs.
  requireAccess(actor, "SALES", "read");

  const customers = await prisma.customer.findMany({
    where: { companyId: actor.companyId, isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, code: true, name: true, tier: true },
  });

  return <MobileApp customers={customers} />;
}
