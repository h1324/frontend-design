import { ChevronRight } from "lucide-react";

// The signature element. Foam moves through a fixed lifecycle — curing → available → allocated
// → dispatched — and the whole ERP exists because that flow is time-gated (a roll is physically
// present but unsellable while it cures). This strip makes that flow the hero: each state reads
// as an instrument cell coloured by "temperature" (warm amber curing → cool teal available), with
// a proportional gauge bar so relative volume is legible at a glance.

export interface StateCount {
  state: "CURING" | "AVAILABLE" | "ALLOCATED" | "DISPATCHED";
  kg: number;
  rolls: number;
}

const META: Record<
  StateCount["state"],
  { label: string; note: string; color: string; soft: string }
> = {
  CURING: {
    label: "Curing",
    note: "aging, not yet sellable",
    color: "hsl(33 92% 44%)",
    soft: "hsl(38 96% 92%)",
  },
  AVAILABLE: {
    label: "Available",
    note: "cleared & sellable",
    color: "hsl(168 64% 33%)",
    soft: "hsl(168 54% 92%)",
  },
  ALLOCATED: {
    label: "Allocated",
    note: "reserved to orders",
    color: "hsl(224 60% 56%)",
    soft: "hsl(224 72% 95%)",
  },
  DISPATCHED: {
    label: "Dispatched",
    note: "shipped out",
    color: "hsl(202 14% 46%)",
    soft: "hsl(202 18% 93%)",
  },
};

function kg(n: number): string {
  return Math.round(n).toLocaleString("en-IN");
}

export function FoamFlowStrip({ flow }: { flow: StateCount[] }) {
  const max = Math.max(1, ...flow.map((f) => f.kg));

  return (
    <div className="rounded-xl border border-border bg-card p-2 sm:p-3">
      <div className="grid grid-cols-2 items-stretch gap-2 lg:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] lg:gap-0">
        {flow.map((f, i) => {
          const m = META[f.state];
          const pct = Math.max(f.kg > 0 ? 6 : 0, Math.round((f.kg / max) * 100));
          return (
            <div key={f.state} className="contents">
              <div className="flex flex-col gap-2 rounded-lg px-3 py-3 lg:px-4">
                <div className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: m.color }}
                    aria-hidden
                  />
                  <span className="text-sm font-semibold text-foreground">{m.label}</span>
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span
                    className="font-display text-[1.75rem] font-bold leading-none"
                    style={{ color: m.color }}
                  >
                    {kg(f.kg)}
                  </span>
                  <span className="data text-xs text-muted-foreground">kg</span>
                </div>
                {/* proportional gauge */}
                <div
                  className="h-1.5 w-full overflow-hidden rounded-full"
                  style={{ backgroundColor: m.soft }}
                >
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${pct}%`, backgroundColor: m.color }}
                  />
                </div>
                <p className="data text-xs text-muted-foreground">
                  {f.rolls} roll{f.rolls === 1 ? "" : "s"} · {m.note}
                </p>
              </div>
              {i < flow.length - 1 ? (
                <div className="hidden items-center justify-center lg:flex" aria-hidden>
                  <ChevronRight className="h-4 w-4 text-border" strokeWidth={2.5} />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
