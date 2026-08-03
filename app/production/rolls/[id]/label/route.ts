import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { requireActor, AuthzError } from "@/lib/rbac";
import { printLabel, labelModelFromRoll, renderLabelPdf, RollError } from "@/lib/rolls";

/** POST → log the print (increment count, stamp time, audit) and stream the label PDF.
 *  A POST (not GET) because printing is a deliberate, recorded action. */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const actor = requireActor(await auth());

  let roll;
  try {
    roll = await prisma.$transaction((tx) => printLabel(tx, actor, id));
  } catch (err) {
    if (err instanceof RollError) {
      return new NextResponse("Roll not found", { status: 404 });
    }
    if (err instanceof AuthzError) {
      return new NextResponse("Not permitted", { status: 403 });
    }
    throw err;
  }

  const pdf = renderLabelPdf(labelModelFromRoll(roll));
  return new NextResponse(Buffer.from(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${roll.rollNo}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
