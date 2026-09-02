// GET /api/dashboard — volume, match rate, exceptions, pending settlement (Section 4).

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const [orderCount, transactionCount, settlementCount, matchStatusGroups, reviewQueueCount, exceptionSeverityGroups, missingSettlementResults] =
    await Promise.all([
      prisma.order.count(),
      prisma.transaction.count(),
      prisma.settlement.count(),
      prisma.reconciliationResult.groupBy({ by: ["matchStatus"], _count: true }),
      prisma.reconciliationResult.count({ where: { reviewStatus: "PENDING_REVIEW" } }),
      prisma.financeException.groupBy({ by: ["severity"], _count: true, where: { status: "OPEN" } }),
      prisma.reconciliationResult.findMany({
        where: { matchStatus: "MISSING_SETTLEMENT" },
        select: { transaction: { select: { amount: true } } },
      }),
    ]);

  const matchStatusBreakdown = Object.fromEntries(matchStatusGroups.map((g) => [g.matchStatus, g._count]));
  const totalReconciled = matchStatusGroups.reduce((sum, g) => sum + g._count, 0);
  const matchedCount = matchStatusBreakdown.MATCHED ?? 0;
  const matchRate = totalReconciled > 0 ? Math.round((matchedCount / totalReconciled) * 1000) / 10 : 0;

  const exceptionsBySeverity = Object.fromEntries(exceptionSeverityGroups.map((g) => [g.severity, g._count]));

  const pendingSettlementAmount = missingSettlementResults.reduce((sum, r) => sum + Number(r.transaction?.amount ?? 0), 0);

  return NextResponse.json({
    totals: { orders: orderCount, transactions: transactionCount, settlements: settlementCount },
    matchStatusBreakdown,
    matchRate,
    reviewQueueCount,
    exceptionsBySeverity,
    pendingSettlementAmount: Math.round(pendingSettlementAmount * 100) / 100,
  });
}
