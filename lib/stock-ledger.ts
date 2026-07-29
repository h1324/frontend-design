// lib/stock-ledger.ts — the append-only journal of every stock movement.
//
// Two grains (CLAUDE.md / spec S3):
//   • BULK   — fungible raw materials/consumables; a running StockBalance per
//              (item, location). OUT is guarded so the balance can never go negative.
//   • SERIAL — individually barcoded rolls; movements reference a specific rollId, and
//              the roll carries both kg (theoretical + actual) and m² (CLAUDE.md 3 & 4).
//
// The journal is append-only (a DB trigger rejects UPDATE/DELETE). Corrections are
// REVERSAL rows; the reversing row points at the original via reversesLedgerId, because
// the original can never be updated. Every movement writes an audit row (CLAUDE.md 8).

import type {
  Prisma,
  Roll,
  RollState,
  StockDirection,
  StockLedger,
  StockReason,
} from "@prisma/client";
import { Decimal, type DecimalInput } from "./decimal.js";
import { areaM2, compositeDensity, weightKg, type Dimensions } from "./uom.js";
import { writeAudit } from "./audit.js";

type Tx = Prisma.TransactionClient;

/** Thrown when a movement is invalid (insufficient stock, unknown roll, bad quantity). */
export class StockError extends Error {
  override name = "StockError";
}

// --- posting -------------------------------------------------------------------------

interface CommonEntry {
  direction: StockDirection;
  companyId: string;
  reason: StockReason;
  refType?: string;
  refId?: string;
  actorUserId?: string | null;
  at?: Date;
}

export type LedgerEntryInput =
  | (CommonEntry & {
      grain: "BULK";
      itemId: string;
      locationId: string;
      qtyBase: DecimalInput;
    })
  | (CommonEntry & {
      grain: "SERIAL";
      rollId: string;
      /** Optional state to move the roll into as part of this posting (e.g. DISPATCHED). */
      setRollState?: RollState;
    });

/** Append one movement to the ledger, updating derived balances/state in the same tx. */
export async function post(tx: Tx, entry: LedgerEntryInput): Promise<StockLedger> {
  return entry.grain === "BULK" ? postBulk(tx, entry) : postSerial(tx, entry);
}

async function postBulk(
  tx: Tx,
  e: Extract<LedgerEntryInput, { grain: "BULK" }>,
): Promise<StockLedger> {
  const qty = new Decimal(e.qtyBase);
  if (!qty.isFinite() || qty.lte(0)) {
    throw new StockError("qtyBase must be a finite quantity greater than zero");
  }
  const qtyStr = qty.toString();
  const where = {
    companyId_itemId_locationId: {
      companyId: e.companyId,
      itemId: e.itemId,
      locationId: e.locationId,
    },
  } satisfies Prisma.StockBalanceWhereUniqueInput;

  // Make sure the balance row exists so IN/OUT can operate on it.
  await tx.stockBalance.upsert({
    where,
    create: {
      companyId: e.companyId,
      itemId: e.itemId,
      locationId: e.locationId,
      qtyBase: "0",
    },
    update: {},
  });

  if (e.direction === "IN") {
    await tx.stockBalance.update({ where, data: { qtyBase: { increment: qtyStr } } });
  } else {
    // Guarded decrement: the WHERE floor makes this atomic and concurrency-safe — a
    // second OUT blocks on the row lock, then re-checks the balance. Zero rows updated
    // means it would have gone negative (resolved decision: block for bulk RM).
    const res = await tx.stockBalance.updateMany({
      where: {
        companyId: e.companyId,
        itemId: e.itemId,
        locationId: e.locationId,
        qtyBase: { gte: qtyStr },
      },
      data: { qtyBase: { decrement: qtyStr } },
    });
    if (res.count === 0) {
      throw new StockError("insufficient stock: OUT would drive the balance negative");
    }
  }

  const ledger = await tx.stockLedger.create({
    data: {
      companyId: e.companyId,
      ...(e.at ? { at: e.at } : {}),
      grain: "BULK",
      direction: e.direction,
      reason: e.reason,
      itemId: e.itemId,
      locationId: e.locationId,
      qtyBase: qtyStr,
      refType: e.refType ?? null,
      refId: e.refId ?? null,
      actorUserId: e.actorUserId ?? null,
    },
  });

  await writeAudit(tx, {
    companyId: e.companyId,
    entity: "StockLedger",
    entityId: ledger.id,
    action: `BULK_${e.direction}`,
    actorUserId: e.actorUserId ?? null,
    after: { itemId: e.itemId, locationId: e.locationId, qtyBase: qtyStr },
  });

  return ledger;
}

async function postSerial(
  tx: Tx,
  e: Extract<LedgerEntryInput, { grain: "SERIAL" }>,
): Promise<StockLedger> {
  const roll = await tx.roll.findUnique({ where: { id: e.rollId } });
  if (!roll || roll.companyId !== e.companyId) {
    throw new StockError(`roll ${e.rollId} not found`);
  }

  const ledger = await tx.stockLedger.create({
    data: {
      companyId: e.companyId,
      ...(e.at ? { at: e.at } : {}),
      grain: "SERIAL",
      direction: e.direction,
      reason: e.reason,
      itemId: roll.itemId,
      locationId: roll.locationId,
      rollId: roll.id,
      qtyBase: roll.qtyKgActual, // a roll's base quantity is its actual weighed kg
      qtyKg: roll.qtyKgActual,
      qtyM2: roll.qtyM2,
      refType: e.refType ?? null,
      refId: e.refId ?? null,
      actorUserId: e.actorUserId ?? null,
    },
  });

  if (e.setRollState && e.setRollState !== roll.state) {
    await tx.roll.update({ where: { id: roll.id }, data: { state: e.setRollState } });
    await writeAudit(tx, {
      companyId: e.companyId,
      entity: "Roll",
      entityId: roll.id,
      action: "STATE",
      actorUserId: e.actorUserId ?? null,
      before: { state: roll.state },
      after: { state: e.setRollState },
    });
  }

  await writeAudit(tx, {
    companyId: e.companyId,
    entity: "StockLedger",
    entityId: ledger.id,
    action: `SERIAL_${e.direction}`,
    actorUserId: e.actorUserId ?? null,
    after: { rollId: roll.id, qtyKg: roll.qtyKgActual.toString() },
  });

  return ledger;
}

// --- roll receipt (serial IN, UOM-derived) -------------------------------------------

export interface ReceiveRollInput {
  companyId: string;
  itemId: string;
  locationId: string;
  /** Ordered layer stack + dimensions; m², theoretical kg and density are derived via UOM. */
  dimensions: Dimensions;
  /** Weighed weight from the scale — the quantity of record (may differ from theoretical). */
  actualKg: DecimalInput;
  agingReadyDate?: Date | null;
  /** Fresh foam starts curing; pass AVAILABLE for already-cured receipts. */
  initialState?: RollState;
  reason?: StockReason;
  lotId?: string | null;
  refType?: string;
  refId?: string;
  actorUserId?: string | null;
}

/** Create a roll (deriving m²/theoretical kg/density from its dimensions via `lib/uom.ts`)
 *  and post the matching SERIAL IN in one transaction. */
export async function receiveRoll(
  tx: Tx,
  input: ReceiveRollInput,
): Promise<{ roll: Roll; ledger: StockLedger }> {
  const qtyM2 = areaM2(input.dimensions);
  const theoreticalKg = weightKg(input.dimensions);
  const density = compositeDensity(input.dimensions);
  const actualKg = new Decimal(input.actualKg);

  const layersJson = input.dimensions.layers.map((l) => ({
    thickness_mm: String(l.thickness_mm),
    density_kg_m3: String(l.density_kg_m3),
  }));

  const roll = await tx.roll.create({
    data: {
      companyId: input.companyId,
      itemId: input.itemId,
      locationId: input.locationId,
      lotId: input.lotId ?? null,
      state: input.initialState ?? "CURING",
      length_m: String(input.dimensions.length_m),
      width_m: String(input.dimensions.width_m),
      layersJson: layersJson as Prisma.InputJsonValue,
      qtyKgTheoretical: theoreticalKg.toString(),
      qtyKgActual: actualKg.toString(),
      qtyM2: qtyM2.toString(),
      densityKgM3: density.toString(),
      agingReadyDate: input.agingReadyDate ?? null,
    },
  });

  const ledger = await postSerial(tx, {
    grain: "SERIAL",
    direction: "IN",
    companyId: input.companyId,
    rollId: roll.id,
    reason: input.reason ?? "PRODUCTION",
    ...(input.refType ? { refType: input.refType } : {}),
    ...(input.refId ? { refId: input.refId } : {}),
    actorUserId: input.actorUserId ?? null,
  });

  return { roll, ledger };
}

// --- allocation (reserve specific rolls at picking) ----------------------------------

export interface AllocateOptions {
  actorUserId?: string | null;
  refType?: string;
  refId?: string;
  /** Allocate a not-yet-available (curing) roll — permitted but logged (CLAUDE.md 5). */
  override?: { reason: string };
  asOf?: Date;
}

/**
 * Reserve specific rolls at picking: AVAILABLE → ALLOCATED (resolved decision). The state
 * transition is a guarded atomic update, so two pickers cannot both grab the same roll.
 */
export async function allocateRolls(
  tx: Tx,
  companyId: string,
  rollIds: string[],
  options: AllocateOptions = {},
): Promise<void> {
  const asOf = options.asOf ?? new Date();

  for (const id of rollIds) {
    const roll = await tx.roll.findUnique({ where: { id } });
    if (!roll || roll.companyId !== companyId) {
      throw new StockError(`roll ${id} not found`);
    }

    // Without override, only an AVAILABLE, aging-ready roll may be allocated. With
    // override, a CURING roll is allowed too (but never one already past AVAILABLE).
    const guard: Prisma.RollWhereInput = options.override
      ? { id, companyId, state: { in: ["AVAILABLE", "CURING"] } }
      : {
          id,
          companyId,
          state: "AVAILABLE",
          OR: [{ agingReadyDate: null }, { agingReadyDate: { lte: asOf } }],
        };

    const res = await tx.roll.updateMany({
      where: guard,
      data: { state: "ALLOCATED" },
    });
    if (res.count === 0) {
      throw new StockError(
        `roll ${id} is not available for allocation (state=${roll.state}` +
          (roll.agingReadyDate && roll.agingReadyDate > asOf ? ", still curing)" : ")"),
      );
    }

    await writeAudit(tx, {
      companyId,
      entity: "Roll",
      entityId: id,
      action: options.override ? "ALLOCATE_OVERRIDE" : "ALLOCATE",
      actorUserId: options.actorUserId ?? null,
      before: { state: roll.state },
      after: {
        state: "ALLOCATED",
        refType: options.refType ?? null,
        refId: options.refId ?? null,
        ...(options.override ? { overrideReason: options.override.reason } : {}),
      },
    });
  }
}

// --- reversal ------------------------------------------------------------------------

/** Post a compensating entry for a prior movement (append-only correction). Undoes the
 *  bulk balance effect; a bulk reversal that would underflow is refused. */
export async function reverse(
  tx: Tx,
  ledgerId: string,
  actorUserId: string | null,
  reason: string,
): Promise<StockLedger> {
  const orig = await tx.stockLedger.findUnique({ where: { id: ledgerId } });
  if (!orig) throw new StockError(`ledger entry ${ledgerId} not found`);
  if (orig.reason === "REVERSAL") throw new StockError("cannot reverse a reversal");

  const already = await tx.stockLedger.findUnique({
    where: { reversesLedgerId: ledgerId },
  });
  if (already) throw new StockError("entry already reversed");

  const opposite: StockDirection = orig.direction === "IN" ? "OUT" : "IN";

  if (orig.grain === "BULK") {
    const where = {
      companyId_itemId_locationId: {
        companyId: orig.companyId,
        itemId: orig.itemId,
        locationId: orig.locationId,
      },
    } satisfies Prisma.StockBalanceWhereUniqueInput;

    if (opposite === "IN") {
      await tx.stockBalance.update({
        where,
        data: { qtyBase: { increment: orig.qtyBase } },
      });
    } else {
      const res = await tx.stockBalance.updateMany({
        where: {
          companyId: orig.companyId,
          itemId: orig.itemId,
          locationId: orig.locationId,
          qtyBase: { gte: orig.qtyBase },
        },
        data: { qtyBase: { decrement: orig.qtyBase } },
      });
      if (res.count === 0) {
        throw new StockError("cannot reverse: balance would go negative");
      }
    }
  }

  const rev = await tx.stockLedger.create({
    data: {
      companyId: orig.companyId,
      grain: orig.grain,
      direction: opposite,
      reason: "REVERSAL",
      itemId: orig.itemId,
      locationId: orig.locationId,
      rollId: orig.rollId,
      qtyBase: orig.qtyBase,
      qtyKg: orig.qtyKg,
      qtyM2: orig.qtyM2,
      refType: orig.refType,
      refId: orig.refId,
      reversesLedgerId: orig.id,
      actorUserId,
    },
  });

  await writeAudit(tx, {
    companyId: orig.companyId,
    entity: "StockLedger",
    entityId: rev.id,
    action: "REVERSAL",
    actorUserId,
    after: { reverses: orig.id, reason },
  });

  return rev;
}

// --- balance & availability queries --------------------------------------------------

/** Current bulk balance for an (item, location). Zero when no balance row exists yet. */
export async function itemBalance(
  db: Tx,
  companyId: string,
  itemId: string,
  locationId: string,
): Promise<Decimal> {
  const row = await db.stockBalance.findUnique({
    where: { companyId_itemId_locationId: { companyId, itemId, locationId } },
  });
  return new Decimal(row ? row.qtyBase.toString() : 0);
}

export interface RollBalance {
  count: number;
  qtyKg: Decimal;
  qtyM2: Decimal;
}

/** Aggregate serial rolls matching a filter, in both kg and m² (exact Decimal sums). */
export async function rollBalance(
  db: Tx,
  companyId: string,
  filter: { itemId?: string; locationId?: string; state?: RollState } = {},
): Promise<RollBalance> {
  const rolls = await db.roll.findMany({
    where: {
      companyId,
      ...(filter.itemId ? { itemId: filter.itemId } : {}),
      ...(filter.locationId ? { locationId: filter.locationId } : {}),
      ...(filter.state ? { state: filter.state } : {}),
    },
  });

  let qtyKg = new Decimal(0);
  let qtyM2 = new Decimal(0);
  for (const r of rolls) {
    qtyKg = qtyKg.plus(r.qtyKgActual.toString());
    qtyM2 = qtyM2.plus(r.qtyM2.toString());
  }
  return { count: rolls.length, qtyKg, qtyM2 };
}

/** Rolls of an item that are sellable as of a given instant: AVAILABLE and past their
 *  aging-ready date. Curing rolls are physical but not available (CLAUDE.md rule 5). */
export async function availableRolls(
  db: Tx,
  companyId: string,
  itemId: string,
  asOf: Date,
): Promise<Roll[]> {
  return db.roll.findMany({
    where: {
      companyId,
      itemId,
      state: "AVAILABLE",
      OR: [{ agingReadyDate: null }, { agingReadyDate: { lte: asOf } }],
    },
  });
}
