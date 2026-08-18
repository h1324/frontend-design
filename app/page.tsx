import Link from "next/link";
import { auth, signOut } from "@/auth";
import { prisma } from "@/lib/db";
import { formatPaise } from "@/lib/gst";
import { financialYear } from "@/lib/financial-year";
import { Wordmark } from "@/components/brand/wordmark";
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

  // Live plant state — resilient to an empty DB (everything falls back to zero).
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

  return (
    <div className="min-h-screen">
      {/* Identity bar */}
      <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3">
          <Wordmark />
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="data text-xs text-muted-foreground">
                FY {fy} · {dateStr}
              </p>
              <p className="text-xs text-foreground">
                {session?.user?.name ?? "—"}{" "}
                <span className="text-muted-foreground">· {role}</span>
              </p>
            </div>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/login" });
              }}
            >
              <button className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-8 px-5 py-8">
        {/* Hero: the plant, right now */}
        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="eyebrow">On the floor · {d.company?.name ?? "your plant"}</p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-[1.75rem]">
                Foam on the floor, by state
              </h1>
            </div>
            {d.dueTodayCount > 0 ? (
              <p className="rounded-full bg-state-available-soft px-3 py-1 text-xs font-medium text-state-available">
                {d.dueTodayCount} roll{d.dueTodayCount === 1 ? "" : "s"} clear curing
                today
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Nothing clears curing today.
              </p>
            )}
          </div>

          <FoamFlowStrip flow={flow} />

          {rejected.rolls > 0 ? (
            <p className="text-xs text-muted-foreground">
              <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-state-rejected align-middle" />
              {rejected.rolls} roll{rejected.rolls === 1 ? "" : "s"} held in reject ·{" "}
              <span className="data">{kg(rejected.kg)} kg</span>
            </p>
          ) : null}
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
            unit={`live units · ${d.curingReadyBacklog} past ready`}
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

        {/* Module launcher */}
        <section className="flex flex-col gap-6">
          {GROUPS.map((group) => {
            if (group.adminOnly && role !== "ADMIN") return null;
            return (
              <div key={group.title} className="flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  <span
                    className="h-2.5 w-2.5 rounded-[3px]"
                    style={{ backgroundColor: group.accent }}
                    aria-hidden
                  />
                  <p className="eyebrow">{group.title}</p>
                  <span className="h-px flex-1 bg-border" />
                </div>
                <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                  {group.items.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="group relative flex flex-col gap-0.5 overflow-hidden rounded-lg border border-border bg-card px-4 py-3 transition-all hover:border-brand/40 hover:shadow-[0_1px_0_0_hsl(196_20%_88%),0_8px_24px_-12px_hsl(196_40%_20%/0.25)]"
                    >
                      <span
                        className="absolute inset-y-0 left-0 w-0.5 opacity-70 transition-all group-hover:w-1"
                        style={{ backgroundColor: group.accent }}
                        aria-hidden
                      />
                      <span className="text-sm font-medium text-foreground">
                        {item.label}
                      </span>
                      <span className="text-xs text-muted-foreground">{item.desc}</span>
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </section>

        <footer className="border-t border-border pt-5 text-xs text-muted-foreground">
          <span className="data">EPE Foam ERP</span> · production, inventory, dispatch &
          costing. TallyPrime stays the book of record.
        </footer>
      </main>
    </div>
  );
}

// --- KPI tile ------------------------------------------------------------------------

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
  tone: keyof typeof kpiTone | string;
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

// --- module launcher data ------------------------------------------------------------

interface NavItem {
  label: string;
  href: string;
  desc: string;
}
interface NavGroup {
  title: string;
  accent: string;
  adminOnly?: boolean;
  items: NavItem[];
}

const GREEN = "hsl(168 64% 33%)";
const INDIGO = "hsl(224 60% 56%)";
const AMBER = "hsl(33 92% 44%)";
const SLATE = "hsl(202 14% 46%)";

const GROUPS: NavGroup[] = [
  {
    title: "Masters",
    accent: SLATE,
    items: [
      { label: "Items", href: "/masters/items", desc: "Foam SKUs, grades, HSN & GST" },
      {
        label: "Customers",
        href: "/masters/customers",
        desc: "Buyers, ship-tos & credit",
      },
      {
        label: "Suppliers",
        href: "/masters/suppliers",
        desc: "Resin, butane, additives",
      },
      {
        label: "Production masters",
        href: "/masters/production",
        desc: "Machines, shifts, operators",
      },
    ],
  },
  {
    title: "Production",
    accent: GREEN,
    items: [
      { label: "Lots", href: "/production/lots", desc: "Extrusion runs & regrind blend" },
      {
        label: "Rolls",
        href: "/production/rolls",
        desc: "Every numbered unit of output",
      },
      { label: "Aging", href: "/production/aging", desc: "Curing → available queue" },
      {
        label: "Converting",
        href: "/converting",
        desc: "Lamination, slitting, genealogy",
      },
    ],
  },
  {
    title: "Stores & purchasing",
    accent: INDIGO,
    items: [
      { label: "Stores", href: "/stores/receipts", desc: "RM receipts & issues" },
      {
        label: "Purchase orders",
        href: "/purchasing/orders",
        desc: "Orders to suppliers",
      },
      {
        label: "Receiving (GRN)",
        href: "/purchasing/grn",
        desc: "Goods receipt & landed cost",
      },
    ],
  },
  {
    title: "Quality",
    accent: AMBER,
    items: [
      {
        label: "QC queue",
        href: "/qc/queue",
        desc: "Density, thickness, hold & release",
      },
    ],
  },
  {
    title: "Sales & dispatch",
    accent: GREEN,
    items: [
      {
        label: "Sales orders",
        href: "/sales/orders",
        desc: "Order, credit check, fulfil",
      },
      {
        label: "Quotations",
        href: "/sales/quotations",
        desc: "Quote, price contracts, win",
      },
      { label: "Field orders", href: "/m", desc: "Mobile capture for reps" },
      { label: "Dispatch", href: "/dispatch", desc: "Pick, invoice, e-way & IRN" },
      { label: "Receivables", href: "/receivables", desc: "Ageing & overdue exposure" },
    ],
  },
  {
    title: "Costing & analytics",
    accent: SLATE,
    items: [
      {
        label: "Valuation",
        href: "/costing/valuation",
        desc: "Moving-average landed cost",
      },
      { label: "Cost rates", href: "/costing/rates", desc: "Energy, labour, overhead" },
      { label: "Margin", href: "/costing/margin", desc: "Sale vs. cost by customer" },
      { label: "Dashboards", href: "/dashboards", desc: "OEE, yield, kWh/kg, AR" },
    ],
  },
  {
    title: "Integrations",
    accent: SLATE,
    items: [
      {
        label: "Tally sync",
        href: "/integrations/tally",
        desc: "Invoices out, receipts in",
      },
    ],
  },
  {
    title: "Administration",
    accent: SLATE,
    adminOnly: true,
    items: [{ label: "Users", href: "/admin/users", desc: "People, roles & access" }],
  },
];
