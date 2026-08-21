"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { requireActor, AuthzError } from "@/lib/rbac";
import { Decimal } from "@/lib/decimal";
import { StockError } from "@/lib/stock-ledger";
import {
  createSO,
  confirmSO,
  overrideCredit,
  allocateSO,
  fulfilSalesOrder,
  cancelSO,
  SalesOrderValidationError,
  type SalesOrderLineInput,
} from "@/lib/sales-order";

async function currentActor() {
  return requireActor(await auth());
}
function str(v: FormDataEntryValue | null): string | undefined {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? undefined : s;
}
function rupeesToPaise(v: string | undefined): number | null {
  if (!v) return null;
  try {
    return Number(new Decimal(v).times(100).toFixed(0));
  } catch {
    return null;
  }
}

/** Read the parallel line arrays from the create form. GST% is copied from the item master. */
async function readLines(
  fd: FormData,
  companyId: string,
): Promise<SalesOrderLineInput[]> {
  const itemIds = fd.getAll("lineItemId").map(String);
  const qtys = fd.getAll("lineQty").map(String);
  const rates = fd.getAll("lineRate").map(String);
  const wanted = itemIds.map((s) => s.trim()).filter(Boolean);
  const items = wanted.length
    ? await prisma.item.findMany({ where: { companyId, id: { in: wanted } } })
    : [];
  const gstById = new Map(items.map((i) => [i.id, i.gstRatePct?.toString() ?? "0"]));
  const uomById = new Map(items.map((i) => [i.id, i.uomBase]));

  const lines: SalesOrderLineInput[] = [];
  for (let i = 0; i < itemIds.length; i++) {
    const itemId = itemIds[i]?.trim();
    const qty = qtys[i]?.trim();
    if (!itemId || !qty) continue;
    lines.push({
      itemId,
      qtyOrdered: qty,
      uom: uomById.get(itemId) ?? "M2",
      ratePaise: rupeesToPaise(rates[i]?.trim()) ?? 0,
      gstRatePct: gstById.get(itemId) ?? "0",
    });
  }
  return lines;
}

export async function createSOAction(fd: FormData) {
  const actor = await currentActor();
  let newId: string | undefined;
  try {
    const so = await prisma.$transaction(async (tx) =>
      createSO(tx, actor, {
        customerId: str(fd.get("customerId")) ?? "",
        shipToId: str(fd.get("shipToId")) ?? "",
        lines: await readLines(fd, actor.companyId),
      }),
    );
    newId = so.id;
  } catch (err) {
    if (err instanceof SalesOrderValidationError) {
      redirect(`/sales/orders?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }
  revalidatePath("/sales/orders");
  redirect(`/sales/orders/${newId}`);
}

async function run(soId: string, work: () => Promise<unknown>) {
  try {
    await work();
  } catch (err) {
    if (
      err instanceof SalesOrderValidationError ||
      err instanceof StockError ||
      err instanceof AuthzError
    ) {
      redirect(`/sales/orders/${soId}?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }
  revalidatePath(`/sales/orders/${soId}`);
  redirect(`/sales/orders/${soId}`);
}

export async function confirmSOAction(fd: FormData) {
  const actor = await currentActor();
  const soId = String(fd.get("soId"));
  await run(soId, () => prisma.$transaction((tx) => confirmSO(tx, actor, soId)));
}

export async function overrideCreditAction(fd: FormData) {
  const actor = await currentActor();
  const soId = String(fd.get("soId"));
  const reason = str(fd.get("reason")) ?? "";
  await run(soId, () =>
    prisma.$transaction((tx) => overrideCredit(tx, actor, soId, reason)),
  );
}

export async function allocateSOAction(fd: FormData) {
  const actor = await currentActor();
  const soId = String(fd.get("soId"));
  const rollIds = fd.getAll("rollIds").map(String).filter(Boolean);
  const overrideReason = str(fd.get("overrideReason"));
  await run(soId, () =>
    prisma.$transaction((tx) =>
      allocateSO(
        tx,
        actor,
        soId,
        rollIds,
        overrideReason ? { reason: overrideReason } : undefined,
      ),
    ),
  );
}

export async function fulfilSOAction(fd: FormData) {
  const actor = await currentActor();
  const soId = String(fd.get("soId"));
  const rollIds = fd.getAll("rollIds").map(String).filter(Boolean);
  let noteId: string | undefined;
  try {
    const note = await prisma.$transaction((tx) =>
      fulfilSalesOrder(tx, actor, soId, {
        rollIds,
        transporter: str(fd.get("transporter")) ?? null,
        vehicleNo: str(fd.get("vehicleNo")) ?? null,
        lrNo: str(fd.get("lrNo")) ?? null,
      }),
    );
    noteId = note.id;
  } catch (err) {
    if (
      err instanceof SalesOrderValidationError ||
      err instanceof StockError ||
      err instanceof AuthzError
    ) {
      redirect(`/sales/orders/${soId}?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }
  revalidatePath(`/sales/orders/${soId}`);
  redirect(`/dispatch/${noteId}`);
}

export async function cancelSOAction(fd: FormData) {
  const actor = await currentActor();
  const soId = String(fd.get("soId"));
  await run(soId, () => prisma.$transaction((tx) => cancelSO(tx, actor, soId)));
}
