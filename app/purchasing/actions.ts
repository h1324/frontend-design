"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { requireActor } from "@/lib/rbac";
import { Decimal } from "@/lib/decimal";
import {
  createPO,
  updatePO,
  closePO,
  cancelPO,
  PurchaseValidationError,
  type PoLineInput,
} from "@/lib/purchasing";

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

/** Zip the parallel line arrays from the create form into PO line inputs (dropping blanks). */
function readLines(fd: FormData): PoLineInput[] {
  const itemIds = fd.getAll("lineItemId").map(String);
  const qtys = fd.getAll("lineQty").map(String);
  const rates = fd.getAll("lineRate").map(String);
  const lines: PoLineInput[] = [];
  for (let i = 0; i < itemIds.length; i++) {
    const itemId = itemIds[i]?.trim();
    const qty = qtys[i]?.trim();
    if (!itemId || !qty) continue;
    lines.push({
      itemId,
      qtyOrdered: qty,
      ratePaise: rupeesToPaise(rates[i]?.trim()) ?? 0,
    });
  }
  return lines;
}

export async function createPOAction(fd: FormData) {
  const actor = await currentActor();
  const expected = str(fd.get("expectedDate"));
  let newId: string | undefined;
  try {
    const po = await prisma.$transaction((tx) =>
      createPO(tx, actor, {
        supplierId: str(fd.get("supplierId")) ?? "",
        lines: readLines(fd),
        status: fd.get("draft") === "on" ? "DRAFT" : "OPEN",
        paymentTerms: str(fd.get("paymentTerms")) ?? null,
        deliveryTerms: str(fd.get("deliveryTerms")) ?? null,
        notes: str(fd.get("notes")) ?? null,
        ...(expected ? { expectedDate: new Date(expected) } : {}),
      }),
    );
    newId = po.id;
  } catch (err) {
    if (err instanceof PurchaseValidationError) {
      redirect(`/purchasing/orders?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }
  revalidatePath("/purchasing/orders");
  redirect(`/purchasing/orders/${newId}`);
}

async function run(poId: string, work: () => Promise<unknown>) {
  try {
    await work();
  } catch (err) {
    if (err instanceof PurchaseValidationError) {
      redirect(`/purchasing/orders/${poId}?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }
  revalidatePath(`/purchasing/orders/${poId}`);
  redirect(`/purchasing/orders/${poId}`);
}

export async function releasePOAction(fd: FormData) {
  const actor = await currentActor();
  const poId = String(fd.get("poId"));
  await run(poId, () =>
    prisma.$transaction((tx) => updatePO(tx, actor, poId, { release: true })),
  );
}

export async function closePOAction(fd: FormData) {
  const actor = await currentActor();
  const poId = String(fd.get("poId"));
  const reason = str(fd.get("reason")) ?? undefined;
  await run(poId, () => prisma.$transaction((tx) => closePO(tx, actor, poId, reason)));
}

export async function cancelPOAction(fd: FormData) {
  const actor = await currentActor();
  const poId = String(fd.get("poId"));
  await run(poId, () => prisma.$transaction((tx) => cancelPO(tx, actor, poId)));
}
