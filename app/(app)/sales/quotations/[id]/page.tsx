import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { requireActor, requireAccess, can } from "@/lib/rbac";
import { formatPaise } from "@/lib/gst";
import {
  quoteMargin,
  discountedRatePaise,
  isBelowMarginFloor,
  DEFAULT_MARGIN_FLOOR_PCT,
} from "@/lib/pricing";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  sendQuotationAction,
  winQuotationAction,
  loseQuotationAction,
  cancelQuotationAction,
  overrideMarginAction,
  convertQuotationAction,
} from "../actions";

export default async function QuotationDetailPage({
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

  const q = await prisma.quotation.findFirst({
    where: { id, companyId: actor.companyId },
    include: {
      customer: true,
      shipTo: true,
      convertedSo: true,
      lines: { include: { item: true } },
    },
  });
  if (!q) notFound();

  const discountPct = q.orderDiscountPct.toString();
  const rows = q.lines.map((l) => {
    const net = discountedRatePaise(l.ratePaise, discountPct);
    const { marginPct } = quoteMargin(net, l.unitCostPaise);
    const below = isBelowMarginFloor(l.ratePaise, l.unitCostPaise, discountPct);
    const costKnown = l.unitCostPaise > 0n;
    return { line: l, net, marginPct, below, costKnown };
  });
  const anyBelowFloor = rows.some((r) => r.below);

  const subtotalPaise = q.lines.reduce(
    (s, l) =>
      s + BigInt(Math.round(Number(l.qtyQuoted.toString()) * Number(l.ratePaise))),
    0n,
  );
  const discountPaise = BigInt(
    Math.round((Number(subtotalPaise) * Number(discountPct)) / 100),
  );
  const netSubtotalPaise = subtotalPaise - discountPaise;

  const isOpen = q.status === "DRAFT" || q.status === "SENT";

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-6 py-12">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">
            EPE Foam ERP · Sales
          </p>
          <h1 className="mt-1 font-mono text-xl font-semibold tracking-tight">
            {q.docNo}
          </h1>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link href="/sales/quotations">All quotations</Link>
        </Button>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {q.customer.name} · <span className="font-normal">{q.status}</span>
          </CardTitle>
          <CardDescription>
            {q.shipTo ? `Ship-to: ${q.shipTo.label} · ` : ""}
            Enquiry {q.enquiryDate.toLocaleDateString("en-GB")} · valid until{" "}
            {q.validUntil.toLocaleDateString("en-GB")}
            {q.marginOverrideById ? " · margin override on file" : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Item</th>
                <th className="py-2 pr-4 font-medium">Qty</th>
                <th className="py-2 pr-4 font-medium">Rate</th>
                <th className="py-2 pr-4 font-medium">Net rate</th>
                <th className="py-2 pr-4 font-medium">GST %</th>
                <th className="py-2 font-medium">Margin</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ line: l, net, marginPct, below, costKnown }) => (
                <tr key={l.id} className="border-b last:border-0">
                  <td className="py-2 pr-4">
                    {l.item.code} — {l.item.name}
                  </td>
                  <td className="py-2 pr-4 tabular-nums">
                    {l.qtyQuoted.toString()} {l.uom}
                  </td>
                  <td className="py-2 pr-4 tabular-nums">{formatPaise(l.ratePaise)}</td>
                  <td className="py-2 pr-4 tabular-nums text-muted-foreground">
                    {formatPaise(net)}
                  </td>
                  <td className="py-2 pr-4 tabular-nums">{l.gstRatePct.toString()}</td>
                  <td
                    className={`py-2 tabular-nums ${
                      !costKnown
                        ? "text-muted-foreground"
                        : below
                          ? "text-destructive"
                          : "text-foreground"
                    }`}
                  >
                    {costKnown ? `${marginPct ?? "—"}%${below ? " ⚠" : ""}` : "no cost"}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="text-muted-foreground">
                <td colSpan={4} className="py-2 pr-4 text-right">
                  Subtotal
                </td>
                <td colSpan={2} className="py-2 tabular-nums">
                  {formatPaise(subtotalPaise)}
                </td>
              </tr>
              {Number(discountPct) > 0 ? (
                <tr className="text-muted-foreground">
                  <td colSpan={4} className="py-1 pr-4 text-right">
                    Order discount ({discountPct}%)
                  </td>
                  <td colSpan={2} className="py-1 tabular-nums">
                    −{formatPaise(discountPaise)}
                  </td>
                </tr>
              ) : null}
              <tr className="font-medium">
                <td colSpan={4} className="py-2 pr-4 text-right">
                  Net taxable
                </td>
                <td colSpan={2} className="py-2 tabular-nums">
                  {formatPaise(netSubtotalPaise)}
                </td>
              </tr>
            </tfoot>
          </table>
        </CardContent>
      </Card>

      {anyBelowFloor && isOpen && !q.marginOverrideById ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-destructive">
              Below margin floor
            </CardTitle>
            <CardDescription>
              One or more lines fall below the {DEFAULT_MARGIN_FLOOR_PCT}% margin floor
              (after the order discount). Sending or winning needs an ACCOUNTS/ADMIN
              override with a reason.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {canOverride ? (
              <form action={overrideMarginAction} className="flex gap-2">
                <input type="hidden" name="id" value={q.id} />
                <Input name="reason" placeholder="Override reason" required />
                <Button type="submit" variant="secondary" size="sm">
                  Log override
                </Button>
              </form>
            ) : (
              <p className="text-xs text-muted-foreground">
                Ask ACCOUNTS or ADMIN to log the override.
              </p>
            )}
          </CardContent>
        </Card>
      ) : null}

      {q.convertedSo ? (
        <Card>
          <CardContent className="flex items-center justify-between py-4">
            <p className="text-sm">
              Converted to sales order{" "}
              <span className="font-mono">{q.convertedSo.docNo}</span>.
            </p>
            <Button asChild variant="ghost" size="sm">
              <Link href={`/sales/orders/${q.convertedSo.id}`}>Open SO</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {canWrite ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Actions</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            {q.status === "DRAFT" ? (
              <form action={sendQuotationAction}>
                <input type="hidden" name="id" value={q.id} />
                <Button type="submit" size="sm">
                  Mark sent
                </Button>
              </form>
            ) : null}
            {isOpen ? (
              <form action={winQuotationAction}>
                <input type="hidden" name="id" value={q.id} />
                <Button type="submit" size="sm">
                  Mark won
                </Button>
              </form>
            ) : null}
            {q.status === "WON" && !q.convertedSoId ? (
              <form action={convertQuotationAction}>
                <input type="hidden" name="id" value={q.id} />
                <Button type="submit" size="sm">
                  Convert to sales order
                </Button>
              </form>
            ) : null}
            {isOpen ? (
              <form action={loseQuotationAction} className="flex gap-2">
                <input type="hidden" name="id" value={q.id} />
                <Input name="reason" placeholder="Lost reason" className="h-9 w-48" />
                <Button type="submit" size="sm" variant="secondary">
                  Mark lost
                </Button>
              </form>
            ) : null}
            {q.status !== "CANCELLED" && !q.convertedSoId ? (
              <form action={cancelQuotationAction}>
                <input type="hidden" name="id" value={q.id} />
                <Button type="submit" size="sm" variant="ghost">
                  Cancel
                </Button>
              </form>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </main>
  );
}
