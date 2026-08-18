"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { requireActor, AuthzError } from "@/lib/rbac";
import { Decimal } from "@/lib/decimal";
import type { CostRateBasis, CostRateKind } from "@prisma/client";
import {
  upsertCostRate,
  computeLotCost,
  computeConvertingCost,
  CostingError,
} from "@/lib/costing";

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

export async function upsertCostRateAction(fd: FormData) {
  const actor = await currentActor();
  const ratePaise = rupeesToPaise(str(fd.get("rate")));
  const effectiveFrom = str(fd.get("effectiveFrom"));
  try {
    await prisma.$transaction((tx) =>
      upsertCostRate(tx, actor, {
        kind: (str(fd.get("kind")) ?? "LABOUR") as CostRateKind,
        ratePaise: ratePaise ?? 0n,
        basis: (str(fd.get("basis")) ?? "PER_KG") as CostRateBasis,
        effectiveFrom: effectiveFrom ? new Date(effectiveFrom) : new Date(),
      }),
    );
  } catch (err) {
    if (err instanceof CostingError || err instanceof AuthzError) {
      redirect(`/costing/rates?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }
  revalidatePath("/costing/rates");
  redirect("/costing/rates");
}

export async function computeLotCostAction(fd: FormData) {
  const actor = await currentActor();
  const lotId = String(fd.get("lotId"));
  try {
    await prisma.$transaction((tx) => computeLotCost(tx, actor, lotId));
  } catch (err) {
    if (err instanceof CostingError || err instanceof AuthzError) {
      redirect(`/costing/lots/${lotId}?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }
  revalidatePath(`/costing/lots/${lotId}`);
  redirect(`/costing/lots/${lotId}`);
}

export async function computeConvertingCostAction(fd: FormData) {
  const actor = await currentActor();
  const orderId = String(fd.get("orderId"));
  try {
    await prisma.$transaction((tx) => computeConvertingCost(tx, actor, orderId));
  } catch (err) {
    if (err instanceof CostingError || err instanceof AuthzError) {
      redirect(`/converting/${orderId}?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }
  revalidatePath(`/converting/${orderId}`);
  redirect(`/converting/${orderId}`);
}
