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
import { Label } from "@/components/ui/label";
import {
  generateInvoiceAction,
  cancelInvoiceAction,
  cancelDispatchAction,
  generateIrnAction,
  generateEwayBillAction,
  cancelIrnAction,
} from "../actions";
import { isEwayBillRequired, DEFAULT_THRESHOLDS } from "@/lib/einvoice/einvoice";

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-GB");
}

export default async function DispatchDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const actor = requireActor(await auth());
  requireAccess(actor, "DISPATCH", "read");
  const canWrite = can(actor.role, "DISPATCH", "write");

  const note = await prisma.dispatchNote.findFirst({
    where: { id, companyId: actor.companyId },
    include: {
      customer: true,
      shipTo: true,
      rolls: { include: { roll: { include: { item: true } } } },
      invoice: {
        include: {
          lines: { include: { item: true } },
          einvoiceLogs: { orderBy: { at: "desc" }, take: 5 },
        },
      },
    },
  });
  if (!note) notFound();

  // Distinct SKUs on the note (for the rate-entry form).
  const itemMap = new Map<string, { code: string; name: string; uomBase: string }>();
  for (const dr of note.rolls) {
    itemMap.set(dr.roll.itemId, {
      code: dr.roll.item.code,
      name: dr.roll.item.name,
      uomBase: dr.roll.item.uomBase,
    });
  }
  const items = [...itemMap.entries()];
  const inv = note.invoice;

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-6 py-12">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">
            EPE Foam ERP · Dispatch
          </p>
          <h1 className="mt-1 font-mono text-2xl font-semibold tracking-tight">
            {note.docNo}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {note.customer.name} · {note.shipTo.label} (state {note.shipTo.gstStateCode})
            · {note.transporter ?? "no transporter"}
            {note.vehicleNo ? ` · ${note.vehicleNo}` : ""}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className="rounded-full border px-3 py-1 text-xs font-medium">
            {note.status}
          </span>
          <Button asChild variant="ghost" size="sm">
            <Link href="/dispatch">All dispatches</Link>
          </Button>
        </div>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rolls ({note.rolls.length})</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Roll no</th>
                <th className="py-2 pr-4 font-medium">SKU</th>
                <th className="py-2 pr-4 font-medium">m²</th>
                <th className="py-2 pr-4 font-medium">kg</th>
                <th className="py-2 font-medium">State</th>
              </tr>
            </thead>
            <tbody>
              {note.rolls.map((dr) => (
                <tr key={dr.id} className="border-b last:border-0">
                  <td className="py-2 pr-4 font-mono text-xs">
                    <Link href={`/production/rolls/${dr.rollId}`} className="underline">
                      {dr.roll.rollNo}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">{dr.roll.item.code}</td>
                  <td className="py-2 pr-4 tabular-nums">{dr.roll.qtyM2.toString()}</td>
                  <td className="py-2 pr-4 tabular-nums">
                    {dr.roll.qtyKgActual.toString()}
                  </td>
                  <td className="py-2">{dr.roll.state}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {note.status === "OPEN" && canWrite ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Generate invoice</CardTitle>
            <CardDescription>
              Enter a rate per SKU (₹ per billed unit). Tax splits into CGST+SGST for an
              in-state ship-to, IGST otherwise; the total rounds to the nearest rupee.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={generateInvoiceAction} className="flex flex-col gap-3">
              <input type="hidden" name="noteId" value={note.id} />
              {items.map(([itemId, it]) => (
                <div key={itemId} className="flex items-end gap-3">
                  <div className="flex-1">
                    <p className="text-sm font-medium">{it.code}</p>
                    <p className="text-xs text-muted-foreground">{it.name}</p>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>Rate (₹ / {it.uomBase})</Label>
                    <Input
                      name={`rate_${itemId}`}
                      inputMode="decimal"
                      required
                      className="w-40"
                    />
                  </div>
                </div>
              ))}
              <div>
                <Button type="submit">Generate invoice</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {inv ? (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base">
                Invoice <span className="font-mono">{inv.docNo}</span>
              </CardTitle>
              <CardDescription>
                {fmtDate(inv.invoiceDate)} · place of supply: state{" "}
                {inv.placeOfSupplyStateCode} · {inv.status}
              </CardDescription>
            </div>
            <span className="rounded-full border px-3 py-1 text-xs font-medium">
              {inv.status}
            </span>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">SKU</th>
                    <th className="py-2 pr-3 font-medium">HSN</th>
                    <th className="py-2 pr-3 font-medium">kg</th>
                    <th className="py-2 pr-3 font-medium">m²</th>
                    <th className="py-2 pr-3 font-medium">Rate</th>
                    <th className="py-2 pr-3 font-medium">Taxable</th>
                    <th className="py-2 pr-3 font-medium">GST%</th>
                    <th className="py-2 pr-3 font-medium">CGST</th>
                    <th className="py-2 pr-3 font-medium">SGST</th>
                    <th className="py-2 font-medium">IGST</th>
                  </tr>
                </thead>
                <tbody>
                  {inv.lines.map((l) => (
                    <tr key={l.id} className="border-b last:border-0">
                      <td className="py-2 pr-3">{l.item.code}</td>
                      <td className="py-2 pr-3 font-mono text-xs">{l.hsnCode ?? "—"}</td>
                      <td className="py-2 pr-3 tabular-nums">{l.qtyKg.toString()}</td>
                      <td className="py-2 pr-3 tabular-nums">{l.qtyM2.toString()}</td>
                      <td className="py-2 pr-3 tabular-nums">
                        {formatPaise(l.ratePaise)}
                      </td>
                      <td className="py-2 pr-3 tabular-nums">
                        {formatPaise(l.taxableValuePaise)}
                      </td>
                      <td className="py-2 pr-3 tabular-nums">
                        {l.gstRatePct.toString()}
                      </td>
                      <td className="py-2 pr-3 tabular-nums">
                        {formatPaise(l.cgstPaise)}
                      </td>
                      <td className="py-2 pr-3 tabular-nums">
                        {formatPaise(l.sgstPaise)}
                      </td>
                      <td className="py-2 tabular-nums">{formatPaise(l.igstPaise)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="ml-auto flex w-full max-w-xs flex-col gap-1 text-sm">
              <Row label="Taxable" value={formatPaise(inv.taxableValuePaise)} />
              {inv.cgstPaise > 0n ? (
                <Row label="CGST" value={formatPaise(inv.cgstPaise)} />
              ) : null}
              {inv.sgstPaise > 0n ? (
                <Row label="SGST" value={formatPaise(inv.sgstPaise)} />
              ) : null}
              {inv.igstPaise > 0n ? (
                <Row label="IGST" value={formatPaise(inv.igstPaise)} />
              ) : null}
              <Row label="Round off" value={formatPaise(inv.roundOffPaise)} />
              <div className="mt-1 border-t pt-1">
                <Row label="Total" value={formatPaise(inv.totalPaise)} bold />
              </div>
            </div>

            <div className="flex flex-col gap-3 rounded-md border px-3 py-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">e-invoice &amp; e-way bill</span>
                <span className="text-xs text-muted-foreground">
                  status: {inv.einvoiceStatus}
                </span>
              </div>
              <div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                <span className="break-all">IRN: {inv.irn ?? "—"}</span>
                <span>Ack: {inv.ackNo ?? "—"}</span>
                <span>Signed QR: {inv.signedQr ? "present" : "—"}</span>
                <span>
                  EWB: {inv.ewbNo ?? "—"}
                  {inv.ewbValidTill ? ` (valid till ${fmtDate(inv.ewbValidTill)})` : ""}
                </span>
              </div>

              {canWrite && inv.status === "ISSUED" ? (
                <div className="flex flex-wrap items-end gap-3">
                  {!inv.irn && inv.einvoiceStatus !== "CANCELLED" ? (
                    <form action={generateIrnAction}>
                      <input type="hidden" name="noteId" value={note.id} />
                      <input type="hidden" name="invoiceId" value={inv.id} />
                      <Button type="submit" size="sm">
                        Generate IRN
                      </Button>
                    </form>
                  ) : null}

                  {inv.irn &&
                  !inv.ewbNo &&
                  isEwayBillRequired(inv.totalPaise, DEFAULT_THRESHOLDS) ? (
                    <form
                      action={generateEwayBillAction}
                      className="flex items-end gap-2"
                    >
                      <input type="hidden" name="noteId" value={note.id} />
                      <input type="hidden" name="invoiceId" value={inv.id} />
                      <div className="flex flex-col gap-1">
                        <Label className="text-xs">Distance (km)</Label>
                        <Input
                          name="distanceKm"
                          inputMode="numeric"
                          className="h-9 w-28"
                          placeholder="0"
                        />
                      </div>
                      <Button type="submit" size="sm" variant="secondary">
                        Generate e-way bill
                      </Button>
                    </form>
                  ) : null}

                  {inv.irn && inv.einvoiceStatus === "GENERATED" ? (
                    <form action={cancelIrnAction} className="flex items-end gap-2">
                      <input type="hidden" name="noteId" value={note.id} />
                      <input type="hidden" name="invoiceId" value={inv.id} />
                      <div className="flex flex-col gap-1">
                        <Label className="text-xs">Cancel reason</Label>
                        <Input
                          name="reason"
                          className="h-9 w-56"
                          placeholder="within 24h only"
                        />
                      </div>
                      <Button type="submit" size="sm" variant="destructive">
                        Cancel IRN
                      </Button>
                    </form>
                  ) : null}
                </div>
              ) : null}

              {inv.einvoiceLogs.length > 0 ? (
                <p className="text-xs text-muted-foreground">
                  Last: {inv.einvoiceLogs[0]!.action} · {inv.einvoiceLogs[0]!.provider} ·{" "}
                  {inv.einvoiceLogs[0]!.status}
                  {inv.einvoiceLogs[0]!.errorMessage
                    ? ` — ${inv.einvoiceLogs[0]!.errorMessage}`
                    : ""}
                </p>
              ) : null}
            </div>

            {canWrite && inv.status === "ISSUED" ? (
              <form action={cancelInvoiceAction}>
                <input type="hidden" name="noteId" value={note.id} />
                <input type="hidden" name="invoiceId" value={inv.id} />
                <Button type="submit" variant="destructive" size="sm">
                  Cancel invoice
                </Button>
                <p className="mt-1 text-xs text-muted-foreground">
                  Keeps the number, reverses the stock, returns the rolls to available.
                </p>
              </form>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {canWrite && note.status === "OPEN" ? (
        <form action={cancelDispatchAction}>
          <input type="hidden" name="noteId" value={note.id} />
          <Button type="submit" variant="destructive" size="sm">
            Cancel dispatch
          </Button>
          <p className="mt-1 text-xs text-muted-foreground">
            Releases the allocated rolls back to available. Nothing is deleted.
          </p>
        </form>
      ) : null}
    </main>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className={bold ? "font-semibold" : "text-muted-foreground"}>{label}</span>
      <span className={`tabular-nums ${bold ? "font-semibold" : ""}`}>{value}</span>
    </div>
  );
}
