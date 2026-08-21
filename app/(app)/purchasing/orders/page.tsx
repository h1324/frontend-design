import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { requireActor, requireAccess, can } from "@/lib/rbac";
import { formatPaise } from "@/lib/gst";
import { poCommitmentPaise } from "@/lib/purchasing";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { StateBadge } from "@/components/ui/state-badge";
import { createPOAction } from "../actions";

const selectClass =
  "h-10 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const LINE_ROWS = 6;

export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const actor = requireActor(await auth());
  requireAccess(actor, "STORES", "read");
  const canWrite = can(actor.role, "STORES", "write");

  const [suppliers, items, orders] = await Promise.all([
    prisma.supplier.findMany({
      where: { companyId: actor.companyId, isActive: true },
      orderBy: { name: "asc" },
    }),
    prisma.item.findMany({
      where: {
        companyId: actor.companyId,
        isActive: true,
        type: { in: ["RAW_MATERIAL", "CONSUMABLE", "PACKING"] },
      },
      orderBy: { code: "asc" },
    }),
    prisma.purchaseOrder.findMany({
      where: { companyId: actor.companyId },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { supplier: true, lines: true },
    }),
  ]);

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 px-5 py-8 lg:px-8">
      <PageHeader
        eyebrow="Purchasing"
        title="Purchase orders"
        description="Orders to suppliers for resin, butane and additives; received against in the GRN."
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link href="/purchasing/grn">Receiving</Link>
          </Button>
        }
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {canWrite ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">New purchase order</CardTitle>
            <CardDescription>
              Order raw materials/consumables from a supplier. Goods receipt (S15) will
              receive against it; the rate here is indicative.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {suppliers.length === 0 || items.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Add a supplier and at least one raw-material item first.
              </p>
            ) : (
              <form action={createPOAction} className="flex flex-col gap-4">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="flex flex-col gap-1.5 sm:col-span-2">
                    <Label>Supplier</Label>
                    <select name="supplierId" required className={selectClass}>
                      {suppliers.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.code} — {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>Expected date</Label>
                    <Input type="date" name="expectedDate" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>Payment terms</Label>
                    <Input name="paymentTerms" placeholder="e.g. 30 days" />
                  </div>
                </div>

                <div className="rounded-md border">
                  <div className="grid grid-cols-[1fr_120px_140px] gap-2 border-b px-3 py-2 text-xs font-medium text-muted-foreground">
                    <span>Item</span>
                    <span>Qty</span>
                    <span>Rate (₹/unit)</span>
                  </div>
                  <div className="flex flex-col">
                    {Array.from({ length: LINE_ROWS }).map((_, i) => (
                      <div
                        key={i}
                        className="grid grid-cols-[1fr_120px_140px] gap-2 border-b px-3 py-1.5 last:border-0"
                      >
                        <select name="lineItemId" className={selectClass}>
                          <option value="">—</option>
                          {items.map((it) => (
                            <option key={it.id} value={it.id}>
                              {it.code} — {it.name}
                            </option>
                          ))}
                        </select>
                        <Input name="lineQty" inputMode="decimal" placeholder="0" />
                        <Input name="lineRate" inputMode="decimal" placeholder="0.00" />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-4">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="draft" className="h-4 w-4" />
                    Save as draft (don&apos;t release yet)
                  </label>
                  <Button type="submit">Create PO</Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent orders</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">PO no</th>
                <th className="py-2 pr-4 font-medium">Supplier</th>
                <th className="py-2 pr-4 font-medium">Lines</th>
                <th className="py-2 pr-4 font-medium">Value</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {orders.map((po) => (
                <tr key={po.id} className="border-b last:border-0">
                  <td className="py-2 pr-4 font-mono text-xs">{po.docNo}</td>
                  <td className="py-2 pr-4">{po.supplier.name}</td>
                  <td className="py-2 pr-4 tabular-nums">{po.lines.length}</td>
                  <td className="py-2 pr-4 tabular-nums">
                    {formatPaise(
                      poCommitmentPaise(
                        po.lines.map((l) => ({
                          qtyOrdered: l.qtyOrdered.toString(),
                          ratePaise: l.ratePaise,
                        })),
                      ),
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    <StateBadge value={po.status} />
                  </td>
                  <td className="py-2">
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/purchasing/orders/${po.id}`}>Open</Link>
                    </Button>
                  </td>
                </tr>
              ))}
              {orders.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-muted-foreground">
                    No purchase orders yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </main>
  );
}
