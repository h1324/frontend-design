// lib/kpi.ts — KPI calculators & dashboard aggregations (spec S22).
// A pure read model over the data the earlier modules capture: OEE (availability × performance
// × quality), yield, density/weight variance, sales, and receivables health. Pure calculators
// are unit-testable without a DB; thin async gatherers feed them from Prisma aggregates. Money
// in paise (BigInt), quantities Decimal — no float in the maths that must reconcile (CLAUDE.md).
// Read-only — nothing here mutates.

import type { Prisma } from "@prisma/client";
import { Decimal, type DecimalInput } from "./decimal.js";
import { computeYieldPct } from "./production.js";
import { customerAgeing, type AgeingTotals } from "./receivables.js";

type Tx = Prisma.TransactionClient;

// --- pure calculators ----------------------------------------------------------------

/** A fraction 0..1 (or null when a driver is unknown). */
export type Frac = number | null;

function frac(n: Decimal, d: Decimal): Frac {
  if (d.lte(0)) return null;
  const v = Number(n.div(d).toDecimalPlaces(6).toString());
  return Math.max(0, Math.min(1, v));
}

/** Availability = operating time / planned time, where operating = planned − downtime. Pure. */
export function availability(plannedMin: DecimalInput, downtimeMin: DecimalInput): Frac {
  const planned = new Decimal(plannedMin);
  const operating = planned.minus(new Decimal(downtimeMin));
  return frac(operating, planned);
}

/** Performance = actual output / (rated capacity × operating hours). Null when rated capacity is
 *  unknown or no operating time. Pure. */
export function performance(
  actualKg: DecimalInput,
  ratedKgHr: DecimalInput | null,
  operatingHours: DecimalInput,
): Frac {
  if (ratedKgHr == null) return null;
  const capacity = new Decimal(ratedKgHr).times(new Decimal(operatingHours));
  return frac(new Decimal(actualKg), capacity);
}

/** Quality = good output / total output (defect-free share). Pure. */
export function quality(goodKg: DecimalInput, totalKg: DecimalInput): Frac {
  return frac(new Decimal(goodKg), new Decimal(totalKg));
}

/** OEE = availability × performance × quality. Null if any factor is unknown. Pure. */
export function oee(a: Frac, p: Frac, q: Frac): Frac {
  if (a == null || p == null || q == null) return null;
  return a * p * q;
}

export interface OeeInputs {
  plannedMin: DecimalInput;
  downtimeMin: DecimalInput;
  actualKg: DecimalInput;
  ratedKgHr: DecimalInput | null;
  goodKg: DecimalInput;
  totalKg: DecimalInput;
}
export interface OeeResult {
  availability: Frac;
  performance: Frac;
  quality: Frac;
  oee: Frac;
}

/** The three OEE factors and their product from raw lot drivers. Pure. */
export function oeeFactors(i: OeeInputs): OeeResult {
  const plannedMin = new Decimal(i.plannedMin);
  const operatingHours = plannedMin.minus(new Decimal(i.downtimeMin)).div(60);
  const a = availability(i.plannedMin, i.downtimeMin);
  const p = performance(i.actualKg, i.ratedKgHr, operatingHours.toString());
  const q = quality(i.goodKg, i.totalKg);
  return { availability: a, performance: p, quality: q, oee: oee(a, p, q) };
}

export { computeYieldPct as yieldPct };

export interface VarianceStats {
  count: number;
  meanPct: number;
  minPct: number;
  maxPct: number;
}

/** Weight/density variance stats across rolls: each roll's (actual − theoretical)/theoretical %,
 *  summarised. The spread is the KPI — never reconciled away (CLAUDE.md rule 4). Pure. */
export function weightVarianceStats(
  rolls: { theoreticalKg: DecimalInput; actualKg: DecimalInput }[],
): VarianceStats {
  const pcts: number[] = [];
  for (const r of rolls) {
    const theo = new Decimal(r.theoreticalKg);
    if (theo.lte(0)) continue;
    const pct = new Decimal(r.actualKg).minus(theo).div(theo).times(100);
    pcts.push(Number(pct.toDecimalPlaces(3).toString()));
  }
  if (pcts.length === 0) return { count: 0, meanPct: 0, minPct: 0, maxPct: 0 };
  const sum = pcts.reduce((a, b) => a + b, 0);
  return {
    count: pcts.length,
    meanPct: Number((sum / pcts.length).toFixed(3)),
    minPct: Math.min(...pcts),
    maxPct: Math.max(...pcts),
  };
}

/** Render rows to CSV (RFC-4180 quoting). Pure — the only export path (spec S22). */
export function toCsv(headers: string[], rows: (string | number)[][]): string {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers, ...rows].map((r) => r.map(esc).join(",")).join("\n");
}

// --- gatherers -----------------------------------------------------------------------

function dateFilter(range?: { from?: Date; to?: Date }) {
  if (!range?.from && !range?.to) return {};
  return {
    ...(range.from ? { gte: range.from } : {}),
    ...(range.to ? { lte: range.to } : {}),
  };
}

export interface OeeLotRow {
  lotId: string;
  lotNo: string;
  machineCode: string;
  outputKg: Decimal;
  downtimeMin: number;
  factors: OeeResult;
}

/** Per-lot OEE for the production dashboard (closed lots with a run window). */
export async function oeeByLot(
  db: Tx,
  companyId: string,
  range?: { from?: Date; to?: Date },
): Promise<OeeLotRow[]> {
  const lots = await db.lot.findMany({
    where: { companyId, status: "CLOSED", productionDate: dateFilter(range) },
    include: { machine: true, downtimeLogs: true, rolls: true },
    orderBy: { productionDate: "desc" },
    take: 200,
  });
  return lots.map((lot) => {
    const downtimeMin = lot.downtimeLogs.reduce((s, d) => s + d.minutes, 0);
    const plannedMin =
      lot.startAt && lot.endAt
        ? new Decimal(lot.endAt.getTime() - lot.startAt.getTime()).div(60_000)
        : new Decimal(0);
    const live = lot.rolls.filter((r) => r.state !== "CANCELLED");
    const totalKg = live.reduce(
      (s, r) => s.plus(r.qtyKgActual.toString()),
      new Decimal(0),
    );
    const goodKg = live
      .filter((r) => r.state !== "REJECTED")
      .reduce((s, r) => s.plus(r.qtyKgActual.toString()), new Decimal(0));
    const factors = oeeFactors({
      plannedMin: plannedMin.toString(),
      downtimeMin: String(downtimeMin),
      actualKg: totalKg.toString(),
      ratedKgHr: lot.machine.ratedCapacityKgHr
        ? lot.machine.ratedCapacityKgHr.toString()
        : null,
      goodKg: goodKg.toString(),
      totalKg: totalKg.toString(),
    });
    return {
      lotId: lot.id,
      lotNo: lot.lotNo,
      machineCode: lot.machine.code,
      outputKg: new Decimal(lot.outputKg.toString()),
      downtimeMin,
      factors,
    };
  });
}

export interface ProductionSummary {
  lots: number;
  outputKg: Decimal;
  avgYieldPct: Decimal;
  downtimeMin: number;
  rejectedRolls: number;
  variance: VarianceStats;
}

/** Headline production KPIs over a date range. */
export async function productionSummary(
  db: Tx,
  companyId: string,
  range?: { from?: Date; to?: Date },
): Promise<ProductionSummary> {
  const lots = await db.lot.findMany({
    where: { companyId, status: "CLOSED", productionDate: dateFilter(range) },
    include: {
      downtimeLogs: true,
      rolls: true,
      materialIssues: { include: { lines: true } },
    },
  });
  let outputKg = new Decimal(0);
  let downtimeMin = 0;
  let rejectedRolls = 0;
  const yields: Decimal[] = [];
  const rollRows: { theoreticalKg: string; actualKg: string }[] = [];
  for (const lot of lots) {
    outputKg = outputKg.plus(lot.outputKg.toString());
    downtimeMin += lot.downtimeLogs.reduce((s, d) => s + d.minutes, 0);
    rejectedRolls += lot.rolls.filter((r) => r.state === "REJECTED").length;
    const inputKg = lot.materialIssues
      .filter((i) => i.status === "POSTED")
      .flatMap((i) => i.lines)
      .reduce((s, l) => s.plus(l.qtyBase.toString()), new Decimal(0));
    yields.push(computeYieldPct(inputKg, new Decimal(lot.outputKg.toString())));
    for (const r of lot.rolls) {
      if (r.state === "CANCELLED") continue;
      rollRows.push({
        theoreticalKg: r.qtyKgTheoretical.toString(),
        actualKg: r.qtyKgActual.toString(),
      });
    }
  }
  const avgYieldPct =
    yields.length === 0
      ? new Decimal(0)
      : yields.reduce((a, b) => a.plus(b), new Decimal(0)).div(yields.length);
  return {
    lots: lots.length,
    outputKg,
    avgYieldPct,
    downtimeMin,
    rejectedRolls,
    variance: weightVarianceStats(rollRows),
  };
}

export interface NameValue {
  id: string;
  name: string;
  qtyKg: Decimal;
  qtyM2: Decimal;
  netSalePaise: bigint;
}
export interface SalesSummary {
  invoices: number;
  dispatchedKg: Decimal;
  dispatchedM2: Decimal;
  netSalePaise: bigint;
  byCustomer: NameValue[];
  bySku: NameValue[];
}

/** Sales/dispatch KPIs from issued invoices — totals and top customers/SKUs. */
export async function salesSummary(
  db: Tx,
  companyId: string,
  range?: { from?: Date; to?: Date },
): Promise<SalesSummary> {
  const invoices = await db.invoice.findMany({
    where: { companyId, status: "ISSUED", invoiceDate: dateFilter(range) },
    include: { customer: true, lines: { include: { item: true } } },
  });
  let dispatchedKg = new Decimal(0);
  let dispatchedM2 = new Decimal(0);
  let netSalePaise = 0n;
  const byCustomer = new Map<string, NameValue>();
  const bySku = new Map<string, NameValue>();
  const bump = (
    m: Map<string, NameValue>,
    id: string,
    name: string,
    kg: Decimal,
    m2: Decimal,
    paise: bigint,
  ) => {
    const row = m.get(id) ?? {
      id,
      name,
      qtyKg: new Decimal(0),
      qtyM2: new Decimal(0),
      netSalePaise: 0n,
    };
    row.qtyKg = row.qtyKg.plus(kg);
    row.qtyM2 = row.qtyM2.plus(m2);
    row.netSalePaise += paise;
    m.set(id, row);
  };
  for (const inv of invoices) {
    netSalePaise += inv.taxableValuePaise;
    let invKg = new Decimal(0);
    let invM2 = new Decimal(0);
    for (const l of inv.lines) {
      const kg = new Decimal(l.qtyKg.toString());
      const m2 = new Decimal(l.qtyM2.toString());
      invKg = invKg.plus(kg);
      invM2 = invM2.plus(m2);
      bump(bySku, l.itemId, l.item.code, kg, m2, l.taxableValuePaise);
    }
    dispatchedKg = dispatchedKg.plus(invKg);
    dispatchedM2 = dispatchedM2.plus(invM2);
    bump(
      byCustomer,
      inv.customerId,
      inv.customer.name,
      invKg,
      invM2,
      inv.taxableValuePaise,
    );
  }
  const top = (m: Map<string, NameValue>) =>
    [...m.values()]
      .sort((a, b) => (b.netSalePaise > a.netSalePaise ? 1 : -1))
      .slice(0, 10);
  return {
    invoices: invoices.length,
    dispatchedKg,
    dispatchedM2,
    netSalePaise,
    byCustomer: top(byCustomer),
    bySku: top(bySku),
  };
}

export interface ReceivablesSummary {
  buckets: AgeingTotals;
  outstandingPaise: bigint;
  tierMix: Record<string, number>;
}

/** Receivables health for the dashboard: ageing buckets summed across customers + tier mix. */
export async function receivablesSummary(
  db: Tx,
  companyId: string,
  asOf: Date = new Date(),
): Promise<ReceivablesSummary> {
  const customers = await db.customer.findMany({ where: { companyId, isActive: true } });
  const buckets: AgeingTotals = {
    current: 0n,
    d0_30: 0n,
    d31_60: 0n,
    d61_90: 0n,
    d90plus: 0n,
    total: 0n,
  };
  let outstandingPaise = 0n;
  const tierMix: Record<string, number> = { A: 0, B: 0, C: 0, UNGRADED: 0 };
  for (const c of customers) {
    tierMix[c.tier] = (tierMix[c.tier] ?? 0) + 1;
    const ageing = await customerAgeing(db, companyId, c.id, asOf);
    buckets.current += ageing.buckets.current;
    buckets.d0_30 += ageing.buckets.d0_30;
    buckets.d31_60 += ageing.buckets.d31_60;
    buckets.d61_90 += ageing.buckets.d61_90;
    buckets.d90plus += ageing.buckets.d90plus;
    buckets.total += ageing.buckets.total;
    outstandingPaise += ageing.outstandingPaise;
  }
  return { buckets, outstandingPaise, tierMix };
}

export interface QualitySummary {
  inspections: number;
  passed: number;
  failed: number;
  partial: number;
  qtyFailed: Decimal;
  rejectedRolls: number;
}

/** Quality KPIs: QC dispositions and rejected-roll count over a range. */
export async function qualitySummary(
  db: Tx,
  companyId: string,
  range?: { from?: Date; to?: Date },
): Promise<QualitySummary> {
  const inspections = await db.qcInspection.findMany({
    where: { companyId, inspectedAt: dateFilter(range) },
  });
  let passed = 0;
  let failed = 0;
  let partial = 0;
  let qtyFailed = new Decimal(0);
  for (const q of inspections) {
    if (q.result === "PASS") passed++;
    else if (q.result === "FAIL") failed++;
    else partial++;
    qtyFailed = qtyFailed.plus(q.qtyFailed.toString());
  }
  const rejectedRolls = await db.roll.count({ where: { companyId, state: "REJECTED" } });
  return {
    inspections: inspections.length,
    passed,
    failed,
    partial,
    qtyFailed,
    rejectedRolls,
  };
}
