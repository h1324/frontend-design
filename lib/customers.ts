// lib/customers.ts — customer master service and validation (spec S7).
// Billing identity + credit terms + multiple ship-to addresses. Validation is pure; the
// service enforces authorization (MASTERS write), writes audit rows, keeps `code`
// immutable, and maintains the "exactly one default ship-to" invariant. Tier is a
// placeholder (UNGRADED) — the Diamond scoring model is deferred to Phase 2.

import {
  Prisma,
  type Customer,
  type CustomerTier,
  type ShipToAddress,
} from "@prisma/client";
import { Decimal, type DecimalInput } from "./decimal.js";
import { requireAccess, AuthzError, type Actor } from "./rbac.js";
import { isValidGstinFormat } from "./gstin.js";
import { writeAudit } from "./audit.js";

type Tx = Prisma.TransactionClient;

export interface Address {
  line1?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
}

export interface ShipToInput {
  label: string;
  gstStateCode: string; // 2-digit
  address?: Address | null;
  isDefault?: boolean;
}

export interface CustomerInput {
  code: string;
  name: string;
  legalName?: string | null;
  gstin?: string | null;
  pan?: string | null;
  creditLimit?: DecimalInput | null;
  creditDays?: number | null;
  paymentTerms?: string | null;
  transporterPreference?: string | null;
  tier?: CustomerTier | null;
  shipTos?: ShipToInput[] | null;
}

export type CustomerPatch = Partial<Omit<CustomerInput, "code" | "shipTos">>;

export class CustomerValidationError extends Error {
  override name = "CustomerValidationError";
  readonly errors: string[];
  constructor(errors: string[]) {
    super(errors.join("; "));
    this.errors = errors;
  }
}

const STATE_CODE_RE = /^\d{2}$/;

export function validateShipTo(input: ShipToInput, prefix = "shipTo"): string[] {
  const errors: string[] = [];
  if (!input.label?.trim()) errors.push(`${prefix}: label is required`);
  if (!STATE_CODE_RE.test(input.gstStateCode ?? "")) {
    errors.push(`${prefix}: gstStateCode must be a 2-digit state code`);
  }
  return errors;
}

/** Validate a customer (and any nested ship-tos). Returns field errors. Pure. */
export function validateCustomerInput(input: CustomerInput): string[] {
  const errors: string[] = [];
  if (!input.code?.trim()) errors.push("code is required");
  if (!input.name?.trim()) errors.push("name is required");
  if (input.gstin != null && input.gstin !== "" && !isValidGstinFormat(input.gstin)) {
    errors.push("gstin must be a valid 15-character GSTIN");
  }
  if (input.creditLimit != null && input.creditLimit !== "") {
    try {
      if (new Decimal(input.creditLimit).lt(0)) errors.push("creditLimit must be ≥ 0");
    } catch {
      errors.push("creditLimit is not a number");
    }
  }
  if (
    input.creditDays != null &&
    (!Number.isInteger(input.creditDays) || input.creditDays < 0)
  ) {
    errors.push("creditDays must be a whole number ≥ 0");
  }

  const shipTos = input.shipTos ?? [];
  shipTos.forEach((s, i) => errors.push(...validateShipTo(s, `shipTos[${i}]`)));
  if (shipTos.filter((s) => s.isDefault).length > 1) {
    errors.push("only one ship-to can be the default");
  }

  return errors;
}

// --- helpers -------------------------------------------------------------------------

function addressJson(address: Address | null | undefined) {
  if (!address) return Prisma.DbNull;
  const cleaned = Object.fromEntries(
    Object.entries(address).filter(([, v]) => v != null && v !== ""),
  );
  return Object.keys(cleaned).length ? (cleaned as Prisma.InputJsonValue) : Prisma.DbNull;
}

function customerData(input: CustomerInput) {
  return {
    name: input.name,
    legalName: input.legalName ?? null,
    gstin: input.gstin ? input.gstin : null,
    pan: input.pan ?? null,
    creditLimit:
      input.creditLimit != null && input.creditLimit !== ""
        ? String(input.creditLimit)
        : "0",
    creditDays: input.creditDays ?? 0,
    paymentTerms: input.paymentTerms ?? null,
    transporterPreference: input.transporterPreference ?? null,
    tier: input.tier ?? "UNGRADED",
  };
}

/** Pick which ship-to index is default: the one flagged, else the first. */
function defaultIndex(shipTos: ShipToInput[]): number {
  const flagged = shipTos.findIndex((s) => s.isDefault);
  return flagged >= 0 ? flagged : 0;
}

// --- service functions ---------------------------------------------------------------

export async function createCustomer(
  tx: Tx,
  actor: Actor,
  input: CustomerInput,
): Promise<Customer> {
  requireAccess(actor, "MASTERS", "write");
  const errors = validateCustomerInput(input);
  if (errors.length) throw new CustomerValidationError(errors);

  const shipTos = input.shipTos ?? [];
  const defIdx = shipTos.length ? defaultIndex(shipTos) : -1;

  const customer = await tx.customer.create({
    data: {
      companyId: actor.companyId,
      code: input.code,
      ...customerData(input),
      shipTos: shipTos.length
        ? {
            create: shipTos.map((s, i) => ({
              label: s.label,
              gstStateCode: s.gstStateCode,
              addressJson: addressJson(s.address),
              isDefault: i === defIdx,
            })),
          }
        : undefined,
    },
  });

  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "Customer",
    entityId: customer.id,
    action: "CREATE",
    actorUserId: actor.userId,
    after: { code: customer.code, name: customer.name, tier: customer.tier },
  });
  return customer;
}

export async function updateCustomer(
  tx: Tx,
  actor: Actor,
  customerId: string,
  patch: CustomerPatch,
): Promise<Customer> {
  requireAccess(actor, "MASTERS", "write");
  const current = await tx.customer.findFirst({
    where: { id: customerId, companyId: actor.companyId },
  });
  if (!current) throw new AuthzError("customer not found");

  const merged: CustomerInput = { code: current.code, name: current.name, ...patch };
  const errors = validateCustomerInput(merged);
  if (errors.length) throw new CustomerValidationError(errors);

  const customer = await tx.customer.update({
    where: { id: customerId },
    data: customerData(merged), // `code` immutable
  });
  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "Customer",
    entityId: customerId,
    action: "UPDATE",
    actorUserId: actor.userId,
    before: {
      name: current.name,
      creditLimit: current.creditLimit.toString(),
      tier: current.tier,
    },
    after: {
      name: customer.name,
      creditLimit: customer.creditLimit.toString(),
      tier: customer.tier,
    },
  });
  return customer;
}

export async function setCustomerActive(
  tx: Tx,
  actor: Actor,
  customerId: string,
  isActive: boolean,
): Promise<Customer> {
  requireAccess(actor, "MASTERS", "write");
  const current = await tx.customer.findFirst({
    where: { id: customerId, companyId: actor.companyId },
  });
  if (!current) throw new AuthzError("customer not found");

  const customer = await tx.customer.update({
    where: { id: customerId },
    data: { isActive },
  });
  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "Customer",
    entityId: customerId,
    action: isActive ? "ACTIVATE" : "DEACTIVATE",
    actorUserId: actor.userId,
    before: { isActive: current.isActive },
    after: { isActive },
  });
  return customer;
}

async function loadCustomer(tx: Tx, actor: Actor, customerId: string): Promise<Customer> {
  const customer = await tx.customer.findFirst({
    where: { id: customerId, companyId: actor.companyId },
  });
  if (!customer) throw new AuthzError("customer not found");
  return customer;
}

/** Add a ship-to. Becomes the default if the customer has none yet, or if flagged. */
export async function addShipTo(
  tx: Tx,
  actor: Actor,
  customerId: string,
  input: ShipToInput,
): Promise<ShipToAddress> {
  requireAccess(actor, "MASTERS", "write");
  await loadCustomer(tx, actor, customerId);

  const errors = validateShipTo(input);
  if (errors.length) throw new CustomerValidationError(errors);

  const existing = await tx.shipToAddress.count({ where: { customerId } });
  const makeDefault = input.isDefault || existing === 0;
  if (makeDefault) {
    await tx.shipToAddress.updateMany({
      where: { customerId },
      data: { isDefault: false },
    });
  }

  const shipTo = await tx.shipToAddress.create({
    data: {
      customerId,
      label: input.label,
      gstStateCode: input.gstStateCode,
      addressJson: addressJson(input.address),
      isDefault: makeDefault,
    },
  });
  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "ShipToAddress",
    entityId: shipTo.id,
    action: "CREATE",
    actorUserId: actor.userId,
    after: {
      customerId,
      label: shipTo.label,
      gstStateCode: shipTo.gstStateCode,
      isDefault: makeDefault,
    },
  });
  return shipTo;
}

/** Make a ship-to the customer's default, clearing the flag on all others. */
export async function setDefaultShipTo(
  tx: Tx,
  actor: Actor,
  shipToId: string,
): Promise<void> {
  requireAccess(actor, "MASTERS", "write");
  const shipTo = await tx.shipToAddress.findUnique({
    where: { id: shipToId },
    include: { customer: { select: { companyId: true } } },
  });
  if (!shipTo || shipTo.customer.companyId !== actor.companyId) {
    throw new AuthzError("ship-to not found");
  }

  await tx.shipToAddress.updateMany({
    where: { customerId: shipTo.customerId },
    data: { isDefault: false },
  });
  await tx.shipToAddress.update({ where: { id: shipToId }, data: { isDefault: true } });
  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "ShipToAddress",
    entityId: shipToId,
    action: "SET_DEFAULT",
    actorUserId: actor.userId,
    after: { customerId: shipTo.customerId },
  });
}

// --- representative seed -------------------------------------------------------------

// PLACEHOLDER customers for a greenfield line — target segments (mattress manufacturers,
// general packaging). Replace with real customers via the master before go-live. One has
// ship-tos in two states to exercise the future IGST path.
export const CUSTOMER_SEED: CustomerInput[] = [
  {
    code: "CUST-MATT-1",
    name: "Mattress Manufacturer A (placeholder)",
    gstin: "27AABCU9603R1ZM",
    tier: "A",
    creditLimit: "500000",
    creditDays: 30,
    paymentTerms: "30 days",
    shipTos: [
      {
        label: "Plant — Maharashtra",
        gstStateCode: "27",
        address: { state: "Maharashtra" },
        isDefault: true,
      },
      { label: "Warehouse — Gujarat", gstStateCode: "24", address: { state: "Gujarat" } },
    ],
  },
  {
    code: "CUST-MATT-2",
    name: "Mattress Manufacturer B (placeholder)",
    gstin: "24AABCU9603R1Z4",
    tier: "B",
    creditLimit: "300000",
    creditDays: 45,
    shipTos: [{ label: "Factory — Gujarat", gstStateCode: "24", isDefault: true }],
  },
  {
    code: "CUST-PKG-1",
    name: "General Packaging Buyer (placeholder)",
    tier: "UNGRADED",
    creditLimit: "100000",
    creditDays: 15,
    shipTos: [{ label: "Shop — Maharashtra", gstStateCode: "27", isDefault: true }],
  },
];
