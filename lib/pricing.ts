// lib/pricing.ts — quotations & price contracts (spec S25).
// The pre-order layer: capture an enquiry, price it from an agreed contract, and convert a won
// quote into an S18 sales order. Two orthogonal pricing axes — a per-line rate (customer > tier
// > item list price, quantity-slab-banded) and a whole-order value discount (customer > tier).
// A quotation never touches stock, credit, or receivables (those begin at the SO it converts
// into). Money in paise (BigInt), quantities/percentages Decimal — no float (CLAUDE.md rule 2).
// Numbers gapless per FY (S2); contracts are cancel-not-supersede; every change is audited.

import type { CustomerTier, Prisma, Quotation, SalesOrder } from "@prisma/client";
import { Decimal, type DecimalInput } from "./decimal.js";
import { requireAccess, requireRole, AuthzError, type Actor } from "./rbac.js";
import { nextDocNumber } from "./doc-number.js";
import { writeAudit } from "./audit.js";
import { costPerUnit } from "./costing.js";
import { createSO } from "./sales-order.js";

type Tx = Prisma.TransactionClient;

/** Company-wide advisory margin floor (% of sale). Quoting below it warns and needs a logged
 *  override (spec S25 rule 4). Advisory only — never a hard block. A single constant for now;
 *  a per-company setting can replace it without touching the resolver. */
export const DEFAULT_MARGIN_FLOOR_PCT = "10";

export class QuotationError extends Error {
  override name = "QuotationError";
  readonly errors: string[];
  constructor(errors: string[]) {
    super(errors.join("; "));
    this.errors = errors;
  }
}

// --- pure: price resolution ----------------------------------------------------------

/** Where a resolved rate came from, most specific first. LIST is the item's default price. */
export type PriceSource = "CUSTOMER" | "TIER" | "LIST";

const SOURCE_RANK: Record<PriceSource, number> = { CUSTOMER: 0, TIER: 1, LIST: 2 };

export interface RateCandidate {
  source: PriceSource;
  /** Slab floor — this rate applies from this quantity upward. */
  minQty: DecimalInput;
  ratePaise: bigint;
  gstRatePct: DecimalInput;
}
export interface ResolvedRate {
  source: PriceSource;
  ratePaise: bigint;
  gstRatePct: string;
}

/**
 * Choose the applicable rate for a quantity: the most specific *source* that has any qualifying
 * slab (CUSTOMER > TIER > LIST), and within that source the highest `minQty` band the quantity
 * clears. Returns null when nothing qualifies (caller then requires a manual rate). Pure and
 * deterministic — the whole precedence story lives here.
 */
export function selectRate(
  candidates: RateCandidate[],
  qty: DecimalInput,
): ResolvedRate | null {
  const q = new Decimal(qty);
  const eligible = candidates.filter((c) => new Decimal(c.minQty).lte(q));
  if (eligible.length === 0) return null;
  const bestRank = Math.min(...eligible.map((c) => SOURCE_RANK[c.source]));
  const inSource = eligible.filter((c) => SOURCE_RANK[c.source] === bestRank);
  let chosen = inSource[0]!;
  for (const c of inSource) {
    if (new Decimal(c.minQty).gt(chosen.minQty)) chosen = c;
  }
  return {
    source: chosen.source,
    ratePaise: chosen.ratePaise,
    gstRatePct: new Decimal(chosen.gstRatePct).toString(),
  };
}

// --- pure: order-value discount ------------------------------------------------------

export type DiscountSource = "CUSTOMER" | "TIER";
const DISCOUNT_RANK: Record<DiscountSource, number> = { CUSTOMER: 0, TIER: 1 };

export interface DiscountCandidate {
  source: DiscountSource;
  minOrderValuePaise: bigint;
  discountPct: DecimalInput;
}
export interface ResolvedDiscount {
  source: DiscountSource;
  discountPct: string;
}

/** Choose the whole-order discount for a pre-tax subtotal: the most specific source with a
 *  qualifying threshold (CUSTOMER > TIER), and within it the highest `minOrderValuePaise`
 *  cleared. Null when none applies (→ 0%). Pure. */
export function selectValueDiscount(
  candidates: DiscountCandidate[],
  orderValuePaise: bigint | number,
): ResolvedDiscount | null {
  const v = new Decimal(orderValuePaise.toString());
  const eligible = candidates.filter((c) =>
    new Decimal(c.minOrderValuePaise.toString()).lte(v),
  );
  if (eligible.length === 0) return null;
  const bestRank = Math.min(...eligible.map((c) => DISCOUNT_RANK[c.source]));
  const inSource = eligible.filter((c) => DISCOUNT_RANK[c.source] === bestRank);
  let chosen = inSource[0]!;
  for (const c of inSource) {
    if (c.minOrderValuePaise > chosen.minOrderValuePaise) chosen = c;
  }
  return {
    source: chosen.source,
    discountPct: new Decimal(chosen.discountPct).toString(),
  };
}

// --- pure: margin & discount arithmetic ----------------------------------------------

export interface Margin {
  marginPaise: bigint;
  /** Margin as a % of the sale rate, 2 dp — null when the rate is 0 (undefined). */
  marginPct: string | null;
}

/** Margin of a sale rate over its cost (both paise). Percentage is of the sale rate. Pure. */
export function quoteMargin(
  ratePaise: bigint | number,
  unitCostPaise: bigint | number,
): Margin {
  const rate = BigInt(ratePaise);
  const cost = BigInt(unitCostPaise);
  const marginPaise = rate - cost;
  if (rate <= 0n) return { marginPaise, marginPct: null };
  const pct = new Decimal(marginPaise.toString()).div(rate.toString()).times(100);
  return {
    marginPaise,
    marginPct: pct.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString(),
  };
}

/** A rate after a whole-order discount %, rounded to the nearest paisa. Used to measure margin
 *  "after the order-value discount" (spec S25 rule 4). Pure. */
export function discountedRatePaise(
  ratePaise: bigint | number,
  discountPct: DecimalInput,
): bigint {
  const factor = new Decimal(1).minus(new Decimal(discountPct).div(100));
  return BigInt(
    new Decimal(ratePaise.toString())
      .times(factor)
      .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
      .toFixed(0),
  );
}

/** Is a line below the margin floor, measured on its discounted rate? Only meaningful when the
 *  cost is known (> 0); an unknown (0) cost never trips the floor. Pure. */
export function isBelowMarginFloor(
  ratePaise: bigint | number,
  unitCostPaise: bigint | number,
  orderDiscountPct: DecimalInput,
  floorPct: DecimalInput = DEFAULT_MARGIN_FLOOR_PCT,
): boolean {
  if (BigInt(unitCostPaise) <= 0n) return false;
  const net = discountedRatePaise(ratePaise, orderDiscountPct);
  const { marginPct } = quoteMargin(net, unitCostPaise);
  if (marginPct === null) return true; // net rate ≤ 0 with a real cost is below any floor
  return new Decimal(marginPct).lt(floorPct);
}

// --- resolver services (DB-backed thin wrappers over the pure core) -------------------

async function customerTier(
  db: Tx,
  companyId: string,
  customerId: string,
): Promise<CustomerTier> {
  const c = await db.customer.findFirst({ where: { id: customerId, companyId } });
  if (!c) throw new AuthzError("customer not found");
  return c.tier;
}

const activeWindow = (date: Date) => ({
  status: "ACTIVE" as const,
  validFrom: { lte: date },
  OR: [{ validUntil: null }, { validUntil: { gte: date } }],
});

export interface ResolvePriceArgs {
  customerId: string;
  itemId: string;
  qty: DecimalInput;
  date?: Date;
}

/** Resolve the per-line rate for a customer+item+qty as of a date (spec S25 rule 2): active
 *  customer contract → tier contract → item list price → null. Reads contracts; the choice is
 *  the pure `selectRate`. */
export async function resolvePrice(
  db: Tx,
  companyId: string,
  args: ResolvePriceArgs,
): Promise<ResolvedRate | null> {
  const date = args.date ?? new Date();
  const tier = await customerTier(db, companyId, args.customerId);
  const contracts = await db.priceContract.findMany({
    where: {
      companyId,
      ...activeWindow(date),
      OR: [
        { scope: "CUSTOMER", customerId: args.customerId },
        { scope: "TIER", tier },
      ],
    },
    include: { lines: { where: { itemId: args.itemId } } },
  });

  const candidates: RateCandidate[] = [];
  for (const c of contracts) {
    for (const l of c.lines) {
      candidates.push({
        source: c.scope === "CUSTOMER" ? "CUSTOMER" : "TIER",
        minQty: l.minQty.toString(),
        ratePaise: l.ratePaise,
        gstRatePct: l.gstRatePct.toString(),
      });
    }
  }
  const item = await db.item.findFirst({ where: { id: args.itemId, companyId } });
  if (item?.listPricePaise != null) {
    candidates.push({
      source: "LIST",
      minQty: "0",
      ratePaise: item.listPricePaise,
      gstRatePct: (item.gstRatePct ?? new Decimal(0)).toString(),
    });
  }
  return selectRate(candidates, args.qty);
}

export interface ResolveOrderDiscountArgs {
  customerId: string;
  orderValuePaise: bigint | number;
  date?: Date;
}

/** Resolve the whole-order value discount for a pre-tax subtotal (spec S25 rule 3): active
 *  customer tier → price-tier tier → 0%. Reads tiers; the choice is the pure `selectValueDiscount`. */
export async function resolveOrderDiscount(
  db: Tx,
  companyId: string,
  args: ResolveOrderDiscountArgs,
): Promise<ResolvedDiscount | null> {
  const date = args.date ?? new Date();
  const tier = await customerTier(db, companyId, args.customerId);
  const tiers = await db.valueDiscountTier.findMany({
    where: {
      companyId,
      ...activeWindow(date),
      OR: [
        { scope: "CUSTOMER", customerId: args.customerId },
        { scope: "TIER", tier },
      ],
    },
  });
  const candidates: DiscountCandidate[] = tiers.map((t) => ({
    source: t.scope === "CUSTOMER" ? "CUSTOMER" : "TIER",
    minOrderValuePaise: t.minOrderValuePaise,
    discountPct: t.discountPct.toString(),
  }));
  return selectValueDiscount(candidates, BigInt(args.orderValuePaise));
}

/** Best-available cost per billed unit for an item (paise), for the quote margin snapshot:
 *  the item's moving-average landed cost (S20) when known, else the average unit cost of its
 *  recently-costed rolls (S21), else 0 (cost unknown → margin shown as 100%). */
async function itemUnitCostPaise(
  db: Tx,
  companyId: string,
  itemId: string,
): Promise<bigint> {
  const item = await db.item.findFirst({ where: { id: itemId, companyId } });
  if (!item) return 0n;
  if (item.movingAvgCostPaise > 0n) return item.movingAvgCostPaise;
  const rolls = await db.roll.findMany({
    where: { companyId, itemId, unitCostPaise: { gt: 0n } },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  if (rolls.length === 0) return 0n;
  let totalCost = 0n;
  let totalQty = new Decimal(0);
  for (const r of rolls) {
    totalCost += r.unitCostPaise ?? 0n;
    const billed = item.uomBase === "KG" ? r.qtyKgActual : r.qtyM2;
    totalQty = totalQty.plus(billed.toString());
  }
  return costPerUnit(totalCost, totalQty);
}

// --- quotation lifecycle -------------------------------------------------------------

export interface QuotationLineInput {
  itemId: string;
  qtyQuoted: DecimalInput;
  uom: string;
  /** Agreed rate per billed unit (paise). Omit to auto-resolve from the price contracts. */
  ratePaise?: bigint | number;
  /** GST rate %. Omit to take the resolved/item rate. */
  gstRatePct?: DecimalInput;
}
export interface CreateQuotationInput {
  customerId: string;
  shipToId?: string | null;
  lines: QuotationLineInput[];
  enquiryDate?: Date;
  /** Quote validity; defaults to 15 days from the enquiry date (spec S25 open-question default). */
  validUntil?: Date;
}

const DEFAULT_VALIDITY_DAYS = 15;

/** Create a DRAFT quotation. For each line the rate resolves from the price contracts when not
 *  given (falling back to a required manual rate), the cost is snapshotted for the margin badge,
 *  and the whole-order discount is resolved on the pre-tax subtotal. SALES-write. Gapless QT/FY. */
export async function createQuotation(
  tx: Tx,
  actor: Actor,
  input: CreateQuotationInput,
): Promise<Quotation> {
  requireAccess(actor, "SALES", "write");
  const errors: string[] = [];
  if (!input.customerId) errors.push("customer is required");
  if (!input.lines?.length) errors.push("at least one line is required");
  input.lines?.forEach((l, i) => {
    if (!l.itemId) errors.push(`line ${i + 1}: item is required`);
    if (!new Decimal(l.qtyQuoted).gt(0)) errors.push(`line ${i + 1}: qty must be > 0`);
  });
  if (errors.length) throw new QuotationError(errors);

  const enquiryDate = input.enquiryDate ?? new Date();
  if (input.shipToId) {
    const shipTo = await tx.shipToAddress.findFirst({
      where: {
        id: input.shipToId,
        customer: { id: input.customerId, companyId: actor.companyId },
      },
    });
    if (!shipTo) throw new QuotationError(["ship-to does not belong to the customer"]);
  }

  // Resolve each line's rate, GST and cost snapshot.
  const resolved: {
    itemId: string;
    qtyQuoted: string;
    uom: string;
    ratePaise: bigint;
    gstRatePct: string;
    unitCostPaise: bigint;
  }[] = [];
  for (const [i, l] of input.lines.entries()) {
    let ratePaise: bigint;
    let gstRatePct: string;
    if (l.ratePaise != null) {
      ratePaise = BigInt(l.ratePaise);
      gstRatePct = new Decimal(l.gstRatePct ?? 0).toString();
    } else {
      const hit = await resolvePrice(tx, actor.companyId, {
        customerId: input.customerId,
        itemId: l.itemId,
        qty: l.qtyQuoted,
        date: enquiryDate,
      });
      if (!hit) {
        throw new QuotationError([
          `line ${i + 1}: no price contract or list price applies — a manual rate is required`,
        ]);
      }
      ratePaise = hit.ratePaise;
      gstRatePct =
        l.gstRatePct != null ? new Decimal(l.gstRatePct).toString() : hit.gstRatePct;
    }
    if (ratePaise <= 0n) throw new QuotationError([`line ${i + 1}: rate must be > 0`]);
    const unitCostPaise = await itemUnitCostPaise(tx, actor.companyId, l.itemId);
    resolved.push({
      itemId: l.itemId,
      qtyQuoted: new Decimal(l.qtyQuoted).toString(),
      uom: l.uom,
      ratePaise,
      gstRatePct,
      unitCostPaise,
    });
  }

  // Whole-order discount on the pre-tax subtotal.
  const subtotalPaise = resolved.reduce(
    (s, l) =>
      s +
      BigInt(
        new Decimal(l.qtyQuoted)
          .times(l.ratePaise.toString())
          .toDecimalPlaces(0)
          .toFixed(0),
      ),
    0n,
  );
  const discount = await resolveOrderDiscount(tx, actor.companyId, {
    customerId: input.customerId,
    orderValuePaise: subtotalPaise,
    date: enquiryDate,
  });
  const orderDiscountPct = discount ? discount.discountPct : "0";

  const validUntil =
    input.validUntil ??
    new Date(enquiryDate.getTime() + DEFAULT_VALIDITY_DAYS * 24 * 60 * 60 * 1000);
  const docNo = await nextDocNumber(tx, actor.companyId, "QUOTATION", {
    prefix: "QT",
    now: enquiryDate,
  });

  const quotation = await tx.quotation.create({
    data: {
      companyId: actor.companyId,
      docNo,
      customerId: input.customerId,
      shipToId: input.shipToId ?? null,
      enquiryDate,
      validUntil,
      orderDiscountPct,
      createdById: actor.userId,
      lines: {
        create: resolved.map((l) => ({
          itemId: l.itemId,
          qtyQuoted: l.qtyQuoted,
          uom: l.uom,
          ratePaise: l.ratePaise,
          gstRatePct: l.gstRatePct,
          unitCostPaise: l.unitCostPaise,
        })),
      },
    },
  });
  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "Quotation",
    entityId: quotation.id,
    action: "CREATE",
    actorUserId: actor.userId,
    after: {
      docNo,
      customerId: input.customerId,
      lines: resolved.length,
      orderDiscountPct,
    },
  });
  return quotation;
}

async function loadQuotation(tx: Tx, actor: Actor, id: string) {
  const q = await tx.quotation.findFirst({
    where: { id, companyId: actor.companyId },
    include: { lines: true },
  });
  if (!q) throw new AuthzError("quotation not found");
  return q;
}

/** Which lines are below the margin floor, measured after the order-value discount. */
function belowFloorLines(q: Awaited<ReturnType<typeof loadQuotation>>): number {
  return q.lines.filter((l) =>
    isBelowMarginFloor(l.ratePaise, l.unitCostPaise, q.orderDiscountPct.toString()),
  ).length;
}

/** Clear a below-floor margin warning with a logged reason (spec S25 rule 4). ADMIN/ACCOUNTS
 *  only, mirroring the S18 credit override. */
export async function overrideMargin(
  tx: Tx,
  actor: Actor,
  id: string,
  reason: string,
): Promise<Quotation> {
  requireAccess(actor, "SALES", "read");
  requireRole(actor, "ACCOUNTS", "ADMIN");
  if (!reason?.trim()) throw new QuotationError(["an override reason is required"]);
  const q = await loadQuotation(tx, actor, id);
  const updated = await tx.quotation.update({
    where: { id: q.id },
    data: { marginOverrideById: actor.userId, marginOverrideReason: reason.trim() },
  });
  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "Quotation",
    entityId: q.id,
    action: "MARGIN_OVERRIDE",
    actorUserId: actor.userId,
    after: { reason: reason.trim(), belowFloorLines: belowFloorLines(q) },
  });
  return updated;
}

/** Advisory guard: refuse a below-floor commitment unless an override is on file. */
function guardMarginFloor(q: Awaited<ReturnType<typeof loadQuotation>>): void {
  if (belowFloorLines(q) > 0 && !q.marginOverrideById) {
    throw new QuotationError([
      "quote is below the margin floor — an ACCOUNTS/ADMIN override is required first",
    ]);
  }
}

/** Move a DRAFT quotation to SENT (spec S25). A below-floor quote needs a logged override first. */
export async function sendQuotation(
  tx: Tx,
  actor: Actor,
  id: string,
): Promise<Quotation> {
  requireAccess(actor, "SALES", "write");
  const q = await loadQuotation(tx, actor, id);
  if (q.status !== "DRAFT")
    throw new QuotationError([`quotation ${q.docNo} is ${q.status}, not DRAFT`]);
  guardMarginFloor(q);
  const updated = await tx.quotation.update({
    where: { id: q.id },
    data: { status: "SENT" },
  });
  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "Quotation",
    entityId: q.id,
    action: "SEND",
    actorUserId: actor.userId,
    before: { status: "DRAFT" },
    after: { status: "SENT" },
  });
  return updated;
}

/** Mark a quotation WON (spec S25) — the commitment point, so the margin floor is enforced. A
 *  DRAFT or SENT quote may be won directly. */
export async function winQuotation(tx: Tx, actor: Actor, id: string): Promise<Quotation> {
  requireAccess(actor, "SALES", "write");
  const q = await loadQuotation(tx, actor, id);
  if (q.status !== "DRAFT" && q.status !== "SENT") {
    throw new QuotationError([`quotation ${q.docNo} is ${q.status} — cannot be won`]);
  }
  guardMarginFloor(q);
  const updated = await tx.quotation.update({
    where: { id: q.id },
    data: { status: "WON" },
  });
  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "Quotation",
    entityId: q.id,
    action: "WIN",
    actorUserId: actor.userId,
    before: { status: q.status },
    after: { status: "WON" },
  });
  return updated;
}

/** Mark a quotation LOST with a reason (spec S25). */
export async function loseQuotation(
  tx: Tx,
  actor: Actor,
  id: string,
  reason: string,
): Promise<Quotation> {
  requireAccess(actor, "SALES", "write");
  const q = await loadQuotation(tx, actor, id);
  if (q.status === "WON" || q.status === "CANCELLED") {
    throw new QuotationError([
      `quotation ${q.docNo} is ${q.status} — cannot be marked lost`,
    ]);
  }
  const updated = await tx.quotation.update({
    where: { id: q.id },
    data: { status: "LOST", lostReason: reason?.trim() || null },
  });
  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "Quotation",
    entityId: q.id,
    action: "LOSE",
    actorUserId: actor.userId,
    before: { status: q.status },
    after: { status: "LOST", reason: reason?.trim() ?? null },
  });
  return updated;
}

/** Cancel a quotation, keeping the number (S2). Not valid once converted. */
export async function cancelQuotation(
  tx: Tx,
  actor: Actor,
  id: string,
): Promise<Quotation> {
  requireAccess(actor, "SALES", "write");
  const q = await loadQuotation(tx, actor, id);
  if (q.status === "CANCELLED")
    throw new QuotationError(["quotation is already cancelled"]);
  if (q.convertedSoId)
    throw new QuotationError(["a converted quotation cannot be cancelled"]);
  const updated = await tx.quotation.update({
    where: { id: q.id },
    data: { status: "CANCELLED" },
  });
  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "Quotation",
    entityId: q.id,
    action: "CANCEL",
    actorUserId: actor.userId,
    before: { status: q.status },
    after: { status: "CANCELLED", docNo: q.docNo },
  });
  return updated;
}

/**
 * Convert a WON quotation into a DRAFT sales order (spec S25 rule 1). The SO mirrors the quote's
 * lines and carries the resolved order-value discount; the SO then runs its own S18 credit check
 * at confirmation. Create-only: a quote converts to exactly one SO — a second convert is refused.
 * SALES-write.
 */
export async function convertToSalesOrder(
  tx: Tx,
  actor: Actor,
  id: string,
): Promise<SalesOrder> {
  requireAccess(actor, "SALES", "write");
  const q = await loadQuotation(tx, actor, id);
  if (q.status !== "WON") {
    throw new QuotationError([
      `quotation ${q.docNo} is ${q.status} — win it before converting`,
    ]);
  }
  if (q.convertedSoId)
    throw new QuotationError(["quotation is already converted to a sales order"]);
  if (!q.shipToId) {
    throw new QuotationError(["a ship-to address is required to create the sales order"]);
  }
  if (q.lines.length === 0) throw new QuotationError(["quotation has no lines"]);

  const so = await createSO(tx, actor, {
    customerId: q.customerId,
    shipToId: q.shipToId,
    orderDiscountPct: q.orderDiscountPct.toString(),
    lines: q.lines.map((l) => ({
      itemId: l.itemId,
      qtyOrdered: l.qtyQuoted.toString(),
      uom: l.uom,
      ratePaise: Number(l.ratePaise),
      gstRatePct: l.gstRatePct.toString(),
    })),
  });
  await tx.quotation.update({ where: { id: q.id }, data: { convertedSoId: so.id } });
  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "Quotation",
    entityId: q.id,
    action: "CONVERT",
    actorUserId: actor.userId,
    after: {
      salesOrderId: so.id,
      salesOrderNo: so.docNo,
      orderDiscountPct: q.orderDiscountPct.toString(),
    },
  });
  return so;
}

// --- price contracts & value-discount tiers ------------------------------------------

export interface PriceContractLineInput {
  itemId: string;
  minQty?: DecimalInput;
  ratePaise: bigint | number;
  gstRatePct: DecimalInput;
}
export interface UpsertPriceContractInput {
  scope: "CUSTOMER" | "TIER";
  customerId?: string | null;
  tier?: CustomerTier | null;
  validFrom?: Date;
  validUntil?: Date | null;
  lines: PriceContractLineInput[];
}

const windowsOverlap = (
  aFrom: Date,
  aUntil: Date | null,
  bFrom: Date,
  bUntil: Date | null,
): boolean =>
  aFrom <= (bUntil ?? new Date(8640000000000000)) &&
  bFrom <= (aUntil ?? new Date(8640000000000000));

/** Create a customer- or tier-scoped price contract with its slab lines (spec S25). Rejects an
 *  overlapping active contract for the same scope+item+band so resolution stays unambiguous.
 *  SALES-write. Gapless PC/FY. */
export async function upsertPriceContract(
  tx: Tx,
  actor: Actor,
  input: UpsertPriceContractInput,
): Promise<{ id: string; docNo: string }> {
  requireAccess(actor, "SALES", "write");
  const errors: string[] = [];
  if (input.scope === "CUSTOMER" && !input.customerId)
    errors.push("customer is required for a customer contract");
  if (input.scope === "TIER" && !input.tier)
    errors.push("tier is required for a tier contract");
  if (!input.lines?.length) errors.push("at least one line is required");
  input.lines?.forEach((l, i) => {
    if (!l.itemId) errors.push(`line ${i + 1}: item is required`);
    if (!(Number(l.ratePaise) > 0)) errors.push(`line ${i + 1}: rate must be > 0`);
  });
  if (errors.length) throw new QuotationError(errors);

  const validFrom = input.validFrom ?? new Date();
  const validUntil = input.validUntil ?? null;

  // Overlap guard: same scope target + item + minQty band with an overlapping active window.
  const existing = await tx.priceContract.findMany({
    where: {
      companyId: actor.companyId,
      status: "ACTIVE",
      scope: input.scope,
      ...(input.scope === "CUSTOMER"
        ? { customerId: input.customerId }
        : { tier: input.tier }),
    },
    include: { lines: true },
  });
  for (const l of input.lines) {
    const band = new Decimal(l.minQty ?? 0);
    for (const c of existing) {
      if (!windowsOverlap(validFrom, validUntil, c.validFrom, c.validUntil)) continue;
      if (c.lines.some((el) => el.itemId === l.itemId && band.eq(el.minQty.toString()))) {
        throw new QuotationError([
          `an active contract already covers this item at qty band ${band.toString()} in an overlapping window`,
        ]);
      }
    }
  }

  const docNo = await nextDocNumber(tx, actor.companyId, "PRICE_CONTRACT", {
    prefix: "PC",
    now: validFrom,
  });
  const contract = await tx.priceContract.create({
    data: {
      companyId: actor.companyId,
      docNo,
      scope: input.scope,
      customerId: input.scope === "CUSTOMER" ? input.customerId! : null,
      tier: input.scope === "TIER" ? input.tier! : null,
      validFrom,
      validUntil,
      createdById: actor.userId,
      lines: {
        create: input.lines.map((l) => ({
          itemId: l.itemId,
          minQty: new Decimal(l.minQty ?? 0).toString(),
          ratePaise: BigInt(l.ratePaise),
          gstRatePct: new Decimal(l.gstRatePct).toString(),
        })),
      },
    },
  });
  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "PriceContract",
    entityId: contract.id,
    action: "CREATE",
    actorUserId: actor.userId,
    after: { docNo, scope: input.scope, lines: input.lines.length },
  });
  return { id: contract.id, docNo };
}

/** Cancel a price contract, keeping the number (S2). SALES-write. */
export async function cancelPriceContract(
  tx: Tx,
  actor: Actor,
  id: string,
): Promise<void> {
  requireAccess(actor, "SALES", "write");
  const c = await tx.priceContract.findFirst({
    where: { id, companyId: actor.companyId },
  });
  if (!c) throw new AuthzError("price contract not found");
  if (c.status === "CANCELLED")
    throw new QuotationError(["contract is already cancelled"]);
  await tx.priceContract.update({ where: { id: c.id }, data: { status: "CANCELLED" } });
  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "PriceContract",
    entityId: c.id,
    action: "CANCEL",
    actorUserId: actor.userId,
    before: { status: c.status },
    after: { status: "CANCELLED", docNo: c.docNo },
  });
}

export interface UpsertValueDiscountInput {
  scope: "CUSTOMER" | "TIER";
  customerId?: string | null;
  tier?: CustomerTier | null;
  minOrderValuePaise: bigint | number;
  discountPct: DecimalInput;
  validFrom?: Date;
  validUntil?: Date | null;
}

/** Create a whole-order value-discount tier (spec S25 rule 3). Rejects an overlapping active
 *  tier for the same scope target + threshold. SALES-write. */
export async function upsertValueDiscountTier(
  tx: Tx,
  actor: Actor,
  input: UpsertValueDiscountInput,
): Promise<{ id: string }> {
  requireAccess(actor, "SALES", "write");
  const errors: string[] = [];
  if (input.scope === "CUSTOMER" && !input.customerId)
    errors.push("customer is required");
  if (input.scope === "TIER" && !input.tier) errors.push("tier is required");
  if (!(Number(input.minOrderValuePaise) >= 0)) errors.push("threshold must be ≥ 0");
  if (!new Decimal(input.discountPct).gt(0)) errors.push("discount % must be > 0");
  if (new Decimal(input.discountPct).gte(100)) errors.push("discount % must be < 100");
  if (errors.length) throw new QuotationError(errors);

  const validFrom = input.validFrom ?? new Date();
  const validUntil = input.validUntil ?? null;
  const threshold = BigInt(input.minOrderValuePaise);

  const existing = await tx.valueDiscountTier.findMany({
    where: {
      companyId: actor.companyId,
      status: "ACTIVE",
      scope: input.scope,
      minOrderValuePaise: threshold,
      ...(input.scope === "CUSTOMER"
        ? { customerId: input.customerId }
        : { tier: input.tier }),
    },
  });
  for (const e of existing) {
    if (windowsOverlap(validFrom, validUntil, e.validFrom, e.validUntil)) {
      throw new QuotationError([
        `an active value-discount tier already covers this threshold in an overlapping window`,
      ]);
    }
  }

  const created = await tx.valueDiscountTier.create({
    data: {
      companyId: actor.companyId,
      scope: input.scope,
      customerId: input.scope === "CUSTOMER" ? input.customerId! : null,
      tier: input.scope === "TIER" ? input.tier! : null,
      minOrderValuePaise: threshold,
      discountPct: new Decimal(input.discountPct).toString(),
      validFrom,
      validUntil,
      createdById: actor.userId,
    },
  });
  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "ValueDiscountTier",
    entityId: created.id,
    action: "CREATE",
    actorUserId: actor.userId,
    after: {
      scope: input.scope,
      minOrderValuePaise: threshold.toString(),
      discountPct: new Decimal(input.discountPct).toString(),
    },
  });
  return { id: created.id };
}

/** Cancel a value-discount tier. SALES-write. */
export async function cancelValueDiscountTier(
  tx: Tx,
  actor: Actor,
  id: string,
): Promise<void> {
  requireAccess(actor, "SALES", "write");
  const t = await tx.valueDiscountTier.findFirst({
    where: { id, companyId: actor.companyId },
  });
  if (!t) throw new AuthzError("value-discount tier not found");
  if (t.status === "CANCELLED") throw new QuotationError(["tier is already cancelled"]);
  await tx.valueDiscountTier.update({
    where: { id: t.id },
    data: { status: "CANCELLED" },
  });
  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "ValueDiscountTier",
    entityId: t.id,
    action: "CANCEL",
    actorUserId: actor.userId,
    before: { status: t.status },
    after: { status: "CANCELLED" },
  });
}
