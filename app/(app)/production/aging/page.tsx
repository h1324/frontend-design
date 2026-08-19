import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { requireActor, requireAccess, can } from "@/lib/rbac";
import { agingCountdown } from "@/lib/aging";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { runSweepAction, releaseEarlyAction } from "./actions";

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-GB"); // DD/MM/YYYY (Indian convention)
}

export default async function AgingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; swept?: string }>;
}) {
  const { error, swept } = await searchParams;
  const actor = requireActor(await auth());
  requireAccess(actor, "PRODUCTION", "read");
  const canWrite = can(actor.role, "PRODUCTION", "write");

  const now = new Date();
  const curing = await prisma.roll.findMany({
    where: { companyId: actor.companyId, state: "CURING" },
    orderBy: [{ agingReadyDate: "asc" }, { createdAt: "asc" }],
    take: 200,
    include: { item: true },
  });

  const rows = curing.map((r) => ({
    roll: r,
    countdown: agingCountdown(r.agingReadyDate, now),
  }));
  const dueNow = rows.filter((x) => x.countdown.ready).length;

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 px-5 py-8 lg:px-8">
      <PageHeader
        eyebrow="Production"
        title="Aging queue"
        description="Rolls cure until butane diffuses out; on the ready date they become available to sell."
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link href="/production/rolls">Rolls</Link>
          </Button>
        }
      />

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {swept != null ? (
        <p className="text-sm text-muted-foreground">
          Swept <span className="font-medium">{swept}</span> roll(s) to available.
        </p>
      ) : null}

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="text-base">Curing</CardTitle>
            <CardDescription>
              Foam rests while butane diffuses out — physically present but not sellable
              until its aging-ready date.{" "}
              {dueNow > 0 ? `${dueNow} roll(s) are due now.` : ""}
            </CardDescription>
          </div>
          {canWrite ? (
            <form action={runSweepAction}>
              <Button type="submit" variant="secondary" size="sm">
                Run sweep now
              </Button>
            </form>
          ) : null}
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Roll no</th>
                <th className="py-2 pr-4 font-medium">SKU</th>
                <th className="py-2 pr-4 font-medium">Net kg</th>
                <th className="py-2 pr-4 font-medium">Aging-ready</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                {canWrite ? <th className="py-2 font-medium">Release early</th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ roll, countdown }) => (
                <tr key={roll.id} className="border-b align-top last:border-0">
                  <td className="py-2 pr-4 font-mono text-xs">
                    <Link href={`/production/rolls/${roll.id}`} className="underline">
                      {roll.rollNo}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">{roll.item.code}</td>
                  <td className="py-2 pr-4 tabular-nums">
                    {roll.qtyKgActual.toString()}
                  </td>
                  <td className="py-2 pr-4">{fmtDate(roll.agingReadyDate)}</td>
                  <td className="py-2 pr-4">
                    <span
                      className={
                        countdown.ready
                          ? "font-medium text-foreground"
                          : "text-muted-foreground"
                      }
                    >
                      {countdown.ready ? "due — run sweep" : countdown.label}
                    </span>
                  </td>
                  {canWrite ? (
                    <td className="py-2">
                      <form action={releaseEarlyAction} className="flex gap-2">
                        <input type="hidden" name="rollId" value={roll.id} />
                        <Input
                          name="reason"
                          placeholder="reason (required)"
                          className="h-8 w-44 text-xs"
                          required
                        />
                        <Button type="submit" variant="ghost" size="sm">
                          Release
                        </Button>
                      </form>
                    </td>
                  ) : null}
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={canWrite ? 6 : 5}
                    className="py-6 text-center text-muted-foreground"
                  >
                    Nothing curing.
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
