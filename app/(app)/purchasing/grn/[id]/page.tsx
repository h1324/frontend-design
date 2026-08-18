import Link from "next/link";
import { notFound } from "next/navigation";
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
import { cancelGRNAction, addChargesAction } from "../actions";

const selectClass =
  "h-10 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const CHARGE_TYPES = ["FREIGHT", "DUTY", "INSURANCE", "CLEARING", "OTHER"] as const;
const BASES = ["VALUE", "QTY", "WEIGHT"] as const;
const CHARGE_ROWS = 3;

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-GB");
}

const qcTone: Record<string, string> = {
  PENDING: "text-foreground",
  PASSED: "text-muted-foreground",
  FAILED: "text-destructive",
  PARTIAL: "text-foreground",
};

export default async function GrnDetailPage({
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

  const grn = await prisma.goodsReceipt.findFirst({
    where: { id, companyId: actor.companyId },
    include: {
      supplier: true,
      po: true,
      lines: { include: { item: true, location: true } },
      charges: true,
    },
  });
  if (!grn) notFound();

  const cancellable =
    canWrite &&
    grn.status === "POSTED" &&
    grn.lines.every((l) => l.qcStatus === "PENDING");

  const costed = grn.lines.some((l) => l.landedUnitCostPaise != null);
  const canCost =
    canWrite &&
    grn.status === "POSTED" &&
    !costed &&
    grn.lines.every((l) => l.ratePaise != null);

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-6 py-12">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">
            EPE Foam ERP · Purchasing
          </p>
          <h1 className="mt-1 font-mono text-2xl font-semibold tracking-tight">
            {grn.docNo}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {grn.supplier?.name ?? "no supplier"} · received {fmtDate(grn.receivedAt)}
            {grn.po ? ` · PO ${grn.po.docNo}` : ""}
            {grn.docketNo ? ` · docket ${grn.docketNo}` : ""}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className="rounded-full border px-3 py-1 text-xs font-medium">
            {grn.status}
          </span>
          <Button asChild variant="ghost" size="sm">
            <Link href="/purchasing/grn">All receipts</Link>
          </Button>
        </div>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Lines ({grn.lines.length})</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Item</th>
                <th className="py-2 pr-4 font-medium">Received</th>
                <th className="py-2 pr-4 font-medium">Location</th>
                <th className="py-2 pr-4 font-medium">Rate</th>
                <th className="py-2 pr-4 font-medium">Landed/unit</th>
                <th className="py-2 font-medium">QC</th>
              </tr>
            </thead>
            <tbody>
              {grn.lines.map((l) => (
                <tr key={l.id} className="border-b last:border-0">
                  <td className="py-2 pr-4">{l.item.code}</td>
                  <td className="py-2 pr-4 tabular-nums">{l.qtyReceived.toString()}</td>
                  <td className="py-2 pr-4">
                    {l.location.code}
                    {l.location.isQcHold ? (
                      <span className="ml-1 text-xs text-muted-foreground">(hold)</span>
                    ) : null}
                  </td>
                  <td className="py-2 pr-4 tabular-nums">
                    {l.ratePaise != null ? formatPaise(l.ratePaise) : "—"}
                  </td>
                  <td className="py-2 pr-4 tabular-nums">
                    {l.landedUnitCostPaise != null
                      ? formatPaise(l.landedUnitCostPaise)
                      : "—"}
                  </td>
                  <td className={`py-2 ${qcTone[l.qcStatus] ?? ""}`}>{l.qcStatus}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {grn.charges.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Charges</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <ul className="flex flex-col gap-1">
              {grn.charges.map((c) => (
                <li key={c.id} className="flex justify-between">
                  <span>
                    {c.chargeType}{" "}
                    <span className="text-muted-foreground">by {c.apportionBasis}</span>
                  </span>
                  <span className="tabular-nums">{formatPaise(c.amountPaise)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {canCost ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Finalize landed cost</CardTitle>
            <CardDescription>
              Add inbound charges (freight/duty/…) to apportion across the lines, then
              post. This sets each line&apos;s landed unit cost and rolls it into the
              item&apos;s moving average. One-shot — recompute by cancelling and
              re-receiving.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={addChargesAction} className="flex flex-col gap-4">
              <input type="hidden" name="grnId" value={grn.id} />
              <div className="rounded-md border">
                <div className="grid grid-cols-[1fr_140px_120px] gap-2 border-b px-3 py-2 text-xs font-medium text-muted-foreground">
                  <span>Charge</span>
                  <span className="text-right">Amount (₹)</span>
                  <span>Apportion by</span>
                </div>
                {Array.from({ length: CHARGE_ROWS }).map((_, i) => (
                  <div
                    key={i}
                    className="grid grid-cols-[1fr_140px_120px] items-center gap-2 border-b px-3 py-1.5 last:border-0"
                  >
                    <select name="chargeType" className={selectClass}>
                      {CHARGE_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                    <Input
                      name="chargeAmount"
                      inputMode="decimal"
                      placeholder="0.00"
                      className="text-right"
                    />
                    <select
                      name="chargeBasis"
                      className={selectClass}
                      defaultValue="VALUE"
                    >
                      {BASES.map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Leave charges blank to cost at the supplier rate only. Excludes
                recoverable GST (input tax credit is not a cost).
              </p>
              <div>
                <Button type="submit">Post landed cost</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : costed ? (
        <p className="text-xs text-muted-foreground">
          Landed cost posted — line costs above feed the item moving average and stock
          valuation.
        </p>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Received stock sits on QC hold and is not issuable until QC (S16) passes it.
      </p>

      {cancellable ? (
        <form action={cancelGRNAction}>
          <input type="hidden" name="grnId" value={grn.id} />
          <Button type="submit" variant="destructive" size="sm">
            Cancel receipt
          </Button>
          <p className="mt-1 text-xs text-muted-foreground">
            Reverses the stock and restores the PO balance. Blocked once QC has actioned a
            line.
          </p>
        </form>
      ) : null}
    </main>
  );
}
