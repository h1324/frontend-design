import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { auth } from "@/auth";
import { requireActor, can, type Area } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const PANELS: { href: string; title: string; area: Area; blurb: string }[] = [
  {
    href: "/dashboards/production",
    title: "Production",
    area: "PRODUCTION",
    blurb: "OEE, output, yield, downtime, density variance",
  },
  {
    href: "/dashboards/sales",
    title: "Sales & dispatch",
    area: "SALES",
    blurb: "Dispatched kg/m²/₹, top customers and SKUs",
  },
  {
    href: "/dashboards/receivables",
    title: "Receivables",
    area: "RECEIVABLES",
    blurb: "Outstanding, ageing buckets, customer tier mix",
  },
  {
    href: "/dashboards/quality",
    title: "Quality",
    area: "QC",
    blurb: "QC pass/fail, rejected rolls",
  },
];

export default async function DashboardsPage() {
  const actor = requireActor(await auth());
  const visible = PANELS.filter((p) => can(actor.role, p.area, "read"));

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 px-5 py-8 lg:px-8">
      <PageHeader
        eyebrow="Analytics"
        title="Dashboards"
        description="OEE, yield, kWh/kg, density variance and receivables — the plant at a glance."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        {visible.map((p) => (
          <Card key={p.href}>
            <CardHeader>
              <CardTitle className="text-base">{p.title}</CardTitle>
              <CardDescription>{p.blurb}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="outline" size="sm">
                <Link href={p.href}>Open</Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </main>
  );
}
