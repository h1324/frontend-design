"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { requireActor, AuthzError } from "@/lib/rbac";
import { Decimal } from "@/lib/decimal";
import {
  createQuotation,
  sendQuotation,
  winQuotation,
  loseQuotation,
  cancelQuotation,
  overrideMargin,
  convertToSalesOrder,
  QuotationError,
  type QuotationLineInput,
} from "@/lib/pricing";
import { SalesOrderValidationError } from "@/lib/sales-order";

async function currentActor() {
  return requireActor(await auth());
}
function str(v: FormDataEntryValue | null): string | undefined {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? undefined : s;
}
function rupeesToPaise(v: string | undefined): number | undefined {
  if (!v) return undefined;
  try {
    return Number(new Decimal(v).times(100).toFixed(0));
  } catch {
    return undefined;
  }
}

/** Parallel line arrays; a blank rate means "auto-resolve from the price contracts". */
async function readLines(fd: FormData, companyId: string): Promise<QuotationLineInput[]> {
  const itemIds = fd.getAll("lineItemId").map(String);
  const qtys = fd.getAll("lineQty").map(String);
  const rates = fd.getAll("lineRate").map(String);
  const wanted = itemIds.map((s) => s.trim()).filter(Boolean);
  const items = wanted.length
    ? await prisma.item.findMany({ where: { companyId, id: { in: wanted } } })
    : [];
  const gstById = new Map(items.map((i) => [i.id, i.gstRatePct?.toString() ?? "0"]));
  const uomById = new Map(items.map((i) => [i.id, i.uomBase]));

  const lines: QuotationLineInput[] = [];
  for (let i = 0; i < itemIds.length; i++) {
    const itemId = itemIds[i]?.trim();
    const qty = qtys[i]?.trim();
    if (!itemId || !qty) continue;
    const ratePaise = rupeesToPaise(rates[i]?.trim());
    lines.push({
      itemId,
      qtyQuoted: qty,
      uom: uomById.get(itemId) ?? "M2",
      ...(ratePaise != null ? { ratePaise } : {}),
      gstRatePct: gstById.get(itemId) ?? "0",
    });
  }
  return lines;
}

export async function createQuotationAction(fd: FormData) {
  const actor = await currentActor();
  let newId: string | undefined;
  try {
    const q = await prisma.$transaction(async (tx) =>
      createQuotation(tx, actor, {
        customerId: str(fd.get("customerId")) ?? "",
        shipToId: str(fd.get("shipToId")) ?? null,
        lines: await readLines(fd, actor.companyId),
      }),
    );
    newId = q.id;
  } catch (err) {
    if (err instanceof QuotationError || err instanceof AuthzError) {
      redirect(`/sales/quotations?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }
  revalidatePath("/sales/quotations");
  redirect(`/sales/quotations/${newId}`);
}

async function run(id: string, work: () => Promise<unknown>) {
  try {
    await work();
  } catch (err) {
    if (
      err instanceof QuotationError ||
      err instanceof SalesOrderValidationError ||
      err instanceof AuthzError
    ) {
      redirect(`/sales/quotations/${id}?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }
  revalidatePath(`/sales/quotations/${id}`);
  redirect(`/sales/quotations/${id}`);
}

export async function sendQuotationAction(fd: FormData) {
  const actor = await currentActor();
  const id = String(fd.get("id"));
  await run(id, () => prisma.$transaction((tx) => sendQuotation(tx, actor, id)));
}

export async function winQuotationAction(fd: FormData) {
  const actor = await currentActor();
  const id = String(fd.get("id"));
  await run(id, () => prisma.$transaction((tx) => winQuotation(tx, actor, id)));
}

export async function loseQuotationAction(fd: FormData) {
  const actor = await currentActor();
  const id = String(fd.get("id"));
  const reason = str(fd.get("reason")) ?? "";
  await run(id, () => prisma.$transaction((tx) => loseQuotation(tx, actor, id, reason)));
}

export async function cancelQuotationAction(fd: FormData) {
  const actor = await currentActor();
  const id = String(fd.get("id"));
  await run(id, () => prisma.$transaction((tx) => cancelQuotation(tx, actor, id)));
}

export async function overrideMarginAction(fd: FormData) {
  const actor = await currentActor();
  const id = String(fd.get("id"));
  const reason = str(fd.get("reason")) ?? "";
  await run(id, () => prisma.$transaction((tx) => overrideMargin(tx, actor, id, reason)));
}

export async function convertQuotationAction(fd: FormData) {
  const actor = await currentActor();
  const id = String(fd.get("id"));
  let soId: string | undefined;
  try {
    const so = await prisma.$transaction((tx) => convertToSalesOrder(tx, actor, id));
    soId = so.id;
  } catch (err) {
    if (
      err instanceof QuotationError ||
      err instanceof SalesOrderValidationError ||
      err instanceof AuthzError
    ) {
      redirect(`/sales/quotations/${id}?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }
  revalidatePath(`/sales/quotations/${id}`);
  redirect(`/sales/orders/${soId}`);
}
