import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { requireActor, requireAccess, can } from "@/lib/rbac";
import { formatPaise } from "@/lib/gst";
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
import { createQuotationAction } from "./actions";

const selectClass =
  "h-10 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const LINE_ROWS = 6;

const statusTone: Record<string, string> = {
  DRAFT: "text-muted-foreground",
  SENT: "text-foreground",
  WON: "text-foreground",
  LOST: "text-muted-foreground",
  EXPIRED: "text-muted-foreground",
  CANCELLED: "text-muted-foreground",
};

function lineSubtotalPaise(lines: { qtyQuoted: unknown; ratePaise: bigint }[]): bigint {
  return lines.reduce((s, l) => {
    const qty = Number(String(l.qtyQuoted));
    return s + BigInt(Math.round(qty * Number(l.ratePaise)));
  }, 0n);
}

export default async function QuotationsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const actor = requireActor(await auth());
  requireAccess(actor, "SALES", "read");
  const canWrite = can(actor.role, "SALES", "write");

  const [customers, items, quotations] = await Promise.all([
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
    prisma.quotation.findMany({
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
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Quotations</h1>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href="/sales/price-contracts">Price contracts</Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href="/">Home</Link>
          </Button>
        </div>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {canWrite ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">New quotation</CardTitle>
            <CardDescription>
              Quote a price before the order. Leave a rate blank to auto-price it from the
              customer&apos;s price contract (or the item list price); the whole-order
              value discount is resolved on the subtotal. Winning it converts to a sales
              order.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {customers.length === 0 || items.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Add a customer and a finished-good item first.
              </p>
            ) : (
              <form action={createQuotationAction} className="flex flex-col gap-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <Label>Customer</Label>
                    <select name="customerId" required className={selectClass}>
                      {customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.code} — {c.name} ({c.tier})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>Ship-to (optional)</Label>
                    <select name="shipToId" className={selectClass}>
                      <option value="">—</option>
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
                    <span>Rate (₹/unit, blank = auto)</span>
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
                        <Input name="lineRate" inputMode="decimal" placeholder="auto" />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button type="submit">Create quotation</Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent quotations</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Quote no</th>
                <th className="py-2 pr-4 font-medium">Customer</th>
                <th className="py-2 pr-4 font-medium">Lines</th>
                <th className="py-2 pr-4 font-medium">Subtotal</th>
                <th className="py-2 pr-4 font-medium">Disc %</th>
                <th className="py-2 pr-4 font-medium">Valid until</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {quotations.map((q) => (
                <tr key={q.id} className="border-b last:border-0">
                  <td className="py-2 pr-4 font-mono text-xs">{q.docNo}</td>
                  <td className="py-2 pr-4">{q.customer.name}</td>
                  <td className="py-2 pr-4 tabular-nums">{q.lines.length}</td>
                  <td className="py-2 pr-4 tabular-nums">
                    {formatPaise(lineSubtotalPaise(q.lines))}
                  </td>
                  <td className="py-2 pr-4 tabular-nums">
                    {q.orderDiscountPct.toString()}
                  </td>
                  <td className="py-2 pr-4 text-xs text-muted-foreground">
                    {q.validUntil.toLocaleDateString("en-GB")}
                  </td>
                  <td className={`py-2 pr-4 ${statusTone[q.status] ?? ""}`}>
                    {q.status}
                  </td>
                  <td className="py-2">
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/sales/quotations/${q.id}`}>Open</Link>
                    </Button>
                  </td>
                </tr>
              ))}
              {quotations.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-muted-foreground">
                    No quotations yet.
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
