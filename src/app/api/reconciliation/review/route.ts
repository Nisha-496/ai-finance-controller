// GET /api/reconciliation/review — everything pending human review, with the
// confidence breakdown so the reviewer can see why it was flagged (Section 8).

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const results = await prisma.reconciliationResult.findMany({
    where: { reviewStatus: "PENDING_REVIEW" },
    include: { transaction: { include: { order: true } }, settlement: true },
    orderBy: { confidence: "desc" },
  });

  return NextResponse.json({ total: results.length, results });
}
