"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { requireActor } from "@/lib/rbac";
import { StockError } from "@/lib/stock-ledger";
import {
  createGRN,
  cancelGRN,
  GrnValidationError,
  type GrnLineInput,
} from "@/lib/goods-receipt";

async function currentActor() {
  return requireActor(await auth());
}
function str(v: FormDataEntryValue | null): string | undefined {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? undefined : s;
}

/** Zip the parallel receive-line arrays, keeping only rows with a positive quantity. */
function readLines(fd: FormData): GrnLineInput[] {
  const itemIds = fd.getAll("lineItemId").map(String);
  const poLineIds = fd.getAll("linePoLineId").map(String);
  const qtys = fd.getAll("lineQty").map(String);
  const lines: GrnLineInput[] = [];
  for (let i = 0; i < itemIds.length; i++) {
    const itemId = itemIds[i]?.trim();
    const qty = qtys[i]?.trim();
    if (!itemId || !qty || Number(qty) <= 0) continue;
    lines.push({
      itemId,
      qtyReceived: qty,
      poLineId: poLineIds[i]?.trim() || null,
    });
  }
  return lines;
}

export async function createGRNAction(fd: FormData) {
  const actor = await currentActor();
  const poId = str(fd.get("poId")) ?? null;
  let newId: string | undefined;
  try {
    const grn = await prisma.$transaction((tx) =>
      createGRN(tx, actor, {
        poId,
        docketNo: str(fd.get("docketNo")) ?? null,
        vehicleNo: str(fd.get("vehicleNo")) ?? null,
        lines: readLines(fd),
      }),
    );
    newId = grn.id;
  } catch (err) {
    if (err instanceof GrnValidationError || err instanceof StockError) {
      const q = new URLSearchParams({ error: err.message });
      if (poId) q.set("poId", poId);
      redirect(`/purchasing/grn?${q.toString()}`);
    }
    throw err;
  }
  revalidatePath("/purchasing/grn");
  redirect(`/purchasing/grn/${newId}`);
}

export async function cancelGRNAction(fd: FormData) {
  const actor = await currentActor();
  const grnId = String(fd.get("grnId"));
  try {
    await prisma.$transaction((tx) => cancelGRN(tx, actor, grnId));
  } catch (err) {
    if (err instanceof GrnValidationError || err instanceof StockError) {
      redirect(`/purchasing/grn/${grnId}?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }
  revalidatePath(`/purchasing/grn/${grnId}`);
  redirect(`/purchasing/grn/${grnId}`);
}
