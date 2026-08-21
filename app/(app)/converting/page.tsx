import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { StateBadge } from "@/components/ui/state-badge";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { requireActor, requireAccess, can } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { openConvertingAction } from "./actions";

const selectClass =
  "h-10 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const OPERATIONS = ["SLITTING", "LAMINATION", "BAG_MAKING"] as const;

export default async function ConvertingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const actor = requireActor(await auth());
  requireAccess(actor, "PRODUCTION", "read");
  const canWrite = can(actor.role, "PRODUCTION", "write");

  const where = { companyId: actor.companyId };
  const [machines, shifts, operators, items, orders] = await Promise.all([
    prisma.machine.findMany({
      where: { ...where, isActive: true },
      orderBy: { code: "asc" },
    }),
    prisma.shift.findMany({
      where: { ...where, isActive: true },
      orderBy: { code: "asc" },
    }),
    prisma.operator.findMany({
      where: { ...where, isActive: true },
      orderBy: { code: "asc" },
    }),
    prisma.item.findMany({
      where: { ...where, isActive: true, type: { in: ["FINISHED_GOOD", "WIP_ROLL"] } },
      orderBy: { code: "asc" },
    }),
    prisma.convertingOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        machine: true,
        targetItem: true,
        _count: { select: { inputs: true, children: true } },
      },
    }),
  ]);
  const ready = machines.length && shifts.length && operators.length && items.length;

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 px-5 py-8 lg:px-8">
      <PageHeader
        eyebrow="Production"
        title="Converting"
        description="Lamination, slitting and bag-making — parent rolls in, child rolls out, full genealogy."
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {canWrite ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Open a converting order</CardTitle>
            <CardDescription>
              Lamination bonds sheets (children re-cure); slitting/bag-making cut without
              re-curing. Pick the parent rolls and record the children when you close it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {ready ? (
              <form
                action={openConvertingAction}
                className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
              >
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">Operation</span>
                  <select name="operation" required className={selectClass}>
                    {OPERATIONS.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">Machine</span>
                  <select name="machineId" required className={selectClass}>
                    {machines.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.code}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">Shift</span>
                  <select name="shiftId" required className={selectClass}>
                    {shifts.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.code}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">Operator</span>
                  <select name="operatorId" required className={selectClass}>
                    {operators.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.code}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">Target SKU</span>
                  <select name="targetItemId" required className={selectClass}>
                    {items.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.code}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2 lg:col-span-5">
                  <Button type="submit">Open order</Button>
                </div>
              </form>
            ) : (
              <p className="text-sm text-muted-foreground">
                Set up machines, shifts, operators and a finished-good SKU first.
              </p>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent orders</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">CV no</th>
                <th className="py-2 pr-4 font-medium">Operation</th>
                <th className="py-2 pr-4 font-medium">SKU</th>
                <th className="py-2 pr-4 font-medium">Parents → children</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-b last:border-0">
                  <td className="py-2 pr-4 font-mono text-xs">{o.docNo}</td>
                  <td className="py-2 pr-4">{o.operation}</td>
                  <td className="py-2 pr-4">{o.targetItem.code}</td>
                  <td className="py-2 pr-4 tabular-nums">
                    {o._count.inputs} → {o._count.children}
                  </td>
                  <td className="py-2 pr-4">
                    <StateBadge value={o.status} />
                  </td>
                  <td className="py-2">
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/converting/${o.id}`}>Open</Link>
                    </Button>
                  </td>
                </tr>
              ))}
              {orders.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-muted-foreground">
                    No converting orders yet.
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
