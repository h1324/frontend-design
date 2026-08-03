import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { requireActor, requireAccess, can } from "@/lib/rbac";
import { lotMetrics } from "@/lib/production";
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
import { addDowntimeAction, closeLotAction, cancelLotAction } from "../../actions";

const selectClass =
  "h-10 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-GB"); // DD/MM/YYYY (Indian convention)
}

export default async function LotDetailPage({
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

  const lot = await prisma.lot.findFirst({
    where: { id, companyId: actor.companyId },
    include: {
      machine: true,
      shift: true,
      operator: true,
      targetItem: true,
      rolls: true,
      materialIssues: { include: { lines: { include: { item: true } } } },
      downtimeLogs: { include: { reason: true } },
    },
  });
  if (!lot) notFound();

  const metrics = await lotMetrics(prisma, lot.id);
  const [reasons, locations] = await Promise.all([
    prisma.downtimeReason.findMany({
      where: { companyId: actor.companyId, isActive: true },
      orderBy: { code: "asc" },
    }),
    prisma.location.findMany({
      where: { companyId: actor.companyId },
      orderBy: { code: "asc" },
    }),
  ]);

  const isOpen = lot.status === "OPEN";
  const totalDowntime = lot.downtimeLogs.reduce((s, d) => s + d.minutes, 0);

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-6 py-12">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">
            EPE Foam ERP · Production
          </p>
          <h1 className="mt-1 font-mono text-2xl font-semibold tracking-tight">
            {lot.lotNo}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {lot.targetItem.code} — {lot.targetItem.name} · {lot.machine.code} ·{" "}
            {lot.shift.code} · {lot.operator.name} · {fmtDate(lot.productionDate)}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className="rounded-full border px-3 py-1 text-xs font-medium">
            {lot.status}
          </span>
          <Button asChild variant="ghost" size="sm">
            <Link href="/production/lots">All lots</Link>
          </Button>
        </div>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Metrics</CardTitle>
          <CardDescription>
            Material balance is surfaced, not reconciled away — the variance is a KPI.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          <Metric label="Input kg" value={metrics.inputKg.toString()} />
          <Metric label="Output kg" value={metrics.outputKg.toString()} />
          <Metric label="Scrap kg" value={metrics.scrapKg.toString()} />
          <Metric label="Trim kg" value={metrics.trimKg.toString()} />
          <Metric label="Yield %" value={metrics.yieldPct.toFixed(1)} />
          <Metric label="Regrind %" value={metrics.regrindPct.toFixed(1)} />
          <Metric
            label="Balance variance kg"
            value={metrics.balanceVariance.toString()}
          />
          <Metric
            label="Energy kWh"
            value={lot.energyKwh ? lot.energyKwh.toString() : "—"}
          />
          <Metric label="Downtime min" value={String(totalDowntime)} />
          <Metric label="Output rolls" value={String(lot.rolls.length)} />
        </CardContent>
      </Card>

      {canWrite && isOpen ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Close lot</CardTitle>
            <CardDescription>
              Records output rolls (all sharing these dimensions, one weight per roll) in{" "}
              <b>curing</b> and finalizes the lot. Immutable after, except by
              cancellation.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              action={closeLotAction}
              className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
            >
              <input type="hidden" name="lotId" value={lot.id} />
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
                <Label>Roll weights (kg, one per roll)</Label>
                <Input name="weightsKg" placeholder="e.g. 46 46 45.8" required />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Scrap (kg)</Label>
                <Input name="scrapKg" inputMode="decimal" defaultValue="0" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Trim (kg)</Label>
                <Input name="trimKg" inputMode="decimal" defaultValue="0" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Energy (kWh, optional)</Label>
                <Input name="energyKwh" inputMode="decimal" />
              </div>
              <div className="sm:col-span-2 lg:col-span-3">
                <Button type="submit">Close lot</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {canWrite && isOpen ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Log downtime</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              action={addDowntimeAction}
              className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
            >
              <input type="hidden" name="lotId" value={lot.id} />
              <div className="flex flex-col gap-1.5">
                <Label>Reason</Label>
                <select name="reasonId" required className={selectClass}>
                  {reasons.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.code} — {r.description}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Minutes</Label>
                <Input name="minutes" type="number" min="1" step="1" required />
              </div>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label>Note (optional)</Label>
                <Input name="note" />
              </div>
              <div className="sm:col-span-2 lg:col-span-4">
                <Button type="submit" variant="secondary">
                  Add downtime
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Material consumed</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {lot.materialIssues.length === 0 ? (
              <p className="text-muted-foreground">No RM issued to this lot yet.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {lot.materialIssues.map((iss) => (
                  <li key={iss.id}>
                    <span className="font-mono text-xs">{iss.docNo}</span>{" "}
                    {iss.status === "CANCELLED" ? (
                      <span className="text-muted-foreground">(cancelled)</span>
                    ) : null}
                    <div className="text-muted-foreground">
                      {iss.lines
                        .map(
                          (l) =>
                            `${l.item.code} ×${l.qtyBase.toString()}${l.isRegrind ? " (regrind)" : ""}`,
                        )
                        .join(", ")}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Downtime</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {lot.downtimeLogs.length === 0 ? (
              <p className="text-muted-foreground">No downtime logged.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {lot.downtimeLogs.map((d) => (
                  <li key={d.id} className="flex justify-between">
                    <span>
                      {d.reason.code} — {d.reason.description}
                      {d.note ? (
                        <span className="text-muted-foreground"> · {d.note}</span>
                      ) : null}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {d.minutes}m
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Output rolls</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {lot.rolls.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No rolls yet — output is recorded when the lot is closed.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Roll</th>
                  <th className="py-2 pr-4 font-medium">Actual kg</th>
                  <th className="py-2 pr-4 font-medium">m²</th>
                  <th className="py-2 pr-4 font-medium">Density</th>
                  <th className="py-2 pr-4 font-medium">Aging-ready</th>
                  <th className="py-2 font-medium">State</th>
                </tr>
              </thead>
              <tbody>
                {lot.rolls.map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="py-2 pr-4 font-mono text-xs">
                      <Link href={`/production/rolls/${r.id}`} className="underline">
                        {r.rollNo}
                      </Link>
                    </td>
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

      {canWrite && lot.status !== "CANCELLED" ? (
        <form action={cancelLotAction}>
          <input type="hidden" name="lotId" value={lot.id} />
          <Button type="submit" variant="destructive" size="sm">
            Cancel lot
          </Button>
          <p className="mt-1 text-xs text-muted-foreground">
            Reverses output-roll stock and returns issued RM to stock. Nothing is deleted.
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
