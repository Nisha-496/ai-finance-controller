// The "structured query layer" from Section 10 — the backend decides exactly
// what a given AI request is allowed to see, and assembles it here. Nothing
// downstream of this file ever gets a raw query handle.

import { prisma } from "@/lib/db";
import { getDashboardStats } from "@/lib/queries/dashboard";
import { listPendingReview } from "@/lib/queries/review";
import type { ExceptionExplanationInput, ChatContext } from "@/lib/ai";

export async function fetchExceptionContext(exceptionId: string): Promise<ExceptionExplanationInput | null> {
  const exception = await prisma.financeException.findUnique({
    where: { id: exceptionId },
    include: { reconciliationResult: { include: { transaction: true, settlement: true } } },
  });
  if (!exception) return null;

  const transaction = exception.reconciliationResult?.transaction ?? null;
  const settlement = exception.reconciliationResult?.settlement ?? null;

  const paymentAmount = transaction ? Number(transaction.amount) : null;
  const settlementGross = settlement ? Number(settlement.grossAmount) : null;
  const fee = settlement ? Number(settlement.fee) : null;
  const tax = settlement ? Number(settlement.tax) : null;
  const difference = paymentAmount !== null && settlementGross !== null ? Math.round((settlementGross - paymentAmount) * 100) / 100 : null;

  return {
    exceptionType: exception.exceptionType,
    severity: exception.severity,
    description: exception.description,
    paymentAmount,
    settlementGross,
    fee,
    tax,
    difference,
  };
}

export async function buildChatContext(): Promise<ChatContext> {
  const [stats, review] = await Promise.all([getDashboardStats(), listPendingReview()]);

  return {
    totals: stats.totals,
    matchRate: stats.matchRate,
    reviewQueueCount: stats.reviewQueueCount,
    pendingSettlementAmount: stats.pendingSettlementAmount,
    exceptionsBySeverity: stats.exceptionsBySeverity,
    reviewQueueSample: review.results.slice(0, 10).map((r) => ({
      transactionRef: r.transaction?.transactionRef ?? null,
      settlementRef: r.settlement?.settlementRef ?? null,
      confidence: Number(r.confidence),
    })),
  };
}
