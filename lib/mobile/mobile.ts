// lib/mobile/mobile.ts — field-sales mobile order-taking (spec S27).
// The device is a thin capture layer; the server is the authority. A rep builds an order on the
// PWA (priced from the last cached S25 contract) and syncs it; at sync the server RE-prices via
// S25 `resolvePrice` and runs the S18 credit check, so the device can be wrong and the server
// corrects it. Submission is idempotent by `clientRequestId` — a retried sync never creates a
// second order. Money in paise (BigInt), quantities Decimal — no float (CLAUDE.md rule 2).

import type {
  CreditStatus,
  MobileSubmissionStatus,
  Prisma,
  SalesOrderStatus,
} from "@prisma/client";
import { Decimal, type DecimalInput } from "../decimal.js";
import { requireAccess, type Actor } from "../rbac.js";
import { writeAudit } from "../audit.js";
import { resolvePrice, resolveOrderDiscount } from "../pricing.js";
import { createSO, confirmSO, type SalesOrderLineInput } from "../sales-order.js";

type Tx = Prisma.TransactionClient;

export class MobileSyncError extends Error {
  override name = "MobileSyncError";
  readonly errors: string[];
  constructor(errors: string[]) {
    super(errors.join("; "));
    this.errors = errors;
  }
}

// --- pure: price divergence ----------------------------------------------------------

export interface PriceDeltaRow {
  itemId: string;
  devicePricePaise: string;
  serverPricePaise: string;
}

/** Where the device's cached price disagreed with the server's re-resolved price (spec S27 rule
 *  1). A line with no device price contributes nothing (the rep let the server price it). Pure. */
export function computePriceDelta(
  lines: {
    itemId: string;
    devicePricePaise: bigint | number | null;
    serverPricePaise: bigint;
  }[],
): PriceDeltaRow[] {
  const out: PriceDeltaRow[] = [];
  for (const l of lines) {
    if (l.devicePricePaise == null) continue;
    const device = BigInt(l.devicePricePaise);
    if (device !== l.serverPricePaise) {
      out.push({
        itemId: l.itemId,
        devicePricePaise: device.toString(),
        serverPricePaise: l.serverPricePaise.toString(),
      });
    }
  }
  return out;
}

// --- catalogue projection ------------------------------------------------------------

export interface CatalogueLine {
  itemId: string;
  code: string;
  name: string;
  uomBase: string;
  gstRatePct: string;
  /** Resolved contract/list price per billed unit (paise) or null when nothing applies. */
  ratePaise: string | null;
  priceSource: "CUSTOMER" | "TIER" | "LIST" | null;
}
export interface MobileCatalogue {
  customerId: string;
  customerName: string;
  tier: string;
  shipTos: { id: string; label: string; isDefault: boolean }[];
  /** When this projection was priced — the device stamps its cache with it. */
  pricedAsOf: string;
  lines: CatalogueLine[];
}

/**
 * The cacheable, contract-priced catalogue for a customer (spec S27 rule 4). Deliberately carries
 * **no cost or margin** — it is safe to ship to a rep's device. Prices are resolved at a nominal
 * qty of 1 (the device re-shows the band; the server re-prices the real qty at sync). SALES-read.
 */
export async function mobileCatalogueFor(
  db: Tx,
  actor: Actor,
  customerId: string,
  asOf: Date = new Date(),
): Promise<MobileCatalogue> {
  requireAccess(actor, "SALES", "read");
  const customer = await db.customer.findFirst({
    where: { id: customerId, companyId: actor.companyId },
    include: { shipTos: { orderBy: { isDefault: "desc" } } },
  });
  if (!customer) throw new MobileSyncError(["customer not found"]);

  const items = await db.item.findMany({
    where: {
      companyId: actor.companyId,
      isActive: true,
      type: { in: ["FINISHED_GOOD", "WIP_ROLL"] },
    },
    orderBy: { code: "asc" },
  });

  const lines: CatalogueLine[] = [];
  for (const it of items) {
    const hit = await resolvePrice(db, actor.companyId, {
      customerId,
      itemId: it.id,
      qty: "1",
      date: asOf,
    });
    lines.push({
      itemId: it.id,
      code: it.code,
      name: it.name,
      uomBase: it.uomBase,
      gstRatePct: hit ? hit.gstRatePct : (it.gstRatePct?.toString() ?? "0"),
      ratePaise: hit ? hit.ratePaise.toString() : null,
      priceSource: hit ? hit.source : null,
    });
  }

  return {
    customerId: customer.id,
    customerName: customer.name,
    tier: customer.tier,
    shipTos: customer.shipTos.map((s) => ({
      id: s.id,
      label: s.label,
      isDefault: s.isDefault,
    })),
    pricedAsOf: asOf.toISOString(),
    lines,
  };
}

// --- idempotent apply ----------------------------------------------------------------

export interface MobileOrderLineInput {
  itemId: string;
  qtyOrdered: DecimalInput;
  uom: string;
  /** What the device priced this line at (paise), if any — used only to flag a divergence. */
  devicePricePaise?: bigint | number | null;
}
export interface SubmitMobileOrderInput {
  /** Device-generated idempotency key — travels with every retry. */
  clientRequestId: string;
  customerId: string;
  shipToId: string;
  lines: MobileOrderLineInput[];
  /** When the rep captured it on the device (may predate the sync). */
  capturedAt?: Date;
}
export interface MobileSubmitResult {
  submissionId: string;
  clientRequestId: string;
  status: MobileSubmissionStatus;
  soId: string | null;
  soStatus: SalesOrderStatus | null;
  creditStatus: CreditStatus | null;
  /** Lines where the server price differed from the device's — the SO uses the server price. */
  priceDelta: PriceDeltaRow[];
}

type SubmissionWithSo = Prisma.OrderDraftSubmissionGetPayload<{
  include: { resultSo: true };
}>;

function resultFromSubmission(s: SubmissionWithSo): MobileSubmitResult {
  return {
    submissionId: s.id,
    clientRequestId: s.clientRequestId,
    status: s.status,
    soId: s.resultSoId,
    soStatus: s.resultSo?.status ?? null,
    creditStatus: s.resultSo?.creditStatus ?? null,
    priceDelta: (s.priceDeltaJson as unknown as PriceDeltaRow[] | null) ?? [],
  };
}

/**
 * Apply a mobile order submission (spec S27). Idempotent by `clientRequestId`: a repeat returns
 * the same result and never creates a second SO. On first sight it re-prices every line via S25
 * `resolvePrice` (the server, not the device, is authoritative), resolves the whole-order discount,
 * creates a `source=MOBILE` sales order and runs the S18 credit check — CONFIRMED within the limit,
 * left DRAFT+BLOCKED (for a logged override) when over. Records the submission and a `priceDelta`
 * of any divergence. SALES-write.
 */
export async function applyMobileSubmission(
  tx: Tx,
  actor: Actor,
  input: SubmitMobileOrderInput,
): Promise<MobileSubmitResult> {
  requireAccess(actor, "SALES", "write");

  // Idempotency: a submission with this key already exists → return its stored outcome.
  const existing = await tx.orderDraftSubmission.findUnique({
    where: {
      companyId_clientRequestId: {
        companyId: actor.companyId,
        clientRequestId: input.clientRequestId,
      },
    },
    include: { resultSo: true },
  });
  if (existing) return resultFromSubmission(existing);

  const errors: string[] = [];
  if (!input.clientRequestId) errors.push("clientRequestId is required");
  if (!input.customerId) errors.push("customer is required");
  if (!input.shipToId) errors.push("ship-to is required");
  if (!input.lines?.length) errors.push("at least one line is required");
  input.lines?.forEach((l, i) => {
    if (!l.itemId) errors.push(`line ${i + 1}: item is required`);
    if (!new Decimal(l.qtyOrdered).gt(0)) errors.push(`line ${i + 1}: qty must be > 0`);
  });
  if (errors.length) throw new MobileSyncError(errors);

  const now = new Date(); // the server prices as of the sync instant — that is the authority
  const items = await tx.item.findMany({
    where: { companyId: actor.companyId, id: { in: input.lines.map((l) => l.itemId) } },
  });
  const gstById = new Map(items.map((i) => [i.id, i.gstRatePct?.toString() ?? "0"]));

  // Re-price every line on the server. The device price is advisory (flagged as a delta).
  const priced: {
    itemId: string;
    qtyOrdered: string;
    uom: string;
    serverRate: bigint;
    gstRatePct: string;
    devicePricePaise: bigint | number | null;
  }[] = [];
  for (const [i, l] of input.lines.entries()) {
    const hit = await resolvePrice(tx, actor.companyId, {
      customerId: input.customerId,
      itemId: l.itemId,
      qty: l.qtyOrdered,
      date: now,
    });
    const serverRate =
      hit?.ratePaise ?? (l.devicePricePaise != null ? BigInt(l.devicePricePaise) : null);
    if (serverRate == null || serverRate <= 0n) {
      throw new MobileSyncError([
        `line ${i + 1}: no price applies to this item and none was supplied`,
      ]);
    }
    priced.push({
      itemId: l.itemId,
      qtyOrdered: new Decimal(l.qtyOrdered).toString(),
      uom: l.uom,
      serverRate,
      gstRatePct: hit ? hit.gstRatePct : (gstById.get(l.itemId) ?? "0"),
      devicePricePaise: l.devicePricePaise ?? null,
    });
  }

  // Whole-order value discount on the server-priced subtotal.
  const subtotalPaise = priced.reduce(
    (s, p) =>
      s +
      BigInt(
        new Decimal(p.qtyOrdered)
          .times(p.serverRate.toString())
          .toDecimalPlaces(0)
          .toFixed(0),
      ),
    0n,
  );
  const discount = await resolveOrderDiscount(tx, actor.companyId, {
    customerId: input.customerId,
    orderValuePaise: subtotalPaise,
    date: now,
  });

  const soLines: SalesOrderLineInput[] = priced.map((p) => ({
    itemId: p.itemId,
    qtyOrdered: p.qtyOrdered,
    uom: p.uom,
    ratePaise: Number(p.serverRate),
    gstRatePct: p.gstRatePct,
  }));
  const so = await createSO(tx, actor, {
    customerId: input.customerId,
    shipToId: input.shipToId,
    source: "MOBILE",
    orderDiscountPct: discount ? discount.discountPct : "0",
    lines: soLines,
  });
  // Credit check: CONFIRMED within the limit, left DRAFT+BLOCKED (for a logged override) over it.
  const confirm = await confirmSO(tx, actor, so.id);

  const priceDelta = computePriceDelta(
    priced.map((p) => ({
      itemId: p.itemId,
      devicePricePaise: p.devicePricePaise,
      serverPricePaise: p.serverRate,
    })),
  );

  const payloadJson: Prisma.InputJsonValue = {
    pricedAsOf: input.capturedAt?.toISOString() ?? null,
    lines: input.lines.map((l) => ({
      itemId: l.itemId,
      qtyOrdered: new Decimal(l.qtyOrdered).toString(),
      uom: l.uom,
      devicePricePaise:
        l.devicePricePaise != null ? BigInt(l.devicePricePaise).toString() : null,
    })),
  };

  const submission = await tx.orderDraftSubmission.create({
    data: {
      companyId: actor.companyId,
      clientRequestId: input.clientRequestId,
      submittedById: actor.userId,
      customerId: input.customerId,
      shipToId: input.shipToId,
      payloadJson,
      status: "APPLIED",
      resultSoId: so.id,
      priceDeltaJson: priceDelta as unknown as Prisma.InputJsonValue,
      capturedAt: input.capturedAt ?? null,
    },
    include: { resultSo: true },
  });
  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "OrderDraftSubmission",
    entityId: submission.id,
    action: "APPLY",
    actorUserId: actor.userId,
    after: {
      clientRequestId: input.clientRequestId,
      salesOrderId: so.id,
      salesOrderNo: so.docNo,
      soStatus: confirm.order.status,
      creditStatus: confirm.creditStatus,
      priceDeltas: priceDelta.length,
    },
  });

  return resultFromSubmission(submission);
}
