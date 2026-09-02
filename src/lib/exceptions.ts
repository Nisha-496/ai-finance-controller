// Section 9 — the exception detection engine. This is the FINAL pass: it only
// looks at what's still unresolved after reconciliation.ts (Stage 2/3) and
// matching.ts (Stage 4) have both had a chance, and turns "still nothing found"
// into a definitive MISSING_SETTLEMENT / MISSING_PAYMENT / PENDING_TRANSACTION.
// AMOUNT_MISMATCH and DUPLICATE_TRANSACTION are raised inline by
// reconciliation.ts, the moment those stages discover them — not here.

import { prisma } from "@/lib/db";

export type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

function daysSince(date: Date, now: Date): number {
  return Math.max(0, Math.round((now.getTime() - date.getTime()) / 86_400_000));
}

// Older unresolved items are more urgent — a settlement that's 40 days
// overdue is a real problem, one that's 2 days overdue is routine noise.
function severityByAge(days: number): Severity {
  if (days >= 30) return "CRITICAL";
  if (days >= 14) return "HIGH";
  if (days >= 7) return "MEDIUM";
  return "LOW";
}

export interface UnresolvedTransactionOutcome {
  matchStatus: "MISSING_SETTLEMENT" | "UNMATCHED";
  exceptionType: "MISSING_SETTLEMENT" | "PENDING_TRANSACTION";
  severity: Severity;
  description: string;
}

// null for FAILED transactions — a failed payment was never expected to
// settle, so having no settlement isn't an exception at all.
export function classifyUnresolvedTransaction(
  transaction: { status: "SUCCESS" | "PENDING" | "FAILED"; paymentDate: Date },
  now: Date,
): UnresolvedTransactionOutcome | null {
  if (transaction.status === "FAILED") return null;
  const days = daysSince(transaction.paymentDate, now);
  if (transaction.status === "PENDING") {
    return {
      matchStatus: "UNMATCHED",
      exceptionType: "PENDING_TRANSACTION",
      severity: severityByAge(days),
      description: `Payment has been pending for ${days} day(s) — no settlement expected until it completes.`,
    };
  }
  return {
    matchStatus: "MISSING_SETTLEMENT",
    exceptionType: "MISSING_SETTLEMENT",
    severity: severityByAge(days),
    description: `Payment completed ${days} day(s) ago with no matching settlement found.`,
  };
}

export interface UnresolvedSettlementOutcome {
  matchStatus: "UNMATCHED";
  exceptionType: "MISSING_PAYMENT";
  severity: Severity;
  description: string;
}

export function classifyUnresolvedSettlement(
  settlement: { settlementDate: Date },
  now: Date,
): UnresolvedSettlementOutcome {
  const days = daysSince(settlement.settlementDate, now);
  return {
    matchStatus: "UNMATCHED",
    exceptionType: "MISSING_PAYMENT",
    severity: severityByAge(days),
    description: `Settlement recorded ${days} day(s) ago with no matching payment on our side.`,
  };
}

const CALCULATION_TOLERANCE = 0.01;

// A data-quality check on the settlement record itself, independent of
// whether it matched anything — Section 6's Gross - Fee - Tax = Net identity
// should hold for every settlement row a source system sends us.
export function checkSettlementCalculation(settlement: {
  grossAmount: number;
  fee: number;
  tax: number;
  netAmount: number;
}): { ok: boolean; diff: number } {
  const expectedNet = Math.round((settlement.grossAmount - settlement.fee - settlement.tax) * 100) / 100;
  const diff = Math.round((settlement.netAmount - expectedNet) * 100) / 100;
  return { ok: Math.abs(diff) <= CALCULATION_TOLERANCE, diff };
}

function severityForDiff(absDiff: number): Severity {
  if (absDiff >= 1000) return "CRITICAL";
  if (absDiff >= 300) return "HIGH";
  if (absDiff >= 50) return "MEDIUM";
  return "LOW";
}

export interface ExceptionDetectionSummary {
  missingSettlementCount: number;
  missingPaymentCount: number;
  pendingCount: number;
  skippedFailedCount: number;
  invalidCalculationCount: number;
}

export async function runExceptionDetection(now: Date = new Date()): Promise<ExceptionDetectionSummary> {
  const [unresolvedTransactions, unresolvedSettlements] = await Promise.all([
    prisma.transaction.findMany({ where: { reconciliationResult: null } }),
    prisma.settlement.findMany({ where: { reconciliationResult: null } }),
  ]);

  let missingSettlementCount = 0;
  let pendingCount = 0;
  let skippedFailedCount = 0;

  for (const t of unresolvedTransactions) {
    const outcome = classifyUnresolvedTransaction({ status: t.status, paymentDate: t.paymentDate }, now);
    if (!outcome) {
      skippedFailedCount++;
      continue;
    }
    const reconciliation = await prisma.reconciliationResult.create({
      data: { transactionId: t.id, matchStatus: outcome.matchStatus, reviewStatus: "NOT_REQUIRED", confidence: 0 },
    });
    await prisma.financeException.create({
      data: {
        reconciliationResultId: reconciliation.id,
        exceptionType: outcome.exceptionType,
        severity: outcome.severity,
        description: outcome.description,
      },
    });
    if (outcome.exceptionType === "PENDING_TRANSACTION") pendingCount++;
    else missingSettlementCount++;
  }

  let missingPaymentCount = 0;
  for (const s of unresolvedSettlements) {
    const outcome = classifyUnresolvedSettlement({ settlementDate: s.settlementDate }, now);
    const reconciliation = await prisma.reconciliationResult.create({
      data: { settlementId: s.id, matchStatus: outcome.matchStatus, reviewStatus: "NOT_REQUIRED", confidence: 0 },
    });
    await prisma.financeException.create({
      data: {
        reconciliationResultId: reconciliation.id,
        exceptionType: outcome.exceptionType,
        severity: outcome.severity,
        description: outcome.description,
      },
    });
    missingPaymentCount++;
  }

  // Data-quality pass over every settlement now that all of them have a
  // reconciliation result, regardless of match outcome.
  const allSettlements = await prisma.settlement.findMany({ include: { reconciliationResult: true } });
  let invalidCalculationCount = 0;
  for (const s of allSettlements) {
    if (!s.reconciliationResult) continue;
    const { ok, diff } = checkSettlementCalculation({
      grossAmount: Number(s.grossAmount),
      fee: Number(s.fee),
      tax: Number(s.tax),
      netAmount: Number(s.netAmount),
    });
    if (!ok) {
      await prisma.financeException.create({
        data: {
          reconciliationResultId: s.reconciliationResult.id,
          exceptionType: "INVALID_SETTLEMENT_CALCULATION",
          severity: severityForDiff(Math.abs(diff)),
          description: `Settlement arithmetic doesn't add up: net amount is off by ₹${Math.abs(diff).toFixed(2)} from gross - fee - tax.`,
        },
      });
      invalidCalculationCount++;
    }
  }

  return { missingSettlementCount, missingPaymentCount, pendingCount, skippedFailedCount, invalidCalculationCount };
}
