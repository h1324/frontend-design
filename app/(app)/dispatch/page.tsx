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
import { PageHeader } from "@/components/ui/page-header";
import { StateBadge } from "@/components/ui/state-badge";
import { createDispatchAction } from "./actions";

const selectClass =
  "h-10 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export default async function DispatchPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const actor = requireActor(await auth());
  requireAccess(actor, "DISPATCH", "read");
  const canWrite = can(actor.role, "DISPATCH", "write");

  const now = new Date();
  const [customers, availableRolls, notes] = await Promise.all([
    prisma.customer.findMany({
      where: { companyId: actor.companyId, isActive: true },
      orderBy: { name: "asc" },
      include: { shipTos: { orderBy: { label: "asc" } } },
    }),
    prisma.roll.findMany({
      where: {
        companyId: actor.companyId,
        state: "AVAILABLE",
        OR: [{ agingReadyDate: null }, { agingReadyDate: { lte: now } }],
      },
      orderBy: { rollNo: "asc" },
      take: 200,
      include: { item: true },
    }),
    prisma.dispatchNote.findMany({
      where: { companyId: actor.companyId },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { customer: true, invoice: true },
    }),
  ]);

  const shipTos = customers.flatMap((c) =>
    c.shipTos.map((s) => ({
      id: s.id,
      label: `${c.name} — ${s.label} (state ${s.gstStateCode})`,
    })),
  );

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 px-5 py-8 lg:px-8">
      <PageHeader
        eyebrow="Dispatch"
        title="Dispatch & invoice"
        description="Pick reserved rolls, raise the tax invoice, and generate the e-way bill & IRN."
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {canWrite ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">New dispatch</CardTitle>
            <CardDescription>
              Pick available (aged) rolls for a ship-to. GST is determined by the ship-to
              state when you invoice.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {shipTos.length === 0 || availableRolls.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {shipTos.length === 0
                  ? "Add a customer with a ship-to address first."
                  : "No available (aged) rolls to dispatch — check the aging queue."}
              </p>
            ) : (
              <form action={createDispatchAction} className="flex flex-col gap-4">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="flex flex-col gap-1.5 sm:col-span-2">
                    <Label>Ship-to</Label>
                    <select name="shipToId" required className={selectClass}>
                      {shipTos.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>Transporter</Label>
                    <Input name="transporter" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>Vehicle no</Label>
                    <Input name="vehicleNo" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>LR no</Label>
                    <Input name="lrNo" />
                  </div>
                </div>

                <div className="rounded-md border">
                  <div className="border-b px-3 py-2 text-sm font-medium">
                    Available rolls ({availableRolls.length})
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    <table className="w-full text-sm">
                      <tbody>
                        {availableRolls.map((r) => (
                          <tr key={r.id} className="border-b last:border-0">
                            <td className="py-1.5 pl-3 pr-2">
                              <label className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  name="rollIds"
                                  value={r.id}
                                  className="h-4 w-4"
                                />
                                <span className="font-mono text-xs">{r.rollNo}</span>
                              </label>
                            </td>
                            <td className="py-1.5 pr-2 text-muted-foreground">
                              {r.item.code}
                            </td>
                            <td className="py-1.5 pr-2 tabular-nums">
                              {r.qtyM2.toString()} m²
                            </td>
                            <td className="py-1.5 pr-3 tabular-nums text-muted-foreground">
                              {r.qtyKgActual.toString()} kg
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="flex items-end gap-3">
                  <div className="flex flex-1 flex-col gap-1.5">
                    <Label>
                      Early-release override reason (only if picking curing stock)
                    </Label>
                    <Input
                      name="overrideReason"
                      placeholder="leave blank for normal dispatch"
                    />
                  </div>
                  <Button type="submit">Create dispatch</Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent dispatches</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">DN no</th>
                <th className="py-2 pr-4 font-medium">Customer</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">Invoice</th>
                <th className="py-2 pr-4 font-medium">Total</th>
                <th className="py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {notes.map((n) => (
                <tr key={n.id} className="border-b last:border-0">
                  <td className="data py-2 pr-4 text-xs">{n.docNo}</td>
                  <td className="py-2 pr-4">{n.customer.name}</td>
                  <td className="py-2 pr-4">
                    <StateBadge value={n.status} />
                  </td>
                  <td className="data py-2 pr-4 text-xs text-muted-foreground">
                    {n.invoice?.docNo ?? "—"}
                  </td>
                  <td className="py-2 pr-4 tabular-nums">
                    {n.invoice ? formatPaise(n.invoice.totalPaise) : "—"}
                  </td>
                  <td className="py-2">
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/dispatch/${n.id}`}>Open</Link>
                    </Button>
                  </td>
                </tr>
              ))}
              {notes.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-muted-foreground">
                    No dispatches yet.
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
