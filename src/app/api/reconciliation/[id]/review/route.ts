// PATCH /api/reconciliation/:id/review — { "action": "APPROVE" | "REJECT" }.
// Only ever acts on records currently PENDING_REVIEW — Section 8's lifecycle
// applies exclusively to the 80-94% confidence tier.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function PATCH(request: Request, ctx: RouteContext<"/api/reconciliation/[id]/review">) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  const action = body?.action;

  if (action !== "APPROVE" && action !== "REJECT") {
    return NextResponse.json({ error: 'action must be "APPROVE" or "REJECT"' }, { status: 400 });
  }

  const existing = await prisma.reconciliationResult.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "reconciliation result not found" }, { status: 404 });
  }
  if (existing.reviewStatus !== "PENDING_REVIEW") {
    return NextResponse.json(
      { error: `cannot review a result with review_status = ${existing.reviewStatus}; only PENDING_REVIEW is reviewable` },
      { status: 409 },
    );
  }

  const updated = await prisma.reconciliationResult.update({
    where: { id },
    data: {
      matchStatus: action === "APPROVE" ? "MATCHED" : "UNMATCHED",
      reviewStatus: action === "APPROVE" ? "APPROVED" : "REJECTED",
      reviewedAt: new Date(),
    },
  });

  return NextResponse.json({ result: updated });
}
