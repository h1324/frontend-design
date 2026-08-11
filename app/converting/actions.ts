"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ConvertingOperation } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { requireActor } from "@/lib/rbac";
import { StockError } from "@/lib/stock-ledger";
import {
  openConverting,
  pickParents,
  closeConverting,
  cancelConverting,
  ConvertingValidationError,
  type ChildRollInput,
} from "@/lib/converting";

async function currentActor() {
  return requireActor(await auth());
}
function str(v: FormDataEntryValue | null): string | undefined {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? undefined : s;
}

export async function openConvertingAction(fd: FormData) {
  const actor = await currentActor();
  let newId: string | undefined;
  try {
    const order = await prisma.$transaction((tx) =>
      openConverting(tx, actor, {
        operation: (str(fd.get("operation")) ?? "SLITTING") as ConvertingOperation,
        machineId: str(fd.get("machineId")) ?? "",
        shiftId: str(fd.get("shiftId")) ?? "",
        operatorId: str(fd.get("operatorId")) ?? "",
        targetItemId: str(fd.get("targetItemId")) ?? "",
      }),
    );
    newId = order.id;
  } catch (err) {
    if (err instanceof ConvertingValidationError) {
      redirect(`/converting?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }
  revalidatePath("/converting");
  redirect(`/converting/${newId}`);
}

async function run(orderId: string, work: () => Promise<unknown>) {
  try {
    await work();
  } catch (err) {
    if (err instanceof ConvertingValidationError || err instanceof StockError) {
      redirect(`/converting/${orderId}?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }
  revalidatePath(`/converting/${orderId}`);
  redirect(`/converting/${orderId}`);
}

export async function pickParentsAction(fd: FormData) {
  const actor = await currentActor();
  const orderId = String(fd.get("orderId"));
  const rollIds = fd.getAll("rollIds").map(String).filter(Boolean);
  const overrideReason = str(fd.get("overrideReason"));
  await run(orderId, () =>
    prisma.$transaction((tx) =>
      pickParents(
        tx,
        actor,
        orderId,
        rollIds,
        overrideReason ? { reason: overrideReason } : undefined,
      ),
    ),
  );
}

/** Close a converting order. Children share one dimension set; one weight per child. */
export async function closeConvertingAction(fd: FormData) {
  const actor = await currentActor();
  const orderId = String(fd.get("orderId"));
  const locationId = str(fd.get("locationId")) ?? "";
  const dims = {
    length_m: str(fd.get("length_m")) ?? "0",
    width_m: str(fd.get("width_m")) ?? "0",
    layers: [
      {
        thickness_mm: str(fd.get("thickness_mm")) ?? "0",
        density_kg_m3: str(fd.get("density_kg_m3")) ?? "0",
      },
    ],
  };
  const weights = (str(fd.get("weightsKg")) ?? "")
    .split(/[\s,]+/)
    .map((w) => w.trim())
    .filter(Boolean);
  const children: ChildRollInput[] = weights.map((actualKg) => ({
    locationId,
    dimensions: dims,
    actualKg,
  }));
  await run(orderId, () =>
    prisma.$transaction((tx) =>
      closeConverting(tx, actor, orderId, {
        children,
        scrapKg: str(fd.get("scrapKg")) ?? "0",
        trimKg: str(fd.get("trimKg")) ?? "0",
      }),
    ),
  );
}

export async function cancelConvertingAction(fd: FormData) {
  const actor = await currentActor();
  const orderId = String(fd.get("orderId"));
  await run(orderId, () =>
    prisma.$transaction((tx) => cancelConverting(tx, actor, orderId)),
  );
}
