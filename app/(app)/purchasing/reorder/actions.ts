"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { requireActor } from "@/lib/rbac";
import {
  runReorderScan,
  draftPoFromSuggestion,
  dismissSuggestion,
  setReorderPolicy,
  ReorderError,
} from "@/lib/reorder";

async function currentActor() {
  return requireActor(await auth());
}
function str(v: FormDataEntryValue | null): string | undefined {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? undefined : s;
}

const PATH = "/purchasing/reorder";

/** Run the on-demand reorder scan, materialising fresh OPEN suggestions. */
export async function runReorderScanAction() {
  const actor = await currentActor();
  try {
    await prisma.$transaction((tx) => runReorderScan(tx, actor));
  } catch (err) {
    if (err instanceof ReorderError) {
      redirect(`${PATH}?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }
  revalidatePath(PATH);
  redirect(PATH);
}

/** Draft a DRAFT PO from an OPEN suggestion and land the buyer on it. */
export async function draftPoAction(fd: FormData) {
  const actor = await currentActor();
  const suggestionId = String(fd.get("suggestionId"));
  let poId: string | undefined;
  try {
    const res = await prisma.$transaction((tx) =>
      draftPoFromSuggestion(tx, actor, suggestionId),
    );
    poId = res.poId;
  } catch (err) {
    if (err instanceof ReorderError) {
      redirect(`${PATH}?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }
  revalidatePath(PATH);
  redirect(`/purchasing/orders/${poId}`);
}

/** Dismiss an OPEN suggestion with a reason. */
export async function dismissSuggestionAction(fd: FormData) {
  const actor = await currentActor();
  const suggestionId = String(fd.get("suggestionId"));
  const reason = str(fd.get("reason")) ?? "";
  try {
    await prisma.$transaction((tx) => dismissSuggestion(tx, actor, suggestionId, reason));
  } catch (err) {
    if (err instanceof ReorderError) {
      redirect(`${PATH}?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }
  revalidatePath(PATH);
  redirect(PATH);
}

/** Edit an item's reorder thresholds (lead time, safety stock, manual point, policy). Empty
 *  fields are left unchanged — the forms tune one value at a time. */
export async function setReorderPolicyAction(fd: FormData) {
  const actor = await currentActor();
  const itemId = String(fd.get("itemId"));
  const leadRaw = str(fd.get("leadTimeDays"));
  const safety = str(fd.get("safetyStock"));
  const point = str(fd.get("reorderPoint"));
  const policy = str(fd.get("reorderPolicy"));
  try {
    await prisma.$transaction((tx) =>
      setReorderPolicy(tx, actor, itemId, {
        ...(leadRaw !== undefined ? { leadTimeDays: Number(leadRaw) } : {}),
        ...(safety !== undefined ? { safetyStock: safety } : {}),
        ...(point !== undefined ? { reorderPoint: point } : {}),
        ...(policy === "MANUAL" || policy === "AUTO_SUGGEST"
          ? { reorderPolicy: policy }
          : {}),
      }),
    );
  } catch (err) {
    if (err instanceof ReorderError) {
      redirect(`${PATH}?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }
  revalidatePath(PATH);
  redirect(PATH);
}
