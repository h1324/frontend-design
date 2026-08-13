import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { requireActor, requireAccess, can } from "@/lib/rbac";
import { formatPaise } from "@/lib/gst";
import { poBalance } from "@/lib/purchasing";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { releasePOAction, closePOAction, cancelPOAction } from "../../actions";

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-GB");
}

export default async function PurchaseOrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const actor = requireActor(await auth());
  requireAccess(actor, "STORES", "read");
  const canWrite = can(actor.role, "STORES", "write");

  const po = await prisma.purchaseOrder.findFirst({
    where: { id, companyId: actor.companyId },
    include: { supplier: true, lines: { include: { item: true } } },
  });
  if (!po) notFound();

  const balance = await poBalance(prisma, po.id);
  const balById = new Map(balance.lines.map((l) => [l.lineId, l]));

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-6 py-12">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">
            EPE Foam ERP · Purchasing
          </p>
          <h1 className="mt-1 font-mono text-2xl font-semibold tracking-tight">
            {po.docNo}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {po.supplier.name} · ordered {fmtDate(po.orderDate)} · expected{" "}
            {fmtDate(po.expectedDate)}
            {po.paymentTerms ? ` · ${po.paymentTerms}` : ""}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className="rounded-full border px-3 py-1 text-xs font-medium">
            {po.status}
          </span>
          {po.status === "OPEN" ? (
            <Button asChild variant="secondary" size="sm">
              <Link href={`/purchasing/grn?poId=${po.id}`}>Receive goods</Link>
            </Button>
          ) : null}
          <Button asChild variant="ghost" size="sm">
            <Link href="/purchasing/orders">All orders</Link>
          </Button>
        </div>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {po.closeReason ? (
        <p className="text-sm text-muted-foreground">Short-closed: {po.closeReason}</p>
      ) : null}

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <CardTitle className="text-base">Lines</CardTitle>
          <span className="text-sm text-muted-foreground">
            Commitment {formatPaise(balance.commitmentPaise)}
          </span>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Item</th>
                <th className="py-2 pr-3 font-medium">Ordered</th>
                <th className="py-2 pr-3 font-medium">Received</th>
                <th className="py-2 pr-3 font-medium">Balance</th>
                <th className="py-2 pr-3 font-medium">UOM</th>
                <th className="py-2 pr-3 font-medium">Rate</th>
                <th className="py-2 font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {po.lines.map((l) => {
                const b = balById.get(l.id);
                return (
                  <tr key={l.id} className="border-b last:border-0">
                    <td className="py-2 pr-3">{l.item.code}</td>
                    <td className="py-2 pr-3 tabular-nums">{l.qtyOrdered.toString()}</td>
                    <td className="py-2 pr-3 tabular-nums">{l.qtyReceived.toString()}</td>
                    <td className="py-2 pr-3 tabular-nums">
                      {b?.balance.toString() ?? "—"}
                    </td>
                    <td className="py-2 pr-3">{l.uom}</td>
                    <td className="py-2 pr-3 tabular-nums">{formatPaise(l.ratePaise)}</td>
                    <td className="py-2 tabular-nums">
                      {formatPaise(b?.amountPaise ?? 0)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {canWrite && (po.status === "DRAFT" || po.status === "OPEN") ? (
        <div className="flex flex-wrap items-end gap-6">
          {po.status === "DRAFT" ? (
            <form action={releasePOAction}>
              <input type="hidden" name="poId" value={po.id} />
              <Button type="submit">Release to supplier</Button>
              <p className="mt-1 text-xs text-muted-foreground">
                DRAFT → OPEN. Makes it receivable in goods receipt.
              </p>
            </form>
          ) : null}

          {po.status === "OPEN" ? (
            <form action={closePOAction} className="flex items-end gap-2">
              <input type="hidden" name="poId" value={po.id} />
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">Close</label>
                <Input
                  name="reason"
                  placeholder="reason (required if balance remains)"
                  className="w-72 text-xs"
                />
              </div>
              <Button type="submit" variant="secondary">
                Close PO
              </Button>
            </form>
          ) : null}

          <form action={cancelPOAction}>
            <input type="hidden" name="poId" value={po.id} />
            <Button type="submit" variant="destructive" size="sm">
              Cancel PO
            </Button>
            <p className="mt-1 text-xs text-muted-foreground">
              Keeps the number. Blocked once goods are received.
            </p>
          </form>
        </div>
      ) : null}
    </main>
  );
}
