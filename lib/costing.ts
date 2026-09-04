// lib/costing.ts — batch / production costing (spec S21).
// Roll cost up from an extrusion lot (and converting order) to a cost per kg and per m²: raw
// material at landed cost (S20) + regrind memo + energy/labour/overhead from effective-dated
// rates, allocated to output rolls by weight. Then margin = invoice sale value − dispatched-roll
// cost. A read model over actuals — it never mutates the stock ledger. Money in paise (BigInt),
// quantities Decimal — no float (CLAUDE.md rule 2). Recomputes are idempotent and audited.

import type {
  CostRate,
  CostRateBasis,
  CostRateKind,
  ConvertingOrderCost,
  LotCost,
  Prisma,
} from "@prisma/client";
import { Decimal, type DecimalInput } from "./decimal.js";
import { requireAccess, AuthzError, type Actor } from "./rbac.js";
import { writeAudit } from "./audit.js";
import { apportion } from "./landed-cost.js";

type Tx = Prisma.TransactionClient;

export class CostingError extends Error {
  override name = "CostingError";
  readonly errors: string[];
  constructor(errors: string[]) {
    super(errors.join("; "));
    this.errors = errors;
  }
}

// --- pure maths ----------------------------------------------------------------------

export interface RateDrivers {
  outputKg: DecimalInput;
  energyKwh?: DecimalInput | null;
  hours?: DecimalInput | null;
  rollCount: number;
}

/** Cost (paise) of a rate against its basis driver. Pure. */
export function applyRate(
  ratePaise: bigint,
  basis: CostRateBasis,
  d: RateDrivers,
): bigint {
  let qty: Decimal;
  switch (basis) {
    case "PER_KWH":
      qty = new Decimal(d.energyKwh ?? 0);
      break;
    case "PER_HOUR":
      qty = new Decimal(d.hours ?? 0);
      break;
    case "PER_ROLL":
      qty = new Decimal(d.rollCount);
      break;
    default: // PER_KG
      qty = new Decimal(d.outputKg);
  }
  return BigInt(
    new Decimal(ratePaise.toString()).times(qty).toDecimalPlaces(0).toFixed(0),
  );
}

/** Per-unit cost (paise) = total ÷ quantity, integer paise. 0 when qty ≤ 0. Pure. */
export function costPerUnit(totalPaise: bigint, qty: DecimalInput): bigint {
  const q = new Decimal(qty);
  if (q.lte(0)) return 0n;
  return BigInt(new Decimal(totalPaise.toString()).div(q).toDecimalPlaces(0).toFixed(0));
}

/** Allocate a total cost across output rolls by weight — exact-to-total per-roll shares
 *  (reuses the S20 apportionment). Pure. */
export function allocateToRolls(rollKgs: DecimalInput[], totalPaise: bigint): bigint[] {
  return apportion(rollKgs, totalPaise);
}

export interface LotCostComponents {
  rmCostPaise: bigint;
  /** Recovered regrind consumed as an input, valued at landed cost — ADDED to the total. */
  regrindCostPaise: bigint;
  energyCostPaise: bigint;
  labourCostPaise: bigint;
  overheadCostPaise: bigint;
}

/** Sum a lot's cost components into its total (paise). Regrind is trim reprocessed back into
 *  granules and blended into the input mix — a valued INPUT consumed by the lot, never a
 *  write-off or by-product credit (CLAUDE.md glossary), so it is ADDED to the total. Pure. */
export function lotTotalCost(c: LotCostComponents): bigint {
  return (
    c.rmCostPaise +
    c.regrindCostPaise +
    c.energyCostPaise +
    c.labourCostPaise +
    c.overheadCostPaise
  );
}

// --- cost rates ----------------------------------------------------------------------

export interface CostRateInput {
  kind: CostRateKind;
  ratePaise: bigint | number;
  basis?: CostRateBasis;
  effectiveFrom: Date;
  effectiveTo?: Date | null;
}

/** Add an effective-dated cost rate. COSTING-write. */
export async function upsertCostRate(
  tx: Tx,
  actor: Actor,
  input: CostRateInput,
): Promise<CostRate> {
  requireAccess(actor, "COSTING", "write");
  const rate = BigInt(input.ratePaise);
  if (rate < 0n) throw new CostingError(["rate must not be negative"]);
  const created = await tx.costRate.create({
    data: {
      companyId: actor.companyId,
      kind: input.kind,
      ratePaise: rate,
      basis: input.basis ?? "PER_KG",
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo ?? null,
      createdById: actor.userId,
    },
  });
  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "CostRate",
    entityId: created.id,
    action: "UPSERT",
    actorUserId: actor.userId,
    after: { kind: created.kind, ratePaise: rate.toString(), basis: created.basis },
  });
  return created;
}

/** The rate of a kind in force on `asOf` — latest `effectiveFrom` that has started and not
 *  ended. Null when none applies. */
export async function effectiveRate(
  db: Tx,
  companyId: string,
  kind: CostRateKind,
  asOf: Date,
): Promise<CostRate | null> {
  return db.costRate.findFirst({
    where: {
      companyId,
      kind,
      effectiveFrom: { lte: asOf },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOf } }],
    },
    orderBy: { effectiveFrom: "desc" },
  });
}

// --- lot cost ------------------------------------------------------------------------

/**
 * Compute (and snapshot) a lot's cost: RM at each item's moving-average landed cost (S20),
 * split into virgin vs regrind memo; plus energy/labour/overhead from the rates effective on
 * the production date. Allocates the total to the lot's output rolls by weight and writes each
 * roll's `unitCostPaise`. Idempotent — re-running recomputes cleanly. COSTING-write.
 */
export async function computeLotCost(
  tx: Tx,
  actor: Actor,
  lotId: string,
): Promise<LotCost> {
  requireAccess(actor, "COSTING", "write");
  const lot = await tx.lot.findFirst({
    where: { id: lotId, companyId: actor.companyId },
    include: {
      rolls: true,
      materialIssues: { include: { lines: { include: { item: true } } } },
    },
  });
  if (!lot) throw new AuthzError("lot not found");

  // RM cost from posted issues, split virgin vs regrind, at moving-average landed cost. Both are
  // consumed inputs valued the same way; the split is a memo — regrind is still ADDED to the total.
  let rmCost = 0n;
  let regrindCost = 0n;
  for (const iss of lot.materialIssues) {
    if (iss.status !== "POSTED") continue;
    for (const line of iss.lines) {
      const value = BigInt(
        new Decimal(line.qtyBase.toString())
          .times(line.item.movingAvgCostPaise.toString())
          .toDecimalPlaces(0)
          .toFixed(0),
      );
      if (line.isRegrind) regrindCost += value;
      else rmCost += value;
    }
  }

  // Output = the lot's live rolls (exclude cancelled).
  const outputRolls = lot.rolls.filter((r) => r.state !== "CANCELLED");
  const outputKg = outputRolls.reduce(
    (s, r) => s.plus(r.qtyKgActual.toString()),
    new Decimal(0),
  );
  const outputM2 = outputRolls.reduce(
    (s, r) => s.plus(r.qtyM2.toString()),
    new Decimal(0),
  );

  const hours =
    lot.startAt && lot.endAt
      ? new Decimal(lot.endAt.getTime() - lot.startAt.getTime()).div(3_600_000)
      : null;
  const drivers: RateDrivers = {
    outputKg: outputKg.toString(),
    energyKwh: lot.energyKwh ? lot.energyKwh.toString() : null,
    hours: hours ? hours.toString() : null,
    rollCount: outputRolls.length,
  };

  const [energyRate, labourRate, overheadRate] = await Promise.all([
    effectiveRate(tx, actor.companyId, "ENERGY", lot.productionDate),
    effectiveRate(tx, actor.companyId, "LABOUR", lot.productionDate),
    effectiveRate(tx, actor.companyId, "OVERHEAD", lot.productionDate),
  ]);
  const energyCost = energyRate
    ? applyRate(energyRate.ratePaise, energyRate.basis, drivers)
    : 0n;
  const labourCost = labourRate
    ? applyRate(labourRate.ratePaise, labourRate.basis, drivers)
    : 0n;
  const overheadCost = overheadRate
    ? applyRate(overheadRate.ratePaise, overheadRate.basis, drivers)
    : 0n;

  const components: LotCostComponents = {
    rmCostPaise: rmCost,
    regrindCostPaise: regrindCost,
    energyCostPaise: energyCost,
    labourCostPaise: labourCost,
    overheadCostPaise: overheadCost,
  };
  const total = lotTotalCost(components);

  // Allocate to output rolls by weight and snapshot each roll's cost.
  const shares = allocateToRolls(
    outputRolls.map((r) => r.qtyKgActual.toString()),
    total,
  );
  for (let i = 0; i < outputRolls.length; i++) {
    await tx.roll.update({
      where: { id: outputRolls[i]!.id },
      data: { unitCostPaise: shares[i]! },
    });
  }

  const data = {
    ...components,
    totalCostPaise: total,
    outputKg: outputKg.toString(),
    outputM2: outputM2.toString(),
    costPerKgPaise: costPerUnit(total, outputKg),
    costPerM2Paise: costPerUnit(total, outputM2),
    computedAt: new Date(),
  };
  const lotCost = await tx.lotCost.upsert({
    where: { lotId: lot.id },
    create: { companyId: actor.companyId, lotId: lot.id, ...data },
    update: data,
  });
  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "Lot",
    entityId: lot.id,
    action: "COST",
    actorUserId: actor.userId,
    after: {
      totalCostPaise: total.toString(),
      costPerKgPaise: data.costPerKgPaise.toString(),
    },
  });
  return lotCost;
}

// --- converting cost -----------------------------------------------------------------

/**
 * Compute (and snapshot) a converting order's cost: the consumed parents' cost (S21 roll
 * snapshots) plus the order's conversion cost (energy/labour/overhead on its output), allocated
 * to the child rolls by weight. Genealogy-aware — parents must be costed first. COSTING-write.
 */
export async function computeConvertingCost(
  tx: Tx,
  actor: Actor,
  orderId: string,
): Promise<ConvertingOrderCost> {
  requireAccess(actor, "COSTING", "write");
  const order = await tx.convertingOrder.findFirst({
    where: { id: orderId, companyId: actor.companyId },
    include: { inputs: { include: { roll: true } }, children: true },
  });
  if (!order) throw new AuthzError("converting order not found");

  const inputCost = order.inputs.reduce(
    (s, inp) => s + (inp.roll.unitCostPaise ?? 0n),
    0n,
  );
  const children = order.children.filter((r) => r.state !== "CANCELLED");
  const outputKg = children.reduce(
    (s, r) => s.plus(r.qtyKgActual.toString()),
    new Decimal(0),
  );

  const asOf = order.endedAt ?? order.startedAt ?? order.createdAt;
  const drivers: RateDrivers = {
    outputKg: outputKg.toString(),
    energyKwh: null,
    hours: null,
    rollCount: children.length,
  };
  const [energyRate, labourRate, overheadRate] = await Promise.all([
    effectiveRate(tx, actor.companyId, "ENERGY", asOf),
    effectiveRate(tx, actor.companyId, "LABOUR", asOf),
    effectiveRate(tx, actor.companyId, "OVERHEAD", asOf),
  ]);
  const conversionCost =
    (energyRate ? applyRate(energyRate.ratePaise, energyRate.basis, drivers) : 0n) +
    (labourRate ? applyRate(labourRate.ratePaise, labourRate.basis, drivers) : 0n) +
    (overheadRate ? applyRate(overheadRate.ratePaise, overheadRate.basis, drivers) : 0n);

  const total = inputCost + conversionCost;
  const shares = allocateToRolls(
    children.map((r) => r.qtyKgActual.toString()),
    total,
  );
  for (let i = 0; i < children.length; i++) {
    await tx.roll.update({
      where: { id: children[i]!.id },
      data: { unitCostPaise: shares[i]! },
    });
  }

  const data = {
    inputCostPaise: inputCost,
    conversionCostPaise: conversionCost,
    totalCostPaise: total,
    outputKg: outputKg.toString(),
    costPerKgPaise: costPerUnit(total, outputKg),
    computedAt: new Date(),
  };
  const cost = await tx.convertingOrderCost.upsert({
    where: { orderId: order.id },
    create: { companyId: actor.companyId, orderId: order.id, ...data },
    update: data,
  });
  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "ConvertingOrder",
    entityId: order.id,
    action: "COST",
    actorUserId: actor.userId,
    after: { totalCostPaise: total.toString(), inputCostPaise: inputCost.toString() },
  });
  return cost;
}

// --- margin --------------------------------------------------------------------------

export interface MarginRow {
  customerId: string;
  customerName: string;
  salePaise: bigint;
  costPaise: bigint;
  marginPaise: bigint;
}
export interface MarginReport {
  rows: MarginRow[];
  totals: { salePaise: bigint; costPaise: bigint; marginPaise: bigint };
}

/** Margin by customer over issued invoices in a date range: net sale (taxable value) minus the
 *  snapshot cost of the dispatched rolls. Rolls not yet costed contribute zero cost. */
export async function marginReport(
  db: Tx,
  companyId: string,
  range?: { from?: Date; to?: Date },
): Promise<MarginReport> {
  const invoices = await db.invoice.findMany({
    where: {
      companyId,
      status: "ISSUED",
      ...(range?.from || range?.to
        ? {
            invoiceDate: {
              ...(range.from ? { gte: range.from } : {}),
              ...(range.to ? { lte: range.to } : {}),
            },
          }
        : {}),
    },
    include: {
      customer: true,
      dispatchNote: { include: { rolls: { include: { roll: true } } } },
    },
  });

  const byCustomer = new Map<string, MarginRow>();
  for (const inv of invoices) {
    const sale = inv.taxableValuePaise;
    const cost = inv.dispatchNote.rolls.reduce(
      (s, dr) => s + (dr.roll.unitCostPaise ?? 0n),
      0n,
    );
    const row =
      byCustomer.get(inv.customerId) ??
      ({
        customerId: inv.customerId,
        customerName: inv.customer.name,
        salePaise: 0n,
        costPaise: 0n,
        marginPaise: 0n,
      } satisfies MarginRow);
    row.salePaise += sale;
    row.costPaise += cost;
    row.marginPaise = row.salePaise - row.costPaise;
    byCustomer.set(inv.customerId, row);
  }

  const rows = [...byCustomer.values()].sort((a, b) =>
    a.customerName.localeCompare(b.customerName),
  );
  const totals = rows.reduce(
    (t, r) => ({
      salePaise: t.salePaise + r.salePaise,
      costPaise: t.costPaise + r.costPaise,
      marginPaise: t.marginPaise + r.marginPaise,
    }),
    { salePaise: 0n, costPaise: 0n, marginPaise: 0n },
  );
  return { rows, totals };
}
