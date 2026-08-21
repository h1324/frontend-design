import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { formatPaise } from "@/lib/gst";
import { financialYear } from "@/lib/financial-year";
import { FoamFlowStrip, type StateCount } from "@/components/console/foam-flow-strip";

export const dynamic = "force-dynamic";

function kg(n: number): string {
  return `${Math.round(n).toLocaleString("en-IN")}`;
}

export default async function Console() {
  const session = await auth();
  const companyId = session?.user?.companyId;

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfToday = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000 - 1);

  const empty = {
    company: null as { name: string } | null,
    byState: [] as {
      state: string;
      _sum: { qtyKgActual: unknown };
      _count: { _all: number };
    }[],
    producedTodayKg: 0,
    dueTodayCount: 0,
    overduePaise: 0n,
    overdueCount: 0,
    blockedOrders: 0,
    curingReadyBacklog: 0,
  };
  let d = empty;
  if (companyId) {
    const [
      company,
      byState,
      producedToday,
      dueToday,
      overdueInvoices,
      blocked,
      readyBacklog,
    ] = await Promise.all([
      prisma.company.findUnique({ where: { id: companyId }, select: { name: true } }),
      prisma.roll.groupBy({
        by: ["state"],
        where: { companyId },
        _sum: { qtyKgActual: true },
        _count: { _all: true },
      }),
      prisma.roll.aggregate({
        where: { companyId, createdAt: { gte: startOfToday } },
        _sum: { qtyKgActual: true },
      }),
      prisma.roll.count({
        where: { companyId, state: "CURING", agingReadyDate: { lte: endOfToday } },
      }),
      prisma.invoice.findMany({
        where: { companyId, status: "ISSUED", dueDate: { lt: startOfToday } },
        select: { totalPaise: true, amountSettledPaise: true },
      }),
      prisma.salesOrder.count({ where: { companyId, creditStatus: "BLOCKED" } }),
      prisma.roll.count({
        where: { companyId, state: "CURING", agingReadyDate: { lte: now } },
      }),
    ]);
    let overduePaise = 0n;
    let overdueCount = 0;
    for (const inv of overdueInvoices) {
      const bal = inv.totalPaise - inv.amountSettledPaise;
      if (bal > 0n) {
        overduePaise += bal;
        overdueCount += 1;
      }
    }
    d = {
      company,
      byState: byState as unknown as typeof empty.byState,
      producedTodayKg: Number(producedToday._sum.qtyKgActual ?? 0),
      dueTodayCount: dueToday,
      overduePaise,
      overdueCount,
      blockedOrders: blocked,
      curingReadyBacklog: readyBacklog,
    };
  }

  const stateLookup = new Map(
    d.byState.map((r) => [
      r.state,
      { kg: Number(r._sum.qtyKgActual ?? 0), rolls: r._count._all },
    ]),
  );
  const flow: StateCount[] = (
    ["CURING", "AVAILABLE", "ALLOCATED", "DISPATCHED"] as const
  ).map((s) => ({ state: s, ...(stateLookup.get(s) ?? { kg: 0, rolls: 0 }) }));
  const rejected = stateLookup.get("REJECTED") ?? { kg: 0, rolls: 0 };
  const rollsOnFloor =
    (stateLookup.get("CURING")?.rolls ?? 0) +
    (stateLookup.get("AVAILABLE")?.rolls ?? 0) +
    (stateLookup.get("ALLOCATED")?.rolls ?? 0);

  const role = session?.user?.role ?? "VIEWER";
  const fy = financialYear(now);
  const dateStr = now.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  // Actionable exceptions — the console's job is to surface what needs a human today.
  const attention: { dot: string; text: string; href: string }[] = [];
  if (d.blockedOrders > 0)
    attention.push({
      dot: "hsl(2 72% 50%)",
      text: `${d.blockedOrders} credit-blocked order${d.blockedOrders === 1 ? "" : "s"} awaiting override`,
      href: "/sales/orders",
    });
  if (d.overdueCount > 0)
    attention.push({
      dot: "hsl(33 92% 44%)",
      text: `${formatPaise(d.overduePaise)} overdue across ${d.overdueCount} bill${d.overdueCount === 1 ? "" : "s"}`,
      href: "/receivables",
    });
  if (d.curingReadyBacklog > 0)
    attention.push({
      dot: "hsl(168 64% 33%)",
      text: `${d.curingReadyBacklog} roll${d.curingReadyBacklog === 1 ? "" : "s"} past ready date, still marked curing`,
      href: "/production/aging",
    });
  if (rejected.rolls > 0)
    attention.push({
      dot: "hsl(2 72% 50%)",
      text: `${rejected.rolls} roll${rejected.rolls === 1 ? "" : "s"} held in reject`,
      href: "/qc/queue",
    });

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-8 px-5 py-8 lg:px-8">
      {/* Hero: the plant, right now */}
      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow">
              {d.company?.name ?? "Your plant"} · FY {fy} · {dateStr}
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-[1.75rem]">
              Foam on the floor, by state
            </h1>
          </div>
          {d.dueTodayCount > 0 ? (
            <p className="rounded-full bg-state-available-soft px-3 py-1 text-xs font-medium text-state-available">
              {d.dueTodayCount} roll{d.dueTodayCount === 1 ? "" : "s"} clear curing today
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">Nothing clears curing today.</p>
          )}
        </div>

        <FoamFlowStrip flow={flow} />
      </section>

      {/* KPI row */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi
          label="Produced today"
          value={kg(d.producedTodayKg)}
          unit="kg"
          tone="brand"
        />
        <Kpi
          label="Rolls on floor"
          value={rollsOnFloor.toLocaleString("en-IN")}
          unit="live units"
          tone="muted"
        />
        <Kpi
          label="Overdue receivables"
          value={formatPaise(d.overduePaise)}
          unit={`${d.overdueCount} bill${d.overdueCount === 1 ? "" : "s"}`}
          tone={d.overduePaise > 0n ? "warn" : "muted"}
        />
        <Kpi
          label="Credit-blocked orders"
          value={String(d.blockedOrders)}
          unit={d.blockedOrders === 1 ? "order" : "orders"}
          tone={d.blockedOrders > 0 ? "danger" : "muted"}
        />
      </section>

      {/* Needs attention */}
      <section className="flex flex-col gap-3">
        <p className="eyebrow">Needs attention</p>
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          {attention.length === 0 ? (
            <div className="flex items-center gap-3 px-4 py-5">
              <span className="h-2.5 w-2.5 rounded-full bg-state-available" aria-hidden />
              <p className="text-sm text-muted-foreground">
                All clear — no blocked orders, overdue bills or stuck stock.
              </p>
            </div>
          ) : (
            attention.map((a) => (
              <Link
                key={a.text}
                href={a.href}
                className="flex items-center gap-3 border-b border-border px-4 py-3 transition-colors last:border-0 hover:bg-secondary"
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: a.dot }}
                  aria-hidden
                />
                <span className="flex-1 text-sm text-foreground">{a.text}</span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </Link>
            ))
          )}
        </div>
      </section>

      <footer className="border-t border-border pt-5 text-xs text-muted-foreground">
        <span className="data">EPE Foam ERP</span> · production, inventory, dispatch &
        costing · signed in as {role}. TallyPrime stays the book of record.
      </footer>
    </main>
  );
}

const kpiTone: Record<string, string> = {
  brand: "text-brand",
  available: "text-state-available",
  warn: "text-state-curing",
  danger: "text-state-rejected",
  muted: "text-foreground",
};

function Kpi({
  label,
  value,
  unit,
  tone,
}: {
  label: string;
  value: string;
  unit: string;
  tone: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-card px-4 py-3.5">
      <p className="eyebrow">{label}</p>
      <p
        className={`font-display text-2xl font-bold leading-none ${kpiTone[tone] ?? "text-foreground"}`}
      >
        {value}
      </p>
      <p className="data text-xs text-muted-foreground">{unit}</p>
    </div>
  );
}
