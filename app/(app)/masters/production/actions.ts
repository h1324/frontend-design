"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { DowntimeCategory } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { requireActor } from "@/lib/rbac";
import {
  createMachine,
  updateMachine,
  setMachineActive,
  createShift,
  updateShift,
  setShiftActive,
  createOperator,
  updateOperator,
  setOperatorActive,
  createDowntimeReason,
  updateDowntimeReason,
  setDowntimeReasonActive,
  ProductionMasterValidationError,
} from "@/lib/production-masters";

const PATH = "/masters/production";

async function actor() {
  return requireActor(await auth());
}
function str(v: FormDataEntryValue | null): string | undefined {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? undefined : s;
}
function done() {
  revalidatePath(PATH);
  redirect(PATH);
}
async function run(work: () => Promise<unknown>) {
  try {
    await work();
  } catch (err) {
    if (err instanceof ProductionMasterValidationError) {
      redirect(`${PATH}?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }
  done();
}

// --- machine -------------------------------------------------------------------------

export async function createMachineAction(fd: FormData) {
  const a = await actor();
  await run(() =>
    prisma.$transaction((tx) =>
      createMachine(tx, a, {
        code: str(fd.get("code")) ?? "",
        name: str(fd.get("name")) ?? "",
        ratedCapacityKgHr: str(fd.get("ratedCapacityKgHr")) ?? null,
      }),
    ),
  );
}
export async function updateMachineAction(fd: FormData) {
  const a = await actor();
  await run(() =>
    prisma.$transaction((tx) =>
      updateMachine(tx, a, String(fd.get("id")), {
        name: str(fd.get("name")),
        ratedCapacityKgHr: str(fd.get("ratedCapacityKgHr")) ?? null,
      }),
    ),
  );
}
export async function setMachineActiveAction(fd: FormData) {
  const a = await actor();
  await prisma.$transaction((tx) =>
    setMachineActive(tx, a, String(fd.get("id")), fd.get("isActive") === "true"),
  );
  revalidatePath(PATH);
}

// --- shift ---------------------------------------------------------------------------

export async function createShiftAction(fd: FormData) {
  const a = await actor();
  await run(() =>
    prisma.$transaction((tx) =>
      createShift(tx, a, {
        code: str(fd.get("code")) ?? "",
        name: str(fd.get("name")) ?? "",
        startTime: str(fd.get("startTime")) ?? "",
        endTime: str(fd.get("endTime")) ?? "",
      }),
    ),
  );
}
export async function updateShiftAction(fd: FormData) {
  const a = await actor();
  await run(() =>
    prisma.$transaction((tx) =>
      updateShift(tx, a, String(fd.get("id")), {
        name: str(fd.get("name")),
        startTime: str(fd.get("startTime")),
        endTime: str(fd.get("endTime")),
      }),
    ),
  );
}
export async function setShiftActiveAction(fd: FormData) {
  const a = await actor();
  await prisma.$transaction((tx) =>
    setShiftActive(tx, a, String(fd.get("id")), fd.get("isActive") === "true"),
  );
  revalidatePath(PATH);
}

// --- operator ------------------------------------------------------------------------

export async function createOperatorAction(fd: FormData) {
  const a = await actor();
  await run(() =>
    prisma.$transaction((tx) =>
      createOperator(tx, a, {
        code: str(fd.get("code")) ?? "",
        name: str(fd.get("name")) ?? "",
      }),
    ),
  );
}
export async function updateOperatorAction(fd: FormData) {
  const a = await actor();
  await run(() =>
    prisma.$transaction((tx) =>
      updateOperator(tx, a, String(fd.get("id")), { name: str(fd.get("name")) }),
    ),
  );
}
export async function setOperatorActiveAction(fd: FormData) {
  const a = await actor();
  await prisma.$transaction((tx) =>
    setOperatorActive(tx, a, String(fd.get("id")), fd.get("isActive") === "true"),
  );
  revalidatePath(PATH);
}

// --- downtime reason -----------------------------------------------------------------

export async function createDowntimeReasonAction(fd: FormData) {
  const a = await actor();
  await run(() =>
    prisma.$transaction((tx) =>
      createDowntimeReason(tx, a, {
        code: str(fd.get("code")) ?? "",
        description: str(fd.get("description")) ?? "",
        category: (str(fd.get("category")) ?? "OTHER") as DowntimeCategory,
      }),
    ),
  );
}
export async function updateDowntimeReasonAction(fd: FormData) {
  const a = await actor();
  await run(() =>
    prisma.$transaction((tx) =>
      updateDowntimeReason(tx, a, String(fd.get("id")), {
        description: str(fd.get("description")),
        category: (str(fd.get("category")) ?? "OTHER") as DowntimeCategory,
      }),
    ),
  );
}
export async function setDowntimeReasonActiveAction(fd: FormData) {
  const a = await actor();
  await prisma.$transaction((tx) =>
    setDowntimeReasonActive(tx, a, String(fd.get("id")), fd.get("isActive") === "true"),
  );
  revalidatePath(PATH);
}
