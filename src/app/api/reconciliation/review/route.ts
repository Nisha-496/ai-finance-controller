// GET /api/reconciliation/review — everything pending human review, with the
// confidence breakdown so the reviewer can see why it was flagged (Section 8).

import { NextResponse } from "next/server";
import { listPendingReview } from "@/lib/queries/review";

export async function GET() {
  return NextResponse.json(await listPendingReview());
}
