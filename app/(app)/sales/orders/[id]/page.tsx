import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { requireActor, requireAccess, can } from "@/lib/rbac";
import { formatPaise } from "@/lib/gst";
import { salesOrderTotalsPaise, lineRemaining } from "@/lib/sales-order";
import { customerOutstandingPaise } from "@/lib/receivables";
import { Decimal } from "@/lib/decimal";
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
import {
  confirmSOAction,
  overrideCreditAction,
  allocateSOAction,
  fulfilSOAction,
  cancelSOAction,
} from "../actions";

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-GB"); // DD/MM/YYYY (Indian convention)
}

export default async function SalesOrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const actor = requireActor(await auth());
  requireAccess(actor, "SALES", "read");
  const canWrite = can(actor.role, "SALES", "write");
  const canOverride = actor.role === "ACCOUNTS" || actor.role === "ADMIN";

  const so = await prisma.salesOrder.findFirst({
    where: { id, companyId: actor.companyId },
    include: {
      customer: true,
      shipTo: true,
      lines: { include: { item: true } },
      allocations: { include: { roll: { include: { item: true } } } },
      dispatchNotes: true,
    },
  });
  if (!so) notFound();

  const totals = salesOrderTotalsPaise(
    so.lines.map((l) => ({
      qtyOrdered: l.qtyOrdered.toString(),
      ratePaise: l.ratePaise,
      gstRatePct: l.gstRatePct.toString(),
    })),
    true,
  );
  const outstanding = await customerOutstandingPaise(
    prisma,
    actor.companyId,
    so.customerId,
  );
  const limitPaise = new Decimal(so.customer.creditLimit.toString()).times(100);

  const isDraft = so.status === "DRAFT";
  const canAllocate = so.status === "CONFIRMED" || so.status === "PARTIALLY_FULFILLED";
  const lineItemIds = new Set(so.lines.map((l) => l.itemId));

  // Available rolls of the order's SKUs (aged, AVAILABLE) for reservation.
  const now = new Date();
  const reservedIds = new Set(so.allocations.map((a) => a.rollId));
  const available = canAllocate
    ? await prisma.roll.findMany({
        where: {
          companyId: actor.companyId,
          state: "AVAILABLE",
          itemId: { in: [...lineItemIds] },
          OR: [{ agingReadyDate: null }, { agingReadyDate: { lte: now } }],
        },
        include: { item: true },
        orderBy: { rollNo: "asc" },
        take: 200,
      })
    : [];
  const pickable = available.filter((r) => !reservedIds.has(r.id));
  // Reserved rolls still on hand (ALLOCATED) can be shipped.
  const shippable = so.allocations.filter((a) => a.roll.state === "ALLOCATED");

  const creditToneClass =
    so.creditStatus === "BLOCKED"
      ? "text-destructive"
      : so.creditStatus === "OVERRIDDEN"
        ? "text-foreground"
        : "text-muted-foreground";

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-6 py-12">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">
            EPE Foam ERP · Sales
          </p>
          <h1 className="mt-1 font-mono text-2xl font-semibold tracking-tight">
            {so.docNo}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {so.customer.code} — {so.customer.name} · {so.shipTo.label} ·{" "}
            {fmtDate(so.orderDate)}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className="rounded-full border px-3 py-1 text-xs font-medium">
            {so.status}
          </span>
          <span className={`text-xs font-medium ${creditToneClass}`}>
            credit: {so.creditStatus}
          </span>
          <Button asChild variant="ghost" size="sm">
            <Link href="/sales/orders">All orders</Link>
          </Button>
        </div>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Order lines</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Item</th>
                <th className="py-2 pr-4 font-medium">Ordered</th>
                <th className="py-2 pr-4 font-medium">Fulfilled</th>
                <th className="py-2 pr-4 font-medium">Remaining</th>
                <th className="py-2 pr-4 font-medium">UOM</th>
                <th className="py-2 pr-4 font-medium">Rate</th>
                <th className="py-2 font-medium">GST%</th>
              </tr>
            </thead>
            <tbody>
              {so.lines.map((l) => (
                <tr key={l.id} className="border-b last:border-0">
                  <td className="py-2 pr-4">
                    {l.item.code} — {l.item.name}
                  </td>
                  <td className="py-2 pr-4 tabular-nums">{l.qtyOrdered.toString()}</td>
                  <td className="py-2 pr-4 tabular-nums">{l.qtyFulfilled.toString()}</td>
                  <td className="py-2 pr-4 tabular-nums">
                    {lineRemaining(
                      l.qtyOrdered.toString(),
                      l.qtyFulfilled.toString(),
                    ).toString()}
                  </td>
                  <td className="py-2 pr-4">{l.uom}</td>
                  <td className="py-2 pr-4 tabular-nums">{formatPaise(l.ratePaise)}</td>
                  <td className="py-2 tabular-nums">{l.gstRatePct.toString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Credit</CardTitle>
          <CardDescription>
            Exposure = current outstanding + this order&apos;s value, checked against the
            credit limit at confirmation.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Metric label="Order value" value={formatPaise(totals.totalPaise)} />
            <Metric label="Outstanding" value={formatPaise(outstanding)} />
            <Metric
              label="Credit limit"
              value={formatPaise(BigInt(limitPaise.toFixed(0)))}
            />
            <Metric label="Credit status" value={so.creditStatus} />
          </div>

          {canWrite && isDraft ? (
            <form action={confirmSOAction}>
              <input type="hidden" name="soId" value={so.id} />
              <Button type="submit">Confirm order (run credit check)</Button>
            </form>
          ) : null}

          {so.creditStatus === "BLOCKED" ? (
            canOverride ? (
              <form
                action={overrideCreditAction}
                className="flex flex-col gap-2 sm:max-w-xl"
              >
                <p className="text-sm text-destructive">
                  Over the credit limit. An ACCOUNTS/ADMIN override is required to
                  proceed.
                </p>
                <div className="flex flex-col gap-1.5">
                  <Label>Override reason</Label>
                  <Input
                    name="reason"
                    required
                    placeholder="e.g. advance received / approved by MD"
                  />
                </div>
                <input type="hidden" name="soId" value={so.id} />
                <div>
                  <Button type="submit" variant="secondary">
                    Override &amp; confirm
                  </Button>
                </div>
              </form>
            ) : (
              <p className="text-sm text-destructive">
                Over the credit limit — an ACCOUNTS or ADMIN user must override to
                confirm.
              </p>
            )
          ) : null}

          {so.creditStatus === "OVERRIDDEN" && so.creditOverrideReason ? (
            <p className="text-xs text-muted-foreground">
              Override reason: {so.creditOverrideReason}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {canWrite && canAllocate ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Reserve rolls</CardTitle>
            <CardDescription>
              Reserves aged, available rolls of the ordered SKUs against this order
              (AVAILABLE → ALLOCATED). A curing/held roll needs an override reason.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {pickable.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No aged, available rolls of the ordered items to reserve.
              </p>
            ) : (
              <form action={allocateSOAction} className="flex flex-col gap-3">
                <input type="hidden" name="soId" value={so.id} />
                <div className="max-h-72 overflow-y-auto rounded-md border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="py-2 pl-3 pr-4 font-medium"></th>
                        <th className="py-2 pr-4 font-medium">Roll</th>
                        <th className="py-2 pr-4 font-medium">SKU</th>
                        <th className="py-2 pr-4 font-medium">kg</th>
                        <th className="py-2 pr-4 font-medium">m²</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pickable.map((r) => (
                        <tr key={r.id} className="border-b last:border-0">
                          <td className="py-2 pl-3 pr-4">
                            <input
                              type="checkbox"
                              name="rollIds"
                              value={r.id}
                              className="h-4 w-4"
                            />
                          </td>
                          <td className="py-2 pr-4 font-mono text-xs">{r.rollNo}</td>
                          <td className="py-2 pr-4">{r.item.code}</td>
                          <td className="py-2 pr-4 tabular-nums">
                            {r.qtyKgActual.toString()}
                          </td>
                          <td className="py-2 pr-4 tabular-nums">{r.qtyM2.toString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-col gap-1.5 sm:max-w-md">
                  <Label>Override reason (only for a curing/held roll)</Label>
                  <Input name="overrideReason" placeholder="optional" />
                </div>
                <div>
                  <Button type="submit">Reserve selected</Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      ) : null}

      {canWrite && canAllocate && shippable.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Dispatch against this order</CardTitle>
            <CardDescription>
              Creates a dispatch note from the reserved rolls and advances fulfilment.
              Raise the GST invoice from the dispatch note.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={fulfilSOAction} className="flex flex-col gap-3">
              <input type="hidden" name="soId" value={so.id} />
              <div className="max-h-72 overflow-y-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-2 pl-3 pr-4 font-medium"></th>
                      <th className="py-2 pr-4 font-medium">Roll</th>
                      <th className="py-2 pr-4 font-medium">SKU</th>
                      <th className="py-2 pr-4 font-medium">kg</th>
                      <th className="py-2 pr-4 font-medium">m²</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shippable.map((a) => (
                      <tr key={a.id} className="border-b last:border-0">
                        <td className="py-2 pl-3 pr-4">
                          <input
                            type="checkbox"
                            name="rollIds"
                            value={a.rollId}
                            className="h-4 w-4"
                          />
                        </td>
                        <td className="py-2 pr-4 font-mono text-xs">{a.roll.rollNo}</td>
                        <td className="py-2 pr-4">{a.roll.item.code}</td>
                        <td className="py-2 pr-4 tabular-nums">
                          {a.roll.qtyKgActual.toString()}
                        </td>
                        <td className="py-2 pr-4 tabular-nums">
                          {a.roll.qtyM2.toString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="flex flex-col gap-1.5">
                  <Label>Transporter</Label>
                  <Input name="transporter" placeholder="optional" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Vehicle no</Label>
                  <Input name="vehicleNo" placeholder="optional" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>LR no</Label>
                  <Input name="lrNo" placeholder="optional" />
                </div>
              </div>
              <div>
                <Button type="submit">Create dispatch note</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {so.dispatchNotes.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Shipments</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <ul className="flex flex-col gap-1">
              {so.dispatchNotes.map((dn) => (
                <li key={dn.id} className="flex items-center justify-between">
                  <Link
                    href={`/dispatch/${dn.id}`}
                    className="font-mono text-xs underline"
                  >
                    {dn.docNo}
                  </Link>
                  <span className="text-muted-foreground">{dn.status}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {canWrite && so.status !== "CANCELLED" && so.status !== "FULFILLED" ? (
        <form action={cancelSOAction}>
          <input type="hidden" name="soId" value={so.id} />
          <Button type="submit" variant="destructive" size="sm">
            Cancel order
          </Button>
          <p className="mt-1 text-xs text-muted-foreground">
            Releases still-reserved rolls back to stock and keeps the order number.
            Existing shipments are untouched.
          </p>
        </form>
      ) : null}
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-lg font-semibold tabular-nums">{value}</span>
    </div>
  );
}
