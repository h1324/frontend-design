"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { requireActor } from "@/lib/rbac";
import { Decimal } from "@/lib/decimal";
import { StockError } from "@/lib/stock-ledger";
import {
  createReceipt,
  cancelReceipt,
  createIssue,
  cancelIssue,
  StoresValidationError,
} from "@/lib/rm-stores";

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

async function run(path: string, work: () => Promise<unknown>) {
  try {
    await work();
  } catch (err) {
    if (err instanceof StoresValidationError || err instanceof StockError) {
      redirect(`${path}?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }
  revalidatePath(path);
  redirect(path);
}

// --- receipts ------------------------------------------------------------------------

export async function createReceiptAction(fd: FormData) {
  const actor = await currentActor();
  await run("/stores/receipts", () =>
    prisma.$transaction((tx) =>
      createReceipt(tx, actor, {
        supplierId: str(fd.get("supplierId")) ?? null,
        refNote: str(fd.get("refNote")) ?? null,
        lines: [
          {
            itemId: str(fd.get("itemId")) ?? "",
            locationId: str(fd.get("locationId")) ?? "",
            qtyBase: str(fd.get("qtyBase")) ?? "0",
            ratePaise: rupeesToPaise(fd.get("rate")),
          },
        ],
      }),
    ),
  );
}

export async function cancelReceiptAction(fd: FormData) {
  const actor = await currentActor();
  await run("/stores/receipts", () =>
    prisma.$transaction((tx) => cancelReceipt(tx, actor, String(fd.get("id")))),
  );
}

// --- issues --------------------------------------------------------------------------

export async function createIssueAction(fd: FormData) {
  const actor = await currentActor();
  await run("/stores/issues", () =>
    prisma.$transaction((tx) =>
      createIssue(tx, actor, {
        lotId: str(fd.get("lotId")) ?? null,
        refNote: str(fd.get("refNote")) ?? null,
        lines: [
          {
            itemId: str(fd.get("itemId")) ?? "",
            locationId: str(fd.get("locationId")) ?? "",
            qtyBase: str(fd.get("qtyBase")) ?? "0",
            isRegrind: fd.get("isRegrind") === "on",
          },
        ],
      }),
    ),
  );
}

export async function cancelIssueAction(fd: FormData) {
  const actor = await currentActor();
  await run("/stores/issues", () =>
    prisma.$transaction((tx) => cancelIssue(tx, actor, String(fd.get("id")))),
  );
}
