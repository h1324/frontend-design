import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { requireActor, requireAccess, can } from "@/lib/rbac";
import { formatPaise } from "@/lib/gst";
import {
  customerAgeing,
  ageingBucketKey,
  AGEING_BUCKETS,
  AGEING_BUCKET_LABEL,
} from "@/lib/receivables";
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
import { recordReceiptAction, cancelReceiptAction } from "../actions";

const selectClass =
  "h-10 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const MODES = ["BANK", "CASH", "UPI", "CHEQUE", "ADJUSTMENT"] as const;

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-GB"); // DD/MM/YYYY (Indian convention)
}

export default async function ReceivablesCustomerPage({
  params,
  searchParams,
}: {
  params: Promise<{ customerId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { customerId } = await params;
  const { error } = await searchParams;
  const actor = requireActor(await auth());
  requireAccess(actor, "RECEIVABLES", "read");
  const canWrite = can(actor.role, "RECEIVABLES", "write");

  const customer = await prisma.customer.findFirst({
    where: { id: customerId, companyId: actor.companyId },
  });
  if (!customer) notFound();

  const asOf = new Date();
  const [ageing, invoices, receipts] = await Promise.all([
    customerAgeing(prisma, actor.companyId, customerId, asOf),
    prisma.invoice.findMany({
      where: { companyId: actor.companyId, customerId, status: "ISSUED" },
      orderBy: { invoiceDate: "asc" },
    }),
    prisma.receipt.findMany({
      where: { companyId: actor.companyId, customerId },
      orderBy: { createdAt: "desc" },
      include: { allocations: { include: { invoice: true } } },
    }),
  ]);

  const openInvoices = invoices
    .map((inv) => {
      const due =
        inv.dueDate ??
        new Date(inv.invoiceDate.getTime() + (customer.creditDays ?? 0) * 86_400_000);
      return { inv, due, remaining: inv.totalPaise - inv.amountSettledPaise };
    })
    .filter((r) => r.remaining > 0n);

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-6 py-12">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">
            EPE Foam ERP · Receivables
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{customer.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {customer.code} · tier {customer.tier} · {customer.creditDays} credit days
          </p>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link href="/receivables">All customers</Link>
        </Button>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ageing</CardTitle>
          <CardDescription>
            Unsettled invoice balances by due date (IST). On-account credit is a receipt
            not yet tied to an invoice.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
          {AGEING_BUCKETS.map((b) => (
            <Metric
              key={b}
              label={AGEING_BUCKET_LABEL[b]}
              value={formatPaise(ageing.buckets[b])}
            />
          ))}
          <Metric label="On account" value={formatPaise(ageing.onAccountPaise)} />
          <Metric label="Outstanding" value={formatPaise(ageing.outstandingPaise)} />
        </CardContent>
      </Card>

      {canWrite ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Record a receipt</CardTitle>
            <CardDescription>
              Payment received from this customer. Allocate it to open invoices below; any
              unallocated amount stays on account. This is a credit-control record, not a
              ledger posting.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={recordReceiptAction} className="flex flex-col gap-4">
              <input type="hidden" name="customerId" value={customer.id} />
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="flex flex-col gap-1.5">
                  <Label>Amount (₹)</Label>
                  <Input name="amount" inputMode="decimal" required placeholder="0.00" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Mode</Label>
                  <select name="mode" className={selectClass}>
                    {MODES.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Reference</Label>
                  <Input name="reference" placeholder="cheque / UTR / UPI ref" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Received on</Label>
                  <Input type="date" name="receivedAt" />
                </div>
              </div>

              {openInvoices.length > 0 ? (
                <div className="rounded-md border">
                  <div className="grid grid-cols-[1fr_120px_140px_140px] gap-2 border-b px-3 py-2 text-xs font-medium text-muted-foreground">
                    <span>Invoice</span>
                    <span className="text-right">Total</span>
                    <span className="text-right">Remaining</span>
                    <span className="text-right">Allocate (₹)</span>
                  </div>
                  {openInvoices.map(({ inv, remaining }) => (
                    <div
                      key={inv.id}
                      className="grid grid-cols-[1fr_120px_140px_140px] items-center gap-2 border-b px-3 py-1.5 last:border-0"
                    >
                      <span className="font-mono text-xs">{inv.docNo}</span>
                      <input type="hidden" name="allocInvoiceId" value={inv.id} />
                      <span className="text-right tabular-nums">
                        {formatPaise(inv.totalPaise)}
                      </span>
                      <span className="text-right tabular-nums">
                        {formatPaise(remaining)}
                      </span>
                      <Input
                        name="allocAmount"
                        inputMode="decimal"
                        placeholder="0.00"
                        className="text-right"
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No open invoices — the receipt will sit on account.
                </p>
              )}

              <div className="flex justify-end">
                <Button type="submit">Record receipt</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Open invoices</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {openInvoices.length === 0 ? (
            <p className="text-sm text-muted-foreground">No open invoices.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Invoice</th>
                  <th className="py-2 pr-4 font-medium">Date</th>
                  <th className="py-2 pr-4 font-medium">Due</th>
                  <th className="py-2 pr-4 text-right font-medium">Total</th>
                  <th className="py-2 pr-4 text-right font-medium">Settled</th>
                  <th className="py-2 pr-4 text-right font-medium">Remaining</th>
                  <th className="py-2 font-medium">Bucket</th>
                </tr>
              </thead>
              <tbody>
                {openInvoices.map(({ inv, due, remaining }) => (
                  <tr key={inv.id} className="border-b last:border-0">
                    <td className="py-2 pr-4 font-mono text-xs">{inv.docNo}</td>
                    <td className="py-2 pr-4">{fmtDate(inv.invoiceDate)}</td>
                    <td className="py-2 pr-4">{fmtDate(due)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {formatPaise(inv.totalPaise)}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {formatPaise(inv.amountSettledPaise)}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {formatPaise(remaining)}
                    </td>
                    <td className="py-2">
                      {AGEING_BUCKET_LABEL[ageingBucketKey(due, asOf)]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Receipts</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {receipts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No receipts recorded.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Receipt</th>
                  <th className="py-2 pr-4 font-medium">Date</th>
                  <th className="py-2 pr-4 font-medium">Mode</th>
                  <th className="py-2 pr-4 text-right font-medium">Amount</th>
                  <th className="py-2 pr-4 font-medium">Allocated to</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {receipts.map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="py-2 pr-4 font-mono text-xs">{r.docNo}</td>
                    <td className="py-2 pr-4">{fmtDate(r.receivedAt)}</td>
                    <td className="py-2 pr-4">{r.mode}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {formatPaise(r.amountPaise)}
                    </td>
                    <td className="py-2 pr-4 text-xs text-muted-foreground">
                      {r.allocations.length === 0
                        ? "on account"
                        : r.allocations
                            .map(
                              (a) => `${a.invoice.docNo} ${formatPaise(a.amountPaise)}`,
                            )
                            .join(", ")}
                    </td>
                    <td className="py-2 pr-4">
                      {r.status === "POSTED" ? (
                        r.status
                      ) : (
                        <span className="text-muted-foreground">{r.status}</span>
                      )}
                    </td>
                    <td className="py-2 text-right">
                      {canWrite && r.status === "POSTED" ? (
                        <form action={cancelReceiptAction}>
                          <input type="hidden" name="customerId" value={customer.id} />
                          <input type="hidden" name="receiptId" value={r.id} />
                          <Button type="submit" variant="ghost" size="sm">
                            Cancel
                          </Button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-base font-semibold tabular-nums">{value}</span>
    </div>
  );
}
