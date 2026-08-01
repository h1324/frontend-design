// lib/production-masters.ts — machine / shift / operator / downtime-reason masters (S8).
// Small reference masters a production batch (S10) references. Pure validation; the
// service functions enforce MASTERS-write, write audit rows, keep `code` immutable, and
// deactivate rather than delete.

import type {
  DowntimeCategory,
  DowntimeReason,
  Machine,
  Operator,
  Prisma,
  Shift,
} from "@prisma/client";
import { Decimal, type DecimalInput } from "./decimal.js";
import { requireAccess, AuthzError, type Actor } from "./rbac.js";
import { writeAudit } from "./audit.js";

type Tx = Prisma.TransactionClient;

export const DOWNTIME_CATEGORIES: readonly DowntimeCategory[] = [
  "DIE_CHANGE",
  "RM_CHANGEOVER",
  "BREAKDOWN",
  "POWER_CUT",
  "NO_ORDERS",
  "MAINTENANCE",
  "OTHER",
];

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export class ProductionMasterValidationError extends Error {
  override name = "ProductionMasterValidationError";
  readonly errors: string[];
  constructor(errors: string[]) {
    super(errors.join("; "));
    this.errors = errors;
  }
}

function reject(errors: string[]): never {
  throw new ProductionMasterValidationError(errors);
}

// --- machine -------------------------------------------------------------------------

export interface MachineInput {
  code: string;
  name: string;
  ratedCapacityKgHr?: DecimalInput | null;
}

export function validateMachine(input: MachineInput): string[] {
  const errors: string[] = [];
  if (!input.code?.trim()) errors.push("code is required");
  if (!input.name?.trim()) errors.push("name is required");
  if (input.ratedCapacityKgHr != null && input.ratedCapacityKgHr !== "") {
    try {
      if (new Decimal(input.ratedCapacityKgHr).lte(0)) {
        errors.push("ratedCapacityKgHr must be greater than zero");
      }
    } catch {
      errors.push("ratedCapacityKgHr is not a number");
    }
  }
  return errors;
}

export async function createMachine(
  tx: Tx,
  actor: Actor,
  input: MachineInput,
): Promise<Machine> {
  requireAccess(actor, "MASTERS", "write");
  const errors = validateMachine(input);
  if (errors.length) reject(errors);
  const machine = await tx.machine.create({
    data: {
      companyId: actor.companyId,
      code: input.code,
      name: input.name,
      ratedCapacityKgHr:
        input.ratedCapacityKgHr != null && input.ratedCapacityKgHr !== ""
          ? String(input.ratedCapacityKgHr)
          : null,
    },
  });
  await audit(tx, actor, "Machine", machine.id, "CREATE", null, {
    code: machine.code,
    name: machine.name,
  });
  return machine;
}

export async function updateMachine(
  tx: Tx,
  actor: Actor,
  id: string,
  patch: { name?: string; ratedCapacityKgHr?: DecimalInput | null },
): Promise<Machine> {
  requireAccess(actor, "MASTERS", "write");
  const current = await tx.machine.findFirst({
    where: { id, companyId: actor.companyId },
  });
  if (!current) throw new AuthzError("machine not found");
  const merged: MachineInput = {
    code: current.code,
    name: patch.name ?? current.name,
    ratedCapacityKgHr:
      patch.ratedCapacityKgHr !== undefined
        ? patch.ratedCapacityKgHr
        : (current.ratedCapacityKgHr?.toString() ?? null),
  };
  const errors = validateMachine(merged);
  if (errors.length) reject(errors);
  const machine = await tx.machine.update({
    where: { id },
    data: {
      name: merged.name,
      ratedCapacityKgHr:
        merged.ratedCapacityKgHr != null && merged.ratedCapacityKgHr !== ""
          ? String(merged.ratedCapacityKgHr)
          : null,
    },
  });
  await audit(
    tx,
    actor,
    "Machine",
    id,
    "UPDATE",
    { name: current.name },
    { name: machine.name },
  );
  return machine;
}

export function setMachineActive(tx: Tx, actor: Actor, id: string, isActive: boolean) {
  return setActive(
    tx,
    actor,
    "Machine",
    id,
    isActive,
    (where) => tx.machine.findFirst({ where }),
    (args) => tx.machine.update(args),
  );
}

// --- shift ---------------------------------------------------------------------------

export interface ShiftInput {
  code: string;
  name: string;
  startTime: string; // HH:MM
  endTime: string; // HH:MM
}

export function validateShift(input: ShiftInput): string[] {
  const errors: string[] = [];
  if (!input.code?.trim()) errors.push("code is required");
  if (!input.name?.trim()) errors.push("name is required");
  if (!HHMM_RE.test(input.startTime ?? "")) errors.push("startTime must be HH:MM");
  if (!HHMM_RE.test(input.endTime ?? "")) errors.push("endTime must be HH:MM");
  return errors;
}

export async function createShift(
  tx: Tx,
  actor: Actor,
  input: ShiftInput,
): Promise<Shift> {
  requireAccess(actor, "MASTERS", "write");
  const errors = validateShift(input);
  if (errors.length) reject(errors);
  const shift = await tx.shift.create({
    data: {
      companyId: actor.companyId,
      code: input.code,
      name: input.name,
      startTime: input.startTime,
      endTime: input.endTime,
    },
  });
  await audit(tx, actor, "Shift", shift.id, "CREATE", null, {
    code: shift.code,
    name: shift.name,
  });
  return shift;
}

export async function updateShift(
  tx: Tx,
  actor: Actor,
  id: string,
  patch: { name?: string; startTime?: string; endTime?: string },
): Promise<Shift> {
  requireAccess(actor, "MASTERS", "write");
  const current = await tx.shift.findFirst({ where: { id, companyId: actor.companyId } });
  if (!current) throw new AuthzError("shift not found");
  const merged: ShiftInput = {
    code: current.code,
    name: patch.name ?? current.name,
    startTime: patch.startTime ?? current.startTime,
    endTime: patch.endTime ?? current.endTime,
  };
  const errors = validateShift(merged);
  if (errors.length) reject(errors);
  const shift = await tx.shift.update({
    where: { id },
    data: { name: merged.name, startTime: merged.startTime, endTime: merged.endTime },
  });
  await audit(
    tx,
    actor,
    "Shift",
    id,
    "UPDATE",
    { name: current.name },
    { name: shift.name },
  );
  return shift;
}

export function setShiftActive(tx: Tx, actor: Actor, id: string, isActive: boolean) {
  return setActive(
    tx,
    actor,
    "Shift",
    id,
    isActive,
    (where) => tx.shift.findFirst({ where }),
    (args) => tx.shift.update(args),
  );
}

// --- operator ------------------------------------------------------------------------

export interface OperatorInput {
  code: string;
  name: string;
}

export function validateOperator(input: OperatorInput): string[] {
  const errors: string[] = [];
  if (!input.code?.trim()) errors.push("code is required");
  if (!input.name?.trim()) errors.push("name is required");
  return errors;
}

export async function createOperator(
  tx: Tx,
  actor: Actor,
  input: OperatorInput,
): Promise<Operator> {
  requireAccess(actor, "MASTERS", "write");
  const errors = validateOperator(input);
  if (errors.length) reject(errors);
  const operator = await tx.operator.create({
    data: { companyId: actor.companyId, code: input.code, name: input.name },
  });
  await audit(tx, actor, "Operator", operator.id, "CREATE", null, {
    code: operator.code,
    name: operator.name,
  });
  return operator;
}

export async function updateOperator(
  tx: Tx,
  actor: Actor,
  id: string,
  patch: { name?: string },
): Promise<Operator> {
  requireAccess(actor, "MASTERS", "write");
  const current = await tx.operator.findFirst({
    where: { id, companyId: actor.companyId },
  });
  if (!current) throw new AuthzError("operator not found");
  const name = patch.name ?? current.name;
  if (!name.trim()) reject(["name is required"]);
  const operator = await tx.operator.update({ where: { id }, data: { name } });
  await audit(
    tx,
    actor,
    "Operator",
    id,
    "UPDATE",
    { name: current.name },
    { name: operator.name },
  );
  return operator;
}

export function setOperatorActive(tx: Tx, actor: Actor, id: string, isActive: boolean) {
  return setActive(
    tx,
    actor,
    "Operator",
    id,
    isActive,
    (where) => tx.operator.findFirst({ where }),
    (args) => tx.operator.update(args),
  );
}

// --- downtime reason -----------------------------------------------------------------

export interface DowntimeReasonInput {
  code: string;
  description: string;
  category: DowntimeCategory;
}

export function validateDowntimeReason(input: DowntimeReasonInput): string[] {
  const errors: string[] = [];
  if (!input.code?.trim()) errors.push("code is required");
  if (!input.description?.trim()) errors.push("description is required");
  if (!DOWNTIME_CATEGORIES.includes(input.category)) errors.push("category is invalid");
  return errors;
}

export async function createDowntimeReason(
  tx: Tx,
  actor: Actor,
  input: DowntimeReasonInput,
): Promise<DowntimeReason> {
  requireAccess(actor, "MASTERS", "write");
  const errors = validateDowntimeReason(input);
  if (errors.length) reject(errors);
  const reason = await tx.downtimeReason.create({
    data: {
      companyId: actor.companyId,
      code: input.code,
      description: input.description,
      category: input.category,
    },
  });
  await audit(tx, actor, "DowntimeReason", reason.id, "CREATE", null, {
    code: reason.code,
    category: reason.category,
  });
  return reason;
}

export async function updateDowntimeReason(
  tx: Tx,
  actor: Actor,
  id: string,
  patch: { description?: string; category?: DowntimeCategory },
): Promise<DowntimeReason> {
  requireAccess(actor, "MASTERS", "write");
  const current = await tx.downtimeReason.findFirst({
    where: { id, companyId: actor.companyId },
  });
  if (!current) throw new AuthzError("downtime reason not found");
  const merged: DowntimeReasonInput = {
    code: current.code,
    description: patch.description ?? current.description,
    category: patch.category ?? current.category,
  };
  const errors = validateDowntimeReason(merged);
  if (errors.length) reject(errors);
  const reason = await tx.downtimeReason.update({
    where: { id },
    data: { description: merged.description, category: merged.category },
  });
  await audit(
    tx,
    actor,
    "DowntimeReason",
    id,
    "UPDATE",
    { description: current.description, category: current.category },
    { description: reason.description, category: reason.category },
  );
  return reason;
}

export function setDowntimeReasonActive(
  tx: Tx,
  actor: Actor,
  id: string,
  isActive: boolean,
) {
  return setActive(
    tx,
    actor,
    "DowntimeReason",
    id,
    isActive,
    (where) => tx.downtimeReason.findFirst({ where }),
    (args) => tx.downtimeReason.update(args),
  );
}

// --- shared helpers ------------------------------------------------------------------

function audit(
  tx: Tx,
  actor: Actor,
  entity: string,
  entityId: string,
  action: string,
  before: Prisma.InputJsonValue | null,
  after: Prisma.InputJsonValue,
) {
  return writeAudit(tx, {
    companyId: actor.companyId,
    entity,
    entityId,
    action,
    actorUserId: actor.userId,
    ...(before !== null ? { before } : {}),
    after,
  });
}

interface ActiveRow {
  id: string;
  isActive: boolean;
}

/** Shared activate/deactivate for the master entities (all share id + isActive + code scope). */
async function setActive(
  tx: Tx,
  actor: Actor,
  entity: string,
  id: string,
  isActive: boolean,
  find: (where: { id: string; companyId: string }) => Promise<ActiveRow | null>,
  update: (args: {
    where: { id: string };
    data: { isActive: boolean };
  }) => Promise<ActiveRow>,
): Promise<ActiveRow> {
  requireAccess(actor, "MASTERS", "write");
  const current = await find({ id, companyId: actor.companyId });
  if (!current) throw new AuthzError(`${entity} not found`);
  const row = await update({ where: { id }, data: { isActive } });
  await audit(
    tx,
    actor,
    entity,
    id,
    isActive ? "ACTIVATE" : "DEACTIVATE",
    { isActive: current.isActive },
    { isActive },
  );
  return row;
}

// --- representative seed -------------------------------------------------------------

// PLACEHOLDER production masters for a greenfield line — replace via the UI.
export const MACHINE_SEED: MachineInput[] = [
  { code: "FLY-250", name: "FLY-250 EPE extrusion line", ratedCapacityKgHr: "120" },
];
export const SHIFT_SEED: ShiftInput[] = [
  { code: "A", name: "Shift A (morning)", startTime: "08:00", endTime: "16:00" },
  { code: "B", name: "Shift B (evening)", startTime: "16:00", endTime: "00:00" },
  { code: "C", name: "Shift C (night)", startTime: "00:00", endTime: "08:00" },
];
export const OPERATOR_SEED: OperatorInput[] = [
  { code: "OP-01", name: "Operator 1 (placeholder)" },
  { code: "OP-02", name: "Operator 2 (placeholder)" },
];
export const DOWNTIME_REASON_SEED: DowntimeReasonInput[] = [
  { code: "DIE", description: "Die change", category: "DIE_CHANGE" },
  { code: "RMC", description: "Raw-material changeover", category: "RM_CHANGEOVER" },
  { code: "BRK", description: "Machine breakdown", category: "BREAKDOWN" },
  { code: "PWR", description: "Power cut", category: "POWER_CUT" },
  { code: "NORD", description: "No orders", category: "NO_ORDERS" },
  { code: "MNT", description: "Planned maintenance", category: "MAINTENANCE" },
];
