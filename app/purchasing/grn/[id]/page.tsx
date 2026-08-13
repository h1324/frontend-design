import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { requireActor, requireAccess, can } from "@/lib/rbac";
import { formatPaise } from "@/lib/gst";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cancelGRNAction } from "../actions";

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
    },
  });
  if (!grn) notFound();

  const cancellable =
    canWrite &&
    grn.status === "POSTED" &&
    grn.lines.every((l) => l.qcStatus === "PENDING");

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
                  <td className={`py-2 ${qcTone[l.qcStatus] ?? ""}`}>{l.qcStatus}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

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
