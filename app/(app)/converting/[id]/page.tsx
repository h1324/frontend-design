import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { requireActor, requireAccess, can } from "@/lib/rbac";
import { convertingMetrics } from "@/lib/converting";
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
  pickParentsAction,
  closeConvertingAction,
  cancelConvertingAction,
} from "../actions";
import { computeConvertingCostAction } from "@/app/(app)/costing/actions";
import { formatPaise } from "@/lib/gst";

const selectClass =
  "h-10 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-GB"); // DD/MM/YYYY (Indian convention)
}

export default async function ConvertingDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const actor = requireActor(await auth());
  requireAccess(actor, "PRODUCTION", "read");
  const canWrite = can(actor.role, "PRODUCTION", "write");

  const order = await prisma.convertingOrder.findFirst({
    where: { id, companyId: actor.companyId },
    include: {
      machine: true,
      shift: true,
      operator: true,
      targetItem: true,
      inputs: { include: { roll: { include: { item: true, lot: true } } } },
      children: { include: { item: true } },
      cost: true,
    },
  });
  if (!order) notFound();

  const metrics = await convertingMetrics(prisma, order.id);
  const isOpen = order.status === "OPEN";
  const canCost = can(actor.role, "COSTING", "write");

  // Parent picker: aged, AVAILABLE rolls in the company (any SKU), excluding those already
  // picked for this order. Curing/held rolls need the logged override, so they're not offered.
  const now = new Date();
  const picked = new Set(order.inputs.map((i) => i.rollId));
  const [available, locations] = await Promise.all([
    isOpen
      ? prisma.roll.findMany({
          where: {
            companyId: actor.companyId,
            state: "AVAILABLE",
            OR: [{ agingReadyDate: null }, { agingReadyDate: { lte: now } }],
          },
          include: { item: true },
          orderBy: { rollNo: "asc" },
          take: 200,
        })
      : Promise.resolve([]),
    prisma.location.findMany({
      where: { companyId: actor.companyId },
      orderBy: { code: "asc" },
    }),
  ]);
  const pickable = available.filter((r) => !picked.has(r.id));

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-6 py-12">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">
            EPE Foam ERP · Production
          </p>
          <h1 className="mt-1 font-mono text-2xl font-semibold tracking-tight">
            {order.docNo}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {order.operation} → {order.targetItem.code} — {order.targetItem.name} ·{" "}
            {order.machine.code} · {order.shift.code} · {order.operator.name} ·{" "}
            {fmtDate(order.startedAt)}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className="rounded-full border px-3 py-1 text-xs font-medium">
            {order.status}
          </span>
          <Button asChild variant="ghost" size="sm">
            <Link href="/converting">All orders</Link>
          </Button>
        </div>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Material balance</CardTitle>
          <CardDescription>
            Input − output − scrap − trim. The variance is a KPI, surfaced not reconciled.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <Metric label="Input kg" value={metrics.inputKg.toString()} />
          <Metric label="Output kg" value={metrics.outputKg.toString()} />
          <Metric label="Scrap kg" value={metrics.scrapKg.toString()} />
          <Metric label="Trim kg" value={metrics.trimKg.toString()} />
          <Metric label="Variance kg" value={metrics.balanceVariance.toString()} />
          <Metric label="Parents" value={String(order.inputs.length)} />
          <Metric label="Children" value={String(order.children.length)} />
        </CardContent>
      </Card>

      {canWrite && isOpen ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pick parent rolls</CardTitle>
            <CardDescription>
              Reserves aged, available rolls for this order (AVAILABLE → ALLOCATED).
              Consuming a curing or held roll needs an override reason.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {pickable.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No aged, available rolls to pick.
              </p>
            ) : (
              <form action={pickParentsAction} className="flex flex-col gap-3">
                <input type="hidden" name="orderId" value={order.id} />
                <div className="max-h-72 overflow-y-auto rounded-md border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="py-2 pl-3 pr-4 font-medium"></th>
                        <th className="py-2 pr-4 font-medium">Roll</th>
                        <th className="py-2 pr-4 font-medium">SKU</th>
                        <th className="py-2 pr-4 font-medium">kg</th>
                        <th className="py-2 pr-4 font-medium">m²</th>
                        <th className="py-2 pr-4 font-medium">Density</th>
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
                          <td className="py-2 pr-4 tabular-nums">
                            {r.densityKgM3.toString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-col gap-1.5 sm:max-w-md">
                  <Label>Override reason (only if picking a curing/held roll)</Label>
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Parent rolls</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {order.inputs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No parents picked yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Roll</th>
                  <th className="py-2 pr-4 font-medium">SKU</th>
                  <th className="py-2 pr-4 font-medium">kg</th>
                  <th className="py-2 pr-4 font-medium">From lot</th>
                  <th className="py-2 font-medium">State</th>
                </tr>
              </thead>
              <tbody>
                {order.inputs.map((inp) => (
                  <tr key={inp.id} className="border-b last:border-0">
                    <td className="py-2 pr-4 font-mono text-xs">
                      <Link
                        href={`/production/rolls/${inp.rollId}`}
                        className="underline"
                      >
                        {inp.roll.rollNo}
                      </Link>
                    </td>
                    <td className="py-2 pr-4">{inp.roll.item.code}</td>
                    <td className="py-2 pr-4 tabular-nums">
                      {inp.roll.qtyKgActual.toString()}
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs">
                      {inp.roll.lot ? inp.roll.lot.lotNo : "—"}
                    </td>
                    <td className="py-2">{inp.roll.state}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {canWrite && isOpen ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Close order</CardTitle>
            <CardDescription>
              Consumes the parents and records the child rolls (all sharing these
              dimensions, one weight per child). Laminate children start <b>curing</b>;
              slit/bag children start available. Immutable after, except by cancellation.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              action={closeConvertingAction}
              className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
            >
              <input type="hidden" name="orderId" value={order.id} />
              <div className="flex flex-col gap-1.5">
                <Label>Location</Label>
                <select name="locationId" required className={selectClass}>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.code} — {l.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Length (m)</Label>
                <Input name="length_m" inputMode="decimal" required />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Width (m)</Label>
                <Input name="width_m" inputMode="decimal" required />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Thickness (mm)</Label>
                <Input name="thickness_mm" inputMode="decimal" required />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Density (kg/m³)</Label>
                <Input name="density_kg_m3" inputMode="decimal" required />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Child weights (kg, one per child)</Label>
                <Input name="weightsKg" placeholder="e.g. 11 11 10.8" required />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Scrap (kg)</Label>
                <Input name="scrapKg" inputMode="decimal" defaultValue="0" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Trim (kg)</Label>
                <Input name="trimKg" inputMode="decimal" defaultValue="0" />
              </div>
              <div className="sm:col-span-2 lg:col-span-3">
                <Button type="submit">Close order</Button>
              </div>
            </form>
            <p className="mt-2 text-xs text-muted-foreground">
              For a multi-layer laminate, enter the bonded thickness/density of the
              finished child.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Child rolls</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {order.children.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No children yet — output is recorded when the order is closed.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Roll</th>
                  <th className="py-2 pr-4 font-medium">SKU</th>
                  <th className="py-2 pr-4 font-medium">kg</th>
                  <th className="py-2 pr-4 font-medium">m²</th>
                  <th className="py-2 pr-4 font-medium">Density</th>
                  <th className="py-2 pr-4 font-medium">Aging-ready</th>
                  <th className="py-2 font-medium">State</th>
                </tr>
              </thead>
              <tbody>
                {order.children.map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="py-2 pr-4 font-mono text-xs">
                      <Link href={`/production/rolls/${r.id}`} className="underline">
                        {r.rollNo}
                      </Link>
                    </td>
                    <td className="py-2 pr-4">{r.item.code}</td>
                    <td className="py-2 pr-4 tabular-nums">{r.qtyKgActual.toString()}</td>
                    <td className="py-2 pr-4 tabular-nums">{r.qtyM2.toString()}</td>
                    <td className="py-2 pr-4 tabular-nums">{r.densityKgM3.toString()}</td>
                    <td className="py-2 pr-4">{fmtDate(r.agingReadyDate)}</td>
                    <td className="py-2">{r.state}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {order.status === "CLOSED" ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cost (S21)</CardTitle>
            <CardDescription>
              Consumed parent-roll cost + this order&apos;s conversion cost, allocated to
              the child rolls by weight. Cost the parent lots first.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {order.cost ? (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Metric
                  label="Input cost"
                  value={formatPaise(order.cost.inputCostPaise)}
                />
                <Metric
                  label="Conversion"
                  value={formatPaise(order.cost.conversionCostPaise)}
                />
                <Metric label="Total" value={formatPaise(order.cost.totalCostPaise)} />
                <Metric
                  label="Cost / kg"
                  value={formatPaise(order.cost.costPerKgPaise)}
                />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Not costed yet.</p>
            )}
            {canCost ? (
              <form action={computeConvertingCostAction}>
                <input type="hidden" name="orderId" value={order.id} />
                <Button type="submit" variant="secondary" size="sm">
                  {order.cost ? "Recompute cost" : "Compute cost"}
                </Button>
              </form>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {canWrite && order.status !== "CANCELLED" ? (
        <form action={cancelConvertingAction}>
          <input type="hidden" name="orderId" value={order.id} />
          <Button type="submit" variant="destructive" size="sm">
            Cancel order
          </Button>
          <p className="mt-1 text-xs text-muted-foreground">
            An open order releases its reserved parents. A closed order reverses both
            sides — children are cancelled and parents return to stock. Nothing is
            deleted.
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
