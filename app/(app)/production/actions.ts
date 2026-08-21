"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { requireActor } from "@/lib/rbac";
import { StockError } from "@/lib/stock-ledger";
import {
  openLot,
  addDowntime,
  closeLot,
  cancelLot,
  ProductionValidationError,
  type OutputRollInput,
} from "@/lib/production";

async function currentActor() {
  return requireActor(await auth());
}
function str(v: FormDataEntryValue | null): string | undefined {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? undefined : s;
}

async function run(path: string, work: () => Promise<unknown>) {
  try {
    await work();
  } catch (err) {
    if (err instanceof ProductionValidationError || err instanceof StockError) {
      redirect(`${path}?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }
  revalidatePath(path);
  redirect(path);
}

export async function openLotAction(fd: FormData) {
  const actor = await currentActor();
  const date = str(fd.get("productionDate"));
  await run("/production/lots", () =>
    prisma.$transaction((tx) =>
      openLot(tx, actor, {
        machineId: str(fd.get("machineId")) ?? "",
        shiftId: str(fd.get("shiftId")) ?? "",
        operatorId: str(fd.get("operatorId")) ?? "",
        targetItemId: str(fd.get("targetItemId")) ?? "",
        ...(date ? { productionDate: new Date(date) } : {}),
      }),
    ),
  );
}

export async function addDowntimeAction(fd: FormData) {
  const actor = await currentActor();
  const lotId = String(fd.get("lotId"));
  await run(`/production/lots/${lotId}`, () =>
    prisma.$transaction((tx) =>
      addDowntime(tx, actor, lotId, {
        reasonId: str(fd.get("reasonId")) ?? "",
        minutes: Number(fd.get("minutes")),
        note: str(fd.get("note")) ?? null,
      }),
    ),
  );
}

/** Close a lot. Rolls share one dimension set; one actual weight (kg) per roll is entered as
 *  a whitespace/comma-separated list — manual gross/net capture (spec S10 decision #4). */
export async function closeLotAction(fd: FormData) {
  const actor = await currentActor();
  const lotId = String(fd.get("lotId"));
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
  const rolls: OutputRollInput[] = weights.map((actualKg) => ({
    locationId,
    dimensions: dims,
    actualKg,
  }));
  const energy = str(fd.get("energyKwh"));
  await run(`/production/lots/${lotId}`, () =>
    prisma.$transaction((tx) =>
      closeLot(tx, actor, lotId, {
        rolls,
        scrapKg: str(fd.get("scrapKg")) ?? "0",
        trimKg: str(fd.get("trimKg")) ?? "0",
        energyKwh: energy ?? null,
      }),
    ),
  );
}

export async function cancelLotAction(fd: FormData) {
  const actor = await currentActor();
  const lotId = String(fd.get("lotId"));
  await run(`/production/lots/${lotId}`, () =>
    prisma.$transaction((tx) => cancelLot(tx, actor, lotId)),
  );
}
