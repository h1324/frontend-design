"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { requireActor } from "@/lib/rbac";
import { Decimal } from "@/lib/decimal";
import { StockError } from "@/lib/stock-ledger";
import {
  createDispatch,
  generateInvoice,
  cancelInvoice,
  cancelDispatch,
  DispatchValidationError,
} from "@/lib/dispatch";
import {
  generateIrn,
  generateEwayBill,
  cancelIrn,
  EInvoiceError,
} from "@/lib/einvoice/einvoice";

async function currentActor() {
  return requireActor(await auth());
}
function str(v: FormDataEntryValue | null): string | undefined {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? undefined : s;
}
function rupeesToPaise(v: FormDataEntryValue | null): number | null {
  const s = str(v);
  if (!s) return null;
  try {
    return Number(new Decimal(s).times(100).toFixed(0));
  } catch {
    return null;
  }
}

/** Create a dispatch note. The ship-to implies the customer. */
export async function createDispatchAction(fd: FormData) {
  const actor = await currentActor();
  const shipToId = str(fd.get("shipToId")) ?? "";
  const rollIds = fd.getAll("rollIds").map(String).filter(Boolean);
  const overrideReason = str(fd.get("overrideReason"));

  let newId: string | undefined;
  try {
    const shipTo = await prisma.shipToAddress.findFirst({
      where: { id: shipToId, customer: { companyId: actor.companyId } },
      select: { customerId: true },
    });
    if (!shipTo) {
      redirect(`/dispatch?error=${encodeURIComponent("select a ship-to address")}`);
    }
    const note = await prisma.$transaction((tx) =>
      createDispatch(tx, actor, {
        customerId: shipTo!.customerId,
        shipToId,
        rollIds,
        transporter: str(fd.get("transporter")) ?? null,
        vehicleNo: str(fd.get("vehicleNo")) ?? null,
        lrNo: str(fd.get("lrNo")) ?? null,
        ...(overrideReason ? { override: { reason: overrideReason } } : {}),
      }),
    );
    newId = note.id;
  } catch (err) {
    if (err instanceof DispatchValidationError || err instanceof StockError) {
      redirect(`/dispatch?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }
  revalidatePath("/dispatch");
  redirect(`/dispatch/${newId}`);
}

/** Generate the invoice for a note. Rate inputs are named `rate_<itemId>` in rupees. */
export async function generateInvoiceAction(fd: FormData) {
  const actor = await currentActor();
  const noteId = String(fd.get("noteId"));
  const ratesPaise: Record<string, number> = {};
  for (const [key, value] of fd.entries()) {
    if (key.startsWith("rate_")) {
      const itemId = key.slice("rate_".length);
      const paise = rupeesToPaise(value);
      if (paise != null) ratesPaise[itemId] = paise;
    }
  }
  try {
    await prisma.$transaction((tx) => generateInvoice(tx, actor, noteId, { ratesPaise }));
  } catch (err) {
    if (err instanceof DispatchValidationError || err instanceof StockError) {
      redirect(`/dispatch/${noteId}?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }
  revalidatePath(`/dispatch/${noteId}`);
  redirect(`/dispatch/${noteId}`);
}

export async function cancelInvoiceAction(fd: FormData) {
  const actor = await currentActor();
  const noteId = String(fd.get("noteId"));
  const invoiceId = String(fd.get("invoiceId"));
  try {
    await prisma.$transaction((tx) => cancelInvoice(tx, actor, invoiceId));
  } catch (err) {
    if (err instanceof DispatchValidationError || err instanceof StockError) {
      redirect(`/dispatch/${noteId}?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }
  revalidatePath(`/dispatch/${noteId}`);
  redirect(`/dispatch/${noteId}`);
}

export async function cancelDispatchAction(fd: FormData) {
  const actor = await currentActor();
  const noteId = String(fd.get("noteId"));
  try {
    await prisma.$transaction((tx) => cancelDispatch(tx, actor, noteId));
  } catch (err) {
    if (err instanceof DispatchValidationError || err instanceof StockError) {
      redirect(`/dispatch/${noteId}?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }
  revalidatePath(`/dispatch/${noteId}`);
  redirect(`/dispatch/${noteId}`);
}

// --- e-invoice (IRN) & e-way bill (S23) ----------------------------------------------

async function einvoice(noteId: string, work: () => Promise<unknown>) {
  try {
    await work();
  } catch (err) {
    if (err instanceof EInvoiceError) {
      redirect(`/dispatch/${noteId}?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }
  revalidatePath(`/dispatch/${noteId}`);
  redirect(`/dispatch/${noteId}`);
}

export async function generateIrnAction(fd: FormData) {
  const actor = await currentActor();
  const noteId = String(fd.get("noteId"));
  const invoiceId = String(fd.get("invoiceId"));
  await einvoice(noteId, () =>
    prisma.$transaction((tx) => generateIrn(tx, actor, invoiceId)),
  );
}

export async function generateEwayBillAction(fd: FormData) {
  const actor = await currentActor();
  const noteId = String(fd.get("noteId"));
  const invoiceId = String(fd.get("invoiceId"));
  const distanceKm = Number(str(fd.get("distanceKm")) ?? "0") || 0;
  await einvoice(noteId, () =>
    prisma.$transaction((tx) => generateEwayBill(tx, actor, invoiceId, { distanceKm })),
  );
}

export async function cancelIrnAction(fd: FormData) {
  const actor = await currentActor();
  const noteId = String(fd.get("noteId"));
  const invoiceId = String(fd.get("invoiceId"));
  const reason = str(fd.get("reason")) ?? "";
  await einvoice(noteId, () =>
    prisma.$transaction((tx) => cancelIrn(tx, actor, invoiceId, { reason })),
  );
}
