"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { requireActor, AuthzError } from "@/lib/rbac";
import { Decimal } from "@/lib/decimal";
import type { ReceiptMode } from "@prisma/client";
import {
  recordReceipt,
  allocateReceipt,
  cancelReceipt,
  ReceivablesValidationError,
  type AllocationInput,
} from "@/lib/receivables";

async function currentActor() {
  return requireActor(await auth());
}
function str(v: FormDataEntryValue | null): string | undefined {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? undefined : s;
}
function rupeesToPaise(v: string | undefined): bigint | null {
  if (!v) return null;
  try {
    return BigInt(new Decimal(v).times(100).toFixed(0));
  } catch {
    return null;
  }
}

/** Read per-invoice allocation amounts (rupees) from the record form's parallel arrays. */
function readAllocations(fd: FormData): AllocationInput[] {
  const invoiceIds = fd.getAll("allocInvoiceId").map(String);
  const amounts = fd.getAll("allocAmount").map(String);
  const out: AllocationInput[] = [];
  for (let i = 0; i < invoiceIds.length; i++) {
    const invoiceId = invoiceIds[i]?.trim();
    const paise = rupeesToPaise(amounts[i]?.trim());
    if (!invoiceId || !paise || paise <= 0n) continue;
    out.push({ invoiceId, amountPaise: paise });
  }
  return out;
}

async function run(customerId: string, work: () => Promise<unknown>) {
  try {
    await work();
  } catch (err) {
    if (err instanceof ReceivablesValidationError || err instanceof AuthzError) {
      redirect(`/receivables/${customerId}?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }
  revalidatePath(`/receivables/${customerId}`);
  revalidatePath("/receivables");
  redirect(`/receivables/${customerId}`);
}

export async function recordReceiptAction(fd: FormData) {
  const actor = await currentActor();
  const customerId = String(fd.get("customerId"));
  const amountPaise = rupeesToPaise(str(fd.get("amount")));
  const receivedAt = str(fd.get("receivedAt"));
  await run(customerId, () =>
    prisma.$transaction((tx) =>
      recordReceipt(tx, actor, {
        customerId,
        amountPaise: amountPaise ?? 0n,
        mode: (str(fd.get("mode")) ?? "BANK") as ReceiptMode,
        reference: str(fd.get("reference")) ?? null,
        ...(receivedAt ? { receivedAt: new Date(receivedAt) } : {}),
        allocations: readAllocations(fd),
      }),
    ),
  );
}

export async function allocateReceiptAction(fd: FormData) {
  const actor = await currentActor();
  const customerId = String(fd.get("customerId"));
  const receiptId = String(fd.get("receiptId"));
  await run(customerId, () =>
    prisma.$transaction((tx) =>
      allocateReceipt(tx, actor, receiptId, readAllocations(fd)),
    ),
  );
}

export async function cancelReceiptAction(fd: FormData) {
  const actor = await currentActor();
  const customerId = String(fd.get("customerId"));
  const receiptId = String(fd.get("receiptId"));
  await run(customerId, () =>
    prisma.$transaction((tx) => cancelReceipt(tx, actor, receiptId)),
  );
}
