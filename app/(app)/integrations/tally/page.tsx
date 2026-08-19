import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { requireActor, requireAccess } from "@/lib/rbac";
import { pendingInvoiceExports } from "@/lib/tally/tally-sync";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StateBadge } from "@/components/ui/state-badge";
import { syncInvoicesOutAction, importReceiptsAction, retrySyncAction } from "./actions";

function fmtDateTime(d: Date): string {
  return d.toLocaleString("en-GB");
}

export default async function TallyIntegrationPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const actor = requireActor(await auth());
  requireAccess(actor, "RECEIVABLES", "read");
  const canWrite = actor.role === "ACCOUNTS" || actor.role === "ADMIN";

  const [pending, recent, ackOut, imported, failed] = await Promise.all([
    pendingInvoiceExports(prisma, actor.companyId),
    prisma.tallySync.findMany({
      where: { companyId: actor.companyId },
      orderBy: { at: "desc" },
      take: 50,
    }),
    prisma.tallySync.count({
      where: { companyId: actor.companyId, entityType: "INVOICE", status: "ACK" },
    }),
    prisma.tallySync.count({
      where: { companyId: actor.companyId, entityType: "RECEIPT", status: "ACK" },
    }),
    prisma.tallySync.count({ where: { companyId: actor.companyId, status: "ERROR" } }),
  ]);

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 px-5 py-8 lg:px-8">
      <PageHeader
        eyebrow="Integrations"
        title="Tally sync"
        description="Invoices export out to Tally sales vouchers; receipts import in. TallyPrime stays the book of record."
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Status</CardTitle>
          <CardDescription>
            Invoices export out to Tally sales vouchers; receipts import in as
            credit-control receipts. TallyPrime stays the book of record — this only
            marshals documents across the boundary. (MOCK connector until a live Tally
            endpoint is configured.)
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Invoices to export" value={String(pending.length)} />
            <Stat label="Invoices synced" value={String(ackOut)} />
            <Stat label="Receipts imported" value={String(imported)} />
            <Stat label="Failed" value={String(failed)} />
          </div>
          {canWrite ? (
            <div className="flex flex-wrap gap-3">
              <form action={syncInvoicesOutAction}>
                <Button type="submit" size="sm">
                  Sync invoices out ({pending.length})
                </Button>
              </form>
              <form action={importReceiptsAction}>
                <Button type="submit" size="sm" variant="secondary">
                  Import receipts now
                </Button>
              </form>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              ACCOUNTS or ADMIN can run the sync.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent sync activity</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">When</th>
                <th className="py-2 pr-4 font-medium">Entity</th>
                <th className="py-2 pr-4 font-medium">Dir</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">Ref / error</th>
                <th className="py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="py-2 pr-4 text-xs text-muted-foreground">
                    {fmtDateTime(r.at)}
                  </td>
                  <td className="py-2 pr-4">{r.entityType}</td>
                  <td className="py-2 pr-4">{r.direction}</td>
                  <td className="py-2 pr-4">
                    <StateBadge value={r.status} />
                  </td>
                  <td className="data py-2 pr-4 text-xs">
                    {r.status === "ERROR" ? (r.lastError ?? "—") : (r.externalRef ?? "—")}
                  </td>
                  <td className="py-2">
                    {canWrite && r.status === "ERROR" && r.entityType === "INVOICE" ? (
                      <form action={retrySyncAction}>
                        <input type="hidden" name="syncId" value={r.id} />
                        <Button type="submit" variant="ghost" size="sm">
                          Retry
                        </Button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
              {recent.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-muted-foreground">
                    No sync activity yet.
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-lg font-semibold tabular-nums">{value}</span>
    </div>
  );
}
