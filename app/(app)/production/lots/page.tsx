import Link from "next/link";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { openLotAction } from "../actions";

const selectClass =
  "h-10 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const statusLabel: Record<string, string> = {
  OPEN: "Open",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
};

export default async function LotsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const actor = requireActor(await auth());
  requireAccess(actor, "PRODUCTION", "read");
  const canWrite = can(actor.role, "PRODUCTION", "write");

  const where = { companyId: actor.companyId };
  const [machines, shifts, operators, items, lots] = await Promise.all([
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
    prisma.lot.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { machine: true, shift: true, targetItem: true },
    }),
  ]);

  const ready = machines.length && shifts.length && operators.length && items.length;

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-6 py-12">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">
            EPE Foam ERP · Production
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Production lots</h1>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link href="/">Home</Link>
        </Button>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {canWrite ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Open a lot</CardTitle>
            <CardDescription>
              One continuous extrusion run — one machine, one shift, one SKU. Record
              output, downtime and close it at shift end.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {ready ? (
              <form
                action={openLotAction}
                className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
              >
                <div className="flex flex-col gap-1.5">
                  <Label>Machine</Label>
                  <select name="machineId" required className={selectClass}>
                    {machines.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.code} — {m.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Shift</Label>
                  <select name="shiftId" required className={selectClass}>
                    {shifts.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.code} — {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Operator</Label>
                  <select name="operatorId" required className={selectClass}>
                    {operators.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.code} — {o.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Target SKU</Label>
                  <select name="targetItemId" required className={selectClass}>
                    {items.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.code} — {i.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Production date (optional)</Label>
                  <Input type="date" name="productionDate" />
                </div>
                <div className="flex items-end">
                  <Button type="submit">Open lot</Button>
                </div>
              </form>
            ) : (
              <p className="text-sm text-muted-foreground">
                Set up at least one active machine, shift, operator and a finished-good
                SKU in{" "}
                <Link href="/masters/production" className="underline">
                  production masters
                </Link>{" "}
                and{" "}
                <Link href="/masters/items" className="underline">
                  items
                </Link>{" "}
                before opening a lot.
              </p>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent lots</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Lot no</th>
                <th className="py-2 pr-4 font-medium">SKU</th>
                <th className="py-2 pr-4 font-medium">Machine · Shift</th>
                <th className="py-2 pr-4 font-medium">Output kg</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {lots.map((lot) => (
                <tr key={lot.id} className="border-b last:border-0">
                  <td className="py-2 pr-4 font-mono text-xs">{lot.lotNo}</td>
                  <td className="py-2 pr-4">{lot.targetItem.code}</td>
                  <td className="py-2 pr-4 text-muted-foreground">
                    {lot.machine.code} · {lot.shift.code}
                  </td>
                  <td className="py-2 pr-4 tabular-nums">
                    {lot.status === "OPEN" ? "—" : lot.outputKg.toString()}
                  </td>
                  <td className="py-2 pr-4">
                    {lot.status === "OPEN" ? (
                      statusLabel[lot.status]
                    ) : (
                      <span className="text-muted-foreground">
                        {statusLabel[lot.status]}
                      </span>
                    )}
                  </td>
                  <td className="py-2">
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/production/lots/${lot.id}`}>Open</Link>
                    </Button>
                  </td>
                </tr>
              ))}
              {lots.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-muted-foreground">
                    No lots yet.
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
