// POST /api/reconcile — runs all three deterministic stages in sequence over
// whatever's currently unreconciled. AI never touches this path (Section 10).

import { NextResponse } from "next/server";
import { runExactMatchReconciliation } from "@/lib/reconciliation";
import { runFuzzyMatchReconciliation } from "@/lib/matching";
import { runExceptionDetection } from "@/lib/exceptions";

export async function POST() {
  const stage2 = await runExactMatchReconciliation();
  const stage4 = await runFuzzyMatchReconciliation();
  const stage5 = await runExceptionDetection();

  return NextResponse.json({
    exactMatches: stage2.matches.length,
    duplicateGroups: stage2.duplicates.length,
    fuzzyAutoMatches: stage4.matches.filter((m) => m.tier === "AUTO_MATCH").length,
    fuzzyReviewMatches: stage4.matches.filter((m) => m.tier === "REVIEW").length,
    missingSettlement: stage5.missingSettlementCount,
    missingPayment: stage5.missingPaymentCount,
    pending: stage5.pendingCount,
    invalidCalculations: stage5.invalidCalculationCount,
  });
}
