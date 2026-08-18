"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { CustomerTier } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { requireActor } from "@/lib/rbac";
import {
  createCustomer,
  updateCustomer,
  setCustomerActive,
  addShipTo,
  setDefaultShipTo,
  CustomerValidationError,
  type CustomerInput,
  type CustomerPatch,
  type ShipToInput,
} from "@/lib/customers";

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

function readCustomerFields(formData: FormData): CustomerInput {
  return {
    code: str(formData.get("code")) ?? "",
    name: str(formData.get("name")) ?? "",
    legalName: str(formData.get("legalName")) ?? null,
    gstin: str(formData.get("gstin")) ?? null,
    pan: str(formData.get("pan")) ?? null,
    creditLimit: str(formData.get("creditLimit")) ?? null,
    creditDays: int(formData.get("creditDays")) ?? null,
    paymentTerms: str(formData.get("paymentTerms")) ?? null,
    transporterPreference: str(formData.get("transporterPreference")) ?? null,
    tier: (str(formData.get("tier")) as CustomerTier) ?? "UNGRADED",
  };
}

function readShipTo(formData: FormData): ShipToInput | null {
  const gstStateCode = str(formData.get("shipStateCode"));
  if (!gstStateCode) return null;
  return {
    label: str(formData.get("shipLabel")) ?? "Primary",
    gstStateCode,
    isDefault: true,
    address: {
      line1: str(formData.get("shipLine1")) ?? null,
      city: str(formData.get("shipCity")) ?? null,
      state: str(formData.get("shipState")) ?? null,
      pincode: str(formData.get("shipPincode")) ?? null,
    },
  };
}

export async function createCustomerAction(formData: FormData) {
  const actor = await currentActor();
  const input = readCustomerFields(formData);
  const shipTo = readShipTo(formData);
  if (shipTo) input.shipTos = [shipTo];
  try {
    await prisma.$transaction((tx) => createCustomer(tx, actor, input));
  } catch (err) {
    if (err instanceof CustomerValidationError) {
      redirect(`/masters/customers?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }
  revalidatePath("/masters/customers");
  redirect("/masters/customers");
}

export async function updateCustomerAction(formData: FormData) {
  const actor = await currentActor();
  const customerId = String(formData.get("customerId"));
  const { code: _code, ...patch } = readCustomerFields(formData);
  void _code;
  try {
    await prisma.$transaction((tx) =>
      updateCustomer(tx, actor, customerId, patch as CustomerPatch),
    );
  } catch (err) {
    if (err instanceof CustomerValidationError) {
      redirect(
        `/masters/customers/${customerId}/edit?error=${encodeURIComponent(err.message)}`,
      );
    }
    throw err;
  }
  revalidatePath("/masters/customers");
  redirect("/masters/customers");
}

export async function setCustomerActiveAction(formData: FormData) {
  const actor = await currentActor();
  await prisma.$transaction((tx) =>
    setCustomerActive(
      tx,
      actor,
      String(formData.get("customerId")),
      formData.get("isActive") === "true",
    ),
  );
  revalidatePath("/masters/customers");
}

export async function addShipToAction(formData: FormData) {
  const actor = await currentActor();
  const customerId = String(formData.get("customerId"));
  const gstStateCode = str(formData.get("gstStateCode")) ?? "";
  try {
    await prisma.$transaction((tx) =>
      addShipTo(tx, actor, customerId, {
        label: str(formData.get("label")) ?? "",
        gstStateCode,
        address: {
          line1: str(formData.get("line1")) ?? null,
          city: str(formData.get("city")) ?? null,
          state: str(formData.get("state")) ?? null,
          pincode: str(formData.get("pincode")) ?? null,
        },
      }),
    );
  } catch (err) {
    if (err instanceof CustomerValidationError) {
      redirect(
        `/masters/customers/${customerId}/edit?error=${encodeURIComponent(err.message)}`,
      );
    }
    throw err;
  }
  revalidatePath(`/masters/customers/${customerId}/edit`);
  redirect(`/masters/customers/${customerId}/edit`);
}

export async function setDefaultShipToAction(formData: FormData) {
  const actor = await currentActor();
  const customerId = String(formData.get("customerId"));
  await prisma.$transaction((tx) =>
    setDefaultShipTo(tx, actor, String(formData.get("shipToId"))),
  );
  revalidatePath(`/masters/customers/${customerId}/edit`);
}
