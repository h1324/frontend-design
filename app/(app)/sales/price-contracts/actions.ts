"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { CustomerTier } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { requireActor, AuthzError } from "@/lib/rbac";
import { Decimal } from "@/lib/decimal";
import {
  upsertPriceContract,
  cancelPriceContract,
  upsertValueDiscountTier,
  cancelValueDiscountTier,
  QuotationError,
  type PriceContractLineInput,
} from "@/lib/pricing";

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
const TIERS: CustomerTier[] = ["A", "B", "C", "UNGRADED"];
function asTier(v: string | undefined): CustomerTier | null {
  return v && (TIERS as string[]).includes(v) ? (v as CustomerTier) : null;
}

function fail(msg: string): never {
  redirect(`/sales/price-contracts?error=${encodeURIComponent(msg)}`);
}

async function readContractLines(
  fd: FormData,
  companyId: string,
): Promise<PriceContractLineInput[]> {
  const itemIds = fd.getAll("lineItemId").map(String);
  const minQtys = fd.getAll("lineMinQty").map(String);
  const rates = fd.getAll("lineRate").map(String);
  const wanted = itemIds.map((s) => s.trim()).filter(Boolean);
  const items = wanted.length
    ? await prisma.item.findMany({ where: { companyId, id: { in: wanted } } })
    : [];
  const gstById = new Map(items.map((i) => [i.id, i.gstRatePct?.toString() ?? "0"]));

  const lines: PriceContractLineInput[] = [];
  for (let i = 0; i < itemIds.length; i++) {
    const itemId = itemIds[i]?.trim();
    const rate = rupeesToPaise(rates[i]?.trim());
    if (!itemId || rate == null) continue;
    lines.push({
      itemId,
      minQty: minQtys[i]?.trim() || "0",
      ratePaise: rate,
      gstRatePct: gstById.get(itemId) ?? "0",
    });
  }
  return lines;
}

export async function createPriceContractAction(fd: FormData) {
  const actor = await currentActor();
  const scope = str(fd.get("scope")) === "TIER" ? "TIER" : "CUSTOMER";
  const validUntilStr = str(fd.get("validUntil"));
  try {
    await prisma.$transaction(async (tx) =>
      upsertPriceContract(tx, actor, {
        scope,
        customerId: scope === "CUSTOMER" ? (str(fd.get("customerId")) ?? null) : null,
        tier: scope === "TIER" ? asTier(str(fd.get("tier"))) : null,
        validUntil: validUntilStr ? new Date(validUntilStr) : null,
        lines: await readContractLines(fd, actor.companyId),
      }),
    );
  } catch (err) {
    if (err instanceof QuotationError || err instanceof AuthzError) fail(err.message);
    throw err;
  }
  revalidatePath("/sales/price-contracts");
  redirect("/sales/price-contracts");
}

export async function cancelPriceContractAction(fd: FormData) {
  const actor = await currentActor();
  const id = String(fd.get("id"));
  try {
    await prisma.$transaction((tx) => cancelPriceContract(tx, actor, id));
  } catch (err) {
    if (err instanceof QuotationError || err instanceof AuthzError) fail(err.message);
    throw err;
  }
  revalidatePath("/sales/price-contracts");
  redirect("/sales/price-contracts");
}

export async function createValueDiscountAction(fd: FormData) {
  const actor = await currentActor();
  const scope = str(fd.get("scope")) === "TIER" ? "TIER" : "CUSTOMER";
  const threshold = rupeesToPaise(str(fd.get("minOrderValue")));
  const validUntilStr = str(fd.get("validUntil"));
  try {
    await prisma.$transaction((tx) =>
      upsertValueDiscountTier(tx, actor, {
        scope,
        customerId: scope === "CUSTOMER" ? (str(fd.get("customerId")) ?? null) : null,
        tier: scope === "TIER" ? asTier(str(fd.get("tier"))) : null,
        minOrderValuePaise: threshold ?? 0,
        discountPct: str(fd.get("discountPct")) ?? "0",
        validUntil: validUntilStr ? new Date(validUntilStr) : null,
      }),
    );
  } catch (err) {
    if (err instanceof QuotationError || err instanceof AuthzError) fail(err.message);
    throw err;
  }
  revalidatePath("/sales/price-contracts");
  redirect("/sales/price-contracts");
}

export async function cancelValueDiscountAction(fd: FormData) {
  const actor = await currentActor();
  const id = String(fd.get("id"));
  try {
    await prisma.$transaction((tx) => cancelValueDiscountTier(tx, actor, id));
  } catch (err) {
    if (err instanceof QuotationError || err instanceof AuthzError) fail(err.message);
    throw err;
  }
  revalidatePath("/sales/price-contracts");
  redirect("/sales/price-contracts");
}
