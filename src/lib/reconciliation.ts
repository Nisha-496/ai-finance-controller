// Stage 2 (exact matching) + Stage 3 (amount validation) — ARCHITECTURE.md Section 6.
// Whatever this stage can't resolve is left untouched for Stage 4 (matching.ts,
// Day 2) to pick up with fuzzy scoring. This stage never guesses — an exact
// match here means the reference genuinely matched, at full confidence.

import { prisma } from "@/lib/db";

export interface OrderRecord {
  id: string;
  normalizedOrderRef: string;
}

export interface TransactionRecord {
  id: string;
  transactionRef: string;
  normalizedTransactionRef: string;
  orderId: string | null;
  normalizedOrderRefOnPayment: string | null;
  amount: number;
}

export interface SettlementRecord {
  id: string;
  transactionRefOnSettlement: string | null;
  normalizedTransactionRefOnSettlement: string | null;
  grossAmount: number;
}

export interface ExactMatch {
  transactionId: string;
  settlementId: string;
  matchPriority: 1 | 2 | 3;
  amountOk: boolean;
  grossVsPaymentDiff: number;
}

export interface DuplicateGroup {
  matchPriority: 1 | 2 | 3;
  referenceValue: string;
  transactionIds: string[];
  settlementIds: string[];
}

export interface ExactMatchResult {
  matches: ExactMatch[];
  duplicates: DuplicateGroup[];
  unresolvedTransactionIds: string[];
  unresolvedSettlementIds: string[];
}

function groupBy<T>(items: T[], keyFn: (item: T) => string | null): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    const group = map.get(key);
    if (group) group.push(item);
    else map.set(key, [item]);
  }
  return map;
}

// Payment vs settlement GROSS, never net — Section 6 Stage 3. Comparing to net
// would misclassify every legitimate gateway fee as a mismatch.
const AMOUNT_TOLERANCE = 0.01;

function checkAmount(transaction: TransactionRecord, settlement: SettlementRecord) {
  const diff = Math.round((settlement.grossAmount - transaction.amount) * 100) / 100;
  return { amountOk: Math.abs(diff) <= AMOUNT_TOLERANCE, grossVsPaymentDiff: diff };
}

// Links a transaction to its order by exact normalized order-reference match,
// only where the transaction isn't already linked and exactly one order candidate
// exists. Feeds Priority 3 below. Returns transactionId -> orderId.
export function linkTransactionsToOrders(
  orders: OrderRecord[],
  transactions: TransactionRecord[],
): Map<string, string> {
  const ordersByRef = groupBy(orders, (o) => o.normalizedOrderRef);
  const links = new Map<string, string>();
  for (const t of transactions) {
    if (t.orderId || !t.normalizedOrderRefOnPayment) continue;
    const candidates = ordersByRef.get(t.normalizedOrderRefOnPayment);
    if (candidates && candidates.length === 1) links.set(t.id, candidates[0].id);
  }
  return links;
}

export function runExactMatching(
  orders: OrderRecord[],
  transactions: TransactionRecord[],
  settlements: SettlementRecord[],
): ExactMatchResult {
  const matches: ExactMatch[] = [];
  const duplicates: DuplicateGroup[] = [];
  const matchedTransactionIds = new Set<string>();
  const matchedSettlementIds = new Set<string>();

  const availableTransactions = () => transactions.filter((t) => !matchedTransactionIds.has(t.id));
  const availableSettlements = () => settlements.filter((s) => !matchedSettlementIds.has(s.id));

  // Grouping (rather than greedy first-match) is what lets this catch both
  // directions of ambiguity: one settlement with several transaction candidates,
  // or several settlements all claiming the same transaction (Section 6, rule 4).
  function resolveByKey(
    priority: 1 | 2 | 3,
    settlementKeyFn: (s: SettlementRecord) => string | null,
    transactionKeyFn: (t: TransactionRecord) => string | null,
  ) {
    const settlementsByKey = groupBy(availableSettlements(), settlementKeyFn);
    const transactionsByKey = groupBy(availableTransactions(), transactionKeyFn);

    for (const [key, candidateSettlements] of settlementsByKey) {
      const candidateTransactions = transactionsByKey.get(key) ?? [];
      if (candidateTransactions.length === 0) continue; // nothing at this priority — try the next one

      if (candidateSettlements.length === 1 && candidateTransactions.length === 1) {
        const transaction = candidateTransactions[0];
        const settlement = candidateSettlements[0];
        const { amountOk, grossVsPaymentDiff } = checkAmount(transaction, settlement);
        matches.push({ transactionId: transaction.id, settlementId: settlement.id, matchPriority: priority, amountOk, grossVsPaymentDiff });
        matchedTransactionIds.add(transaction.id);
        matchedSettlementIds.add(settlement.id);
      } else {
        duplicates.push({
          matchPriority: priority,
          referenceValue: key,
          transactionIds: candidateTransactions.map((t) => t.id),
          settlementIds: candidateSettlements.map((s) => s.id),
        });
        for (const t of candidateTransactions) matchedTransactionIds.add(t.id);
        for (const s of candidateSettlements) matchedSettlementIds.add(s.id);
      }
    }
  }

  // Priority 1 — raw transaction ID exact match
  resolveByKey(1, (s) => s.transactionRefOnSettlement, (t) => t.transactionRef);

  // Priority 2 — normalized settlement transaction reference exact match
  resolveByKey(2, (s) => s.normalizedTransactionRefOnSettlement, (t) => t.normalizedTransactionRef);

  // Priority 3 — normalized order reference exact match. Settlements don't carry
  // an order ref field directly; some gateways record the merchant's order id
  // where we'd expect their own transaction id, so fall back through the
  // transaction's linked order.
  const orderById = new Map(orders.map((o) => [o.id, o]));
  resolveByKey(
    3,
    (s) => s.normalizedTransactionRefOnSettlement,
    (t) => (t.orderId ? orderById.get(t.orderId)?.normalizedOrderRef ?? null : null),
  );

  return {
    matches,
    duplicates,
    unresolvedTransactionIds: availableTransactions().map((t) => t.id),
    unresolvedSettlementIds: availableSettlements().map((s) => s.id),
  };
}

function severityForAmountDiff(absDiff: number): "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" {
  if (absDiff >= 1000) return "CRITICAL";
  if (absDiff >= 300) return "HIGH";
  if (absDiff >= 50) return "MEDIUM";
  return "LOW";
}

// DB orchestrator — fetches everything not yet reconciled, runs the pure logic
// above, and persists MATCHED / AMOUNT_MISMATCH / DUPLICATE_TRANSACTION outcomes.
// Anything left unresolved is intentionally not written here; matching.ts (Day 2)
// owns turning "still unresolved after fuzzy matching" into MISSING_SETTLEMENT /
// MISSING_PAYMENT / PENDING_TRANSACTION.
export async function runExactMatchReconciliation(): Promise<ExactMatchResult> {
  const [orders, dbTransactions, dbSettlements] = await Promise.all([
    prisma.order.findMany(),
    // FAILED payments never expect a settlement — excluded here so they don't
    // compete for a match; exceptions.ts's final pass skips them entirely.
    prisma.transaction.findMany({ where: { reconciliationResult: null, status: { not: "FAILED" } } }),
    prisma.settlement.findMany({ where: { reconciliationResult: null } }),
  ]);

  const orderRecords: OrderRecord[] = orders.map((o) => ({ id: o.id, normalizedOrderRef: o.normalizedOrderRef }));
  const transactionRecords: TransactionRecord[] = dbTransactions.map((t) => ({
    id: t.id,
    transactionRef: t.transactionRef,
    normalizedTransactionRef: t.normalizedTransactionRef,
    orderId: t.orderId,
    normalizedOrderRefOnPayment: t.normalizedOrderRefOnPayment,
    amount: Number(t.amount),
  }));
  const settlementRecords: SettlementRecord[] = dbSettlements.map((s) => ({
    id: s.id,
    transactionRefOnSettlement: s.transactionRefOnSettlement,
    normalizedTransactionRefOnSettlement: s.normalizedTransactionRefOnSettlement,
    grossAmount: Number(s.grossAmount),
  }));

  const newOrderLinks = linkTransactionsToOrders(orderRecords, transactionRecords);
  for (const [transactionId, orderId] of newOrderLinks) {
    await prisma.transaction.update({ where: { id: transactionId }, data: { orderId } });
    const t = transactionRecords.find((t) => t.id === transactionId);
    if (t) t.orderId = orderId;
  }

  const result = runExactMatching(orderRecords, transactionRecords, settlementRecords);

  for (const m of result.matches) {
    const reconciliation = await prisma.reconciliationResult.create({
      data: {
        transactionId: m.transactionId,
        settlementId: m.settlementId,
        matchStatus: m.amountOk ? "MATCHED" : "AMOUNT_MISMATCH",
        reviewStatus: "NOT_REQUIRED",
        confidence: 100,
        referenceSimilarity: 100,
        amountSimilarity: m.amountOk ? 100 : 0,
      },
    });
    if (!m.amountOk) {
      const absDiff = Math.abs(m.grossVsPaymentDiff);
      await prisma.financeException.create({
        data: {
          reconciliationResultId: reconciliation.id,
          exceptionType: "AMOUNT_MISMATCH",
          severity: severityForAmountDiff(absDiff),
          description: `Settlement gross amount is ₹${absDiff.toFixed(2)} ${m.grossVsPaymentDiff > 0 ? "higher than" : "lower than"} the payment amount, unexplained by fee/tax.`,
        },
      });
    }
  }

  for (const dup of result.duplicates) {
    const description = `Reference "${dup.referenceValue}" matches ${dup.transactionIds.length} transaction(s) and ${dup.settlementIds.length} settlement(s) at priority ${dup.matchPriority} — cannot auto-match, needs manual review.`;
    for (const settlementId of dup.settlementIds) {
      const reconciliation = await prisma.reconciliationResult.create({
        data: { settlementId, matchStatus: "UNMATCHED", reviewStatus: "NOT_REQUIRED", confidence: 0 },
      });
      await prisma.financeException.create({
        data: { reconciliationResultId: reconciliation.id, exceptionType: "DUPLICATE_TRANSACTION", severity: "HIGH", description },
      });
    }
    for (const transactionId of dup.transactionIds) {
      const reconciliation = await prisma.reconciliationResult.create({
        data: { transactionId, matchStatus: "UNMATCHED", reviewStatus: "NOT_REQUIRED", confidence: 0 },
      });
      await prisma.financeException.create({
        data: { reconciliationResultId: reconciliation.id, exceptionType: "DUPLICATE_TRANSACTION", severity: "HIGH", description },
      });
    }
  }

  return result;
}
