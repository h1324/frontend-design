"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { requireActor } from "@/lib/rbac";
import {
  createSupplier,
  updateSupplier,
  setSupplierActive,
  SupplierValidationError,
  type SupplierInput,
} from "@/lib/suppliers";

async function currentActor() {
  return requireActor(await auth());
}

function str(v: FormDataEntryValue | null): string | undefined {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? undefined : s;
}

function readSupplierForm(formData: FormData): SupplierInput {
  return {
    code: str(formData.get("code")) ?? "",
    name: str(formData.get("name")) ?? "",
    legalName: str(formData.get("legalName")) ?? null,
    gstin: str(formData.get("gstin")) ?? null,
    paymentTerms: str(formData.get("paymentTerms")) ?? null,
    address: {
      line1: str(formData.get("line1")) ?? null,
      city: str(formData.get("city")) ?? null,
      state: str(formData.get("state")) ?? null,
      pincode: str(formData.get("pincode")) ?? null,
    },
    contact: {
      person: str(formData.get("person")) ?? null,
      phone: str(formData.get("phone")) ?? null,
      email: str(formData.get("email")) ?? null,
    },
    supplies: formData.getAll("supplies").map(String),
  };
}

export async function createSupplierAction(formData: FormData) {
  const actor = await currentActor();
  try {
    await prisma.$transaction((tx) =>
      createSupplier(tx, actor, readSupplierForm(formData)),
    );
  } catch (err) {
    if (err instanceof SupplierValidationError) {
      redirect(`/masters/suppliers?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }
  revalidatePath("/masters/suppliers");
  redirect("/masters/suppliers");
}

export async function updateSupplierAction(formData: FormData) {
  const actor = await currentActor();
  const supplierId = String(formData.get("supplierId"));
  const { code: _code, ...patch } = readSupplierForm(formData);
  void _code;
  try {
    await prisma.$transaction((tx) => updateSupplier(tx, actor, supplierId, patch));
  } catch (err) {
    if (err instanceof SupplierValidationError) {
      redirect(
        `/masters/suppliers/${supplierId}/edit?error=${encodeURIComponent(err.message)}`,
      );
    }
    throw err;
  }
  revalidatePath("/masters/suppliers");
  redirect("/masters/suppliers");
}

export async function setSupplierActiveAction(formData: FormData) {
  const actor = await currentActor();
  await prisma.$transaction((tx) =>
    setSupplierActive(
      tx,
      actor,
      String(formData.get("supplierId")),
      formData.get("isActive") === "true",
    ),
  );
  revalidatePath("/masters/suppliers");
}
