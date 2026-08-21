"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { requireActor, AuthzError } from "@/lib/rbac";
import { SalesOrderValidationError } from "@/lib/sales-order";
import {
  applyMobileSubmission,
  mobileCatalogueFor,
  MobileSyncError,
  type MobileCatalogue,
  type MobileSubmitResult,
} from "@/lib/mobile/mobile";

async function actor() {
  return requireActor(await auth());
}

/** Load the cost-free, contract-priced catalogue for a customer (spec S27 rule 4). */
export async function loadCatalogueAction(
  customerId: string,
): Promise<{ ok: true; catalogue: MobileCatalogue } | { ok: false; error: string }> {
  const a = await actor();
  try {
    const catalogue = await mobileCatalogueFor(prisma, a, customerId);
    return { ok: true, catalogue };
  } catch (err) {
    if (err instanceof MobileSyncError || err instanceof AuthzError) {
      return { ok: false, error: err.message };
    }
    throw err;
  }
}

export interface SubmitLineInput {
  itemId: string;
  qtyOrdered: string;
  uom: string;
  devicePricePaise: string | null;
}
export interface SubmitOrderInput {
  clientRequestId: string;
  customerId: string;
  shipToId: string;
  lines: SubmitLineInput[];
  capturedAt?: string;
}

/**
 * Idempotent submit endpoint (spec S27). Re-prices on the server, runs the S18 credit check, and
 * creates a `source=MOBILE` sales order — or returns the same result for a repeated
 * `clientRequestId`. Returns a tagged union so the client can queue/retry on a transport failure
 * (thrown) but treat a business error (returned) as terminal for that submission.
 */
export async function submitMobileOrderAction(
  input: SubmitOrderInput,
): Promise<{ ok: true; result: MobileSubmitResult } | { ok: false; error: string }> {
  const a = await actor();
  try {
    const result = await prisma.$transaction((tx) =>
      applyMobileSubmission(tx, a, {
        clientRequestId: input.clientRequestId,
        customerId: input.customerId,
        shipToId: input.shipToId,
        capturedAt: input.capturedAt ? new Date(input.capturedAt) : undefined,
        lines: input.lines.map((l) => ({
          itemId: l.itemId,
          qtyOrdered: l.qtyOrdered,
          uom: l.uom,
          devicePricePaise:
            l.devicePricePaise != null ? BigInt(l.devicePricePaise) : null,
        })),
      }),
    );
    return { ok: true, result };
  } catch (err) {
    if (
      err instanceof MobileSyncError ||
      err instanceof AuthzError ||
      err instanceof SalesOrderValidationError
    ) {
      return { ok: false, error: err.message };
    }
    throw err;
  }
}
