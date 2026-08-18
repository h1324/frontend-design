"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { requireActor } from "@/lib/rbac";
import { Decimal } from "@/lib/decimal";
import { StockError } from "@/lib/stock-ledger";
import { inspectGrnLine, inspectLot, QcValidationError } from "@/lib/qc";

async function currentActor() {
  return requireActor(await auth());
}
function str(v: FormDataEntryValue | null): string | undefined {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? undefined : s;
}

const PATH = "/qc/queue";

async function run(work: () => Promise<unknown>) {
  try {
    await work();
  } catch (err) {
    if (err instanceof QcValidationError || err instanceof StockError) {
      redirect(`${PATH}?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }
  revalidatePath(PATH);
  redirect(PATH);
}

/** Disposition a GRN line. The passed quantity (vs received) determines PASS/FAIL/PARTIAL. */
export async function inspectGrnLineAction(fd: FormData) {
  const actor = await currentActor();
  const grnLineId = String(fd.get("grnLineId"));
  const received = new Decimal(str(fd.get("received")) ?? "0");
  const passed = new Decimal(str(fd.get("passedQty")) ?? "0");
  const result = passed.gte(received) ? "PASS" : passed.lte(0) ? "FAIL" : "PARTIAL";
  await run(() =>
    prisma.$transaction((tx) =>
      inspectGrnLine(tx, actor, grnLineId, {
        result,
        qtyPassed: passed.toString(),
        remarks: str(fd.get("remarks")) ?? null,
      }),
    ),
  );
}

/** Per-lot roll QC sign-off: every pending roll passes except those ticked to fail. */
export async function inspectLotAction(fd: FormData) {
  const actor = await currentActor();
  const lotId = String(fd.get("lotId"));
  const failedRollIds = fd.getAll("failRollId").map(String).filter(Boolean);
  await run(() =>
    prisma.$transaction((tx) =>
      inspectLot(tx, actor, lotId, {
        failedRollIds,
        remarks: str(fd.get("remarks")) ?? null,
      }),
    ),
  );
}
