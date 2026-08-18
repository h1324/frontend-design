import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { requireActor, requireAccess, can } from "@/lib/rbac";
import { formatPaise } from "@/lib/gst";
import { salesOrderTotalsPaise } from "@/lib/sales-order";
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
import { createSOAction } from "./actions";

const selectClass =
  "h-10 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const LINE_ROWS = 6;

const statusTone: Record<string, string> = {
  CONFIRMED: "text-foreground",
  PARTIALLY_FULFILLED: "text-foreground",
  FULFILLED: "text-muted-foreground",
  DRAFT: "text-muted-foreground",
  CANCELLED: "text-muted-foreground",
};

const creditTone: Record<string, string> = {
  OK: "text-muted-foreground",
  BLOCKED: "text-destructive",
  OVERRIDDEN: "text-foreground",
};

export default async function SalesOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const actor = requireActor(await auth());
  requireAccess(actor, "SALES", "read");
  const canWrite = can(actor.role, "SALES", "write");

  const [customers, items, orders] = await Promise.all([
    prisma.customer.findMany({
      where: { companyId: actor.companyId, isActive: true },
      orderBy: { name: "asc" },
      include: { shipTos: true },
    }),
    prisma.item.findMany({
      where: {
        companyId: actor.companyId,
        isActive: true,
        type: { in: ["FINISHED_GOOD", "WIP_ROLL"] },
      },
      orderBy: { code: "asc" },
    }),
    prisma.salesOrder.findMany({
      where: { companyId: actor.companyId },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { customer: true, lines: true },
    }),
  ]);

  const shipTos = customers.flatMap((c) =>
    c.shipTos.map((s) => ({ id: s.id, label: `${c.name} — ${s.label}` })),
  );

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-6 py-12">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">
            EPE Foam ERP · Sales
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Sales orders</h1>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link href="/">Home</Link>
        </Button>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {canWrite ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">New sales order</CardTitle>
            <CardDescription>
              Capture a customer order. Confirming runs a credit check; you then reserve
              rolls and dispatch against it. GST is taken from the item master.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {customers.length === 0 || items.length === 0 || shipTos.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Add a customer with a ship-to address and a finished-good item first.
              </p>
            ) : (
              <form action={createSOAction} className="flex flex-col gap-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <Label>Customer</Label>
                    <select name="customerId" required className={selectClass}>
                      {customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.code} — {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>Ship-to</Label>
                    <select name="shipToId" required className={selectClass}>
                      {shipTos.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))}
                    </select>
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
                              {it.code} — {it.name} ({it.uomBase})
                            </option>
                          ))}
                        </select>
                        <Input name="lineQty" inputMode="decimal" placeholder="0" />
                        <Input name="lineRate" inputMode="decimal" placeholder="0.00" />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button type="submit">Create order</Button>
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
                <th className="py-2 pr-4 font-medium">SO no</th>
                <th className="py-2 pr-4 font-medium">Customer</th>
                <th className="py-2 pr-4 font-medium">Lines</th>
                <th className="py-2 pr-4 font-medium">Value (incl. GST)</th>
                <th className="py-2 pr-4 font-medium">Credit</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {orders.map((so) => {
                const totals = salesOrderTotalsPaise(
                  so.lines.map((l) => ({
                    qtyOrdered: l.qtyOrdered.toString(),
                    ratePaise: l.ratePaise,
                    gstRatePct: l.gstRatePct.toString(),
                  })),
                  true,
                );
                return (
                  <tr key={so.id} className="border-b last:border-0">
                    <td className="py-2 pr-4 font-mono text-xs">{so.docNo}</td>
                    <td className="py-2 pr-4">{so.customer.name}</td>
                    <td className="py-2 pr-4 tabular-nums">{so.lines.length}</td>
                    <td className="py-2 pr-4 tabular-nums">
                      {formatPaise(totals.totalPaise)}
                    </td>
                    <td className={`py-2 pr-4 ${creditTone[so.creditStatus] ?? ""}`}>
                      {so.creditStatus}
                    </td>
                    <td className={`py-2 pr-4 ${statusTone[so.status] ?? ""}`}>
                      {so.status}
                    </td>
                    <td className="py-2">
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/sales/orders/${so.id}`}>Open</Link>
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {orders.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-muted-foreground">
                    No sales orders yet.
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
