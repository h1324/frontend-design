import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import { agingSweep } from "@/lib/aging";

// Scheduled aging sweep (spec S12): a small cron container on the plant mini-PC POSTs here
// hourly with a shared bearer token. It flips every company's cured rolls to AVAILABLE. This
// route lives under /api, so it is NOT behind the session middleware — it authenticates via
// the token instead. No token configured → the endpoint refuses to run at all.

function tokenOk(header: string | null): boolean {
  const expected = process.env.AGING_SWEEP_TOKEN;
  if (!expected) return false;
  const provided = header?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!process.env.AGING_SWEEP_TOKEN) {
    return NextResponse.json(
      { error: "aging sweep not configured (set AGING_SWEEP_TOKEN)" },
      { status: 503 },
    );
  }
  if (!tokenOk(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const asOf = new Date();
  const companies = await prisma.company.findMany({ select: { id: true } });
  let flipped = 0;
  const perCompany: Record<string, number> = {};
  for (const c of companies) {
    const res = await prisma.$transaction((tx) => agingSweep(tx, c.id, asOf, null));
    flipped += res.flipped;
    if (res.flipped > 0) perCompany[c.id] = res.flipped;
  }

  return NextResponse.json({ ok: true, asOf: asOf.toISOString(), flipped, perCompany });
}
