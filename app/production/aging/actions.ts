"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { requireActor, requireAccess, AuthzError } from "@/lib/rbac";
import { agingSweep, releaseEarly, AgingValidationError } from "@/lib/aging";

const PATH = "/production/aging";

async function currentActor() {
  return requireActor(await auth());
}
function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Run the curing→available sweep on demand for the current company (PRODUCTION/ADMIN). */
export async function runSweepAction() {
  const actor = await currentActor();
  requireAccess(actor, "PRODUCTION", "write");
  const res = await prisma.$transaction((tx) =>
    agingSweep(tx, actor.companyId, new Date(), actor.userId),
  );
  revalidatePath(PATH);
  redirect(`${PATH}?swept=${res.flipped}`);
}

/** Supervisor early release of a curing roll (override, reason required). */
export async function releaseEarlyAction(fd: FormData) {
  const actor = await currentActor();
  const rollId = str(fd.get("rollId"));
  const reason = str(fd.get("reason"));
  try {
    await prisma.$transaction((tx) => releaseEarly(tx, actor, rollId, reason));
  } catch (err) {
    if (err instanceof AgingValidationError || err instanceof AuthzError) {
      redirect(`${PATH}?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }
  revalidatePath(PATH);
  redirect(PATH);
}
