"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { requireActor, AuthzError } from "@/lib/rbac";
import {
  exportInvoice,
  importReceipts,
  retry,
  pendingInvoiceExports,
  TallySyncError,
} from "@/lib/tally/tally-sync";

async function currentActor() {
  return requireActor(await auth());
}

function fail(err: unknown): never {
  if (err instanceof TallySyncError || err instanceof AuthzError) {
    redirect(`/integrations/tally?error=${encodeURIComponent((err as Error).message)}`);
  }
  throw err;
}

/** Export every issued invoice not yet ACK-synced to Tally (MOCK connector). */
export async function syncInvoicesOutAction() {
  const actor = await currentActor();
  try {
    const pending = await pendingInvoiceExports(prisma, actor.companyId);
    for (const inv of pending) {
      await prisma.$transaction((tx) => exportInvoice(tx, actor, inv.id));
    }
  } catch (err) {
    fail(err);
  }
  revalidatePath("/integrations/tally");
  redirect("/integrations/tally");
}

/** Pull receipt vouchers from Tally and import them as S19 receipts (MOCK connector). */
export async function importReceiptsAction() {
  const actor = await currentActor();
  try {
    await prisma.$transaction((tx) => importReceipts(tx, actor, {}));
  } catch (err) {
    fail(err);
  }
  revalidatePath("/integrations/tally");
  redirect("/integrations/tally");
}

export async function retrySyncAction(fd: FormData) {
  const actor = await currentActor();
  const syncId = String(fd.get("syncId"));
  try {
    await prisma.$transaction((tx) => retry(tx, actor, syncId));
  } catch (err) {
    fail(err);
  }
  revalidatePath("/integrations/tally");
  redirect("/integrations/tally");
}
