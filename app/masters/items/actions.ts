"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ItemType, SurfaceTreatment } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { requireActor } from "@/lib/rbac";
import {
  createItem,
  updateItem,
  setItemActive,
  ItemValidationError,
  type ItemInput,
  type ItemPatch,
} from "@/lib/items";

async function currentActor() {
  return requireActor(await auth());
}

function str(v: FormDataEntryValue | null): string | undefined {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? undefined : s;
}

function int(v: FormDataEntryValue | null): number | undefined {
  const s = str(v);
  return s === undefined ? undefined : Number(s);
}

function readItemForm(formData: FormData): ItemInput {
  return {
    code: str(formData.get("code")) ?? "",
    name: str(formData.get("name")) ?? "",
    type: (str(formData.get("type")) ?? "FINISHED_GOOD") as ItemType,
    uomBase: str(formData.get("uomBase")) ?? "M2",
    hsnCode: str(formData.get("hsnCode")) ?? null,
    grade: str(formData.get("grade")) ?? null,
    thickness_mm: str(formData.get("thickness_mm")) ?? null,
    width_mm: str(formData.get("width_mm")) ?? null,
    density_kg_m3: str(formData.get("density_kg_m3")) ?? null,
    colour: str(formData.get("colour")) ?? null,
    layerCount: int(formData.get("layerCount")) ?? null,
    surfaceTreatment: (str(formData.get("surfaceTreatment")) as SurfaceTreatment) ?? null,
    agingDays: int(formData.get("agingDays")) ?? null,
    reorderLevel: str(formData.get("reorderLevel")) ?? null,
  };
}

export async function createItemAction(formData: FormData) {
  const actor = await currentActor();
  try {
    await prisma.$transaction((tx) => createItem(tx, actor, readItemForm(formData)));
  } catch (err) {
    if (err instanceof ItemValidationError) {
      redirect(`/masters/items?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }
  revalidatePath("/masters/items");
  redirect("/masters/items");
}

export async function updateItemAction(formData: FormData) {
  const actor = await currentActor();
  const itemId = String(formData.get("itemId"));
  const input = readItemForm(formData);
  // code and type are immutable; send only the mutable fields.
  const patch: ItemPatch = {
    name: input.name,
    uomBase: input.uomBase,
    hsnCode: input.hsnCode,
    grade: input.grade,
    thickness_mm: input.thickness_mm,
    width_mm: input.width_mm,
    density_kg_m3: input.density_kg_m3,
    colour: input.colour,
    layerCount: input.layerCount,
    surfaceTreatment: input.surfaceTreatment,
    agingDays: input.agingDays,
    reorderLevel: input.reorderLevel,
  };
  try {
    await prisma.$transaction((tx) => updateItem(tx, actor, itemId, patch));
  } catch (err) {
    if (err instanceof ItemValidationError) {
      redirect(`/masters/items/${itemId}/edit?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }
  revalidatePath("/masters/items");
  redirect("/masters/items");
}

export async function setItemActiveAction(formData: FormData) {
  const actor = await currentActor();
  await prisma.$transaction((tx) =>
    setItemActive(
      tx,
      actor,
      String(formData.get("itemId")),
      formData.get("isActive") === "true",
    ),
  );
  revalidatePath("/masters/items");
}
