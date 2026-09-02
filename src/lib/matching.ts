// Stage 4 — fuzzy matching (ARCHITECTURE.md Section 6/7). Picks up whatever
// reconciliation.ts (Stage 2/3) couldn't resolve by exact reference and scores
// every remaining transaction/settlement pair on reference + amount + date
// similarity. Only pairs scoring >=80 are recorded here; anything left is
// deferred to exceptions.ts, which makes the final MISSING_SETTLEMENT /
// MISSING_PAYMENT / PENDING_TRANSACTION call once fuzzy matching has also failed.

import { prisma } from "@/lib/db";
import { computeConfidence, decideTier } from "@/lib/confidence";

export interface FuzzyTransaction {
  id: string;
  normalizedTransactionRef: string;
  amount: number;
  paymentDate: Date;
}

export interface FuzzySettlement {
  id: string;
  normalizedTransactionRefOnSettlement: string | null;
  grossAmount: number;
  settlementDate: Date;
}

export interface FuzzyMatch {
  transactionId: string;
  settlementId: string;
  confidence: number;
  referenceSimilarity: number;
  amountSimilarity: number;
  dateSimilarity: number;
  tier: "AUTO_MATCH" | "REVIEW";
}

export interface FuzzyMatchResult {
  matches: FuzzyMatch[];
  unresolvedTransactionIds: string[];
  unresolvedSettlementIds: string[];
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  let curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

export function referenceSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 100;
  const distance = levenshtein(a, b);
  return Math.max(0, Math.round((1 - distance / maxLen) * 100));
}

// Amount noise at this stage comes from data-entry drift, not fees — Stage 3
// already handles fee-adjusted comparison for exact-reference pairs. Deliberately
// steep: with dozens of unresolved candidates in a batch, a lenient curve lets
// amount+date coincidence alone drag an unrelated pair over the review threshold
// even when the reference barely matches (caught via data/eval/ cross-check —
// an orphan settlement was spuriously "recovered" against a random leftover
// transaction that just happened to be a similar amount on a similar date).
// A relative gap of 5% or more is treated as no similarity at all.
export function amountSimilarity(a: number, b: number): number {
  if (a === 0 && b === 0) return 100;
  const diff = Math.abs(a - b);
  const base = Math.max(Math.abs(a), Math.abs(b), 0.01);
  const relDiff = diff / base;
  return Math.max(0, Math.round(100 - relDiff * 2000));
}

function daysBetween(a: Date, b: Date): number {
  return Math.abs(Math.round((a.getTime() - b.getTime()) / 86_400_000));
}

// A settlement lands 2-4 days after payment in the normal case; that whole
// window scores full similarity, then similarity drops with each extra day.
export function dateSimilarity(paymentDate: Date, settlementDate: Date): number {
  const days = daysBetween(paymentDate, settlementDate);
  if (days <= 4) return 100;
  return Math.max(0, Math.round(100 - (days - 4) * 15));
}

interface Candidate {
  transaction: FuzzyTransaction;
  settlement: FuzzySettlement;
  confidence: number;
  referenceSimilarity: number;
  amountSimilarity: number;
  dateSimilarity: number;
}

// Scores every remaining pair, then claims pairs greedily in descending
// confidence order — so the strongest matches in the whole batch win first,
// not just the best available to whichever transaction happens to be
// processed first. Pairs below 80 are never claimed; both sides stay
// available for exceptions.ts to evaluate.
export function runFuzzyMatching(
  transactions: FuzzyTransaction[],
  settlements: FuzzySettlement[],
): FuzzyMatchResult {
  const candidates: Candidate[] = [];
  for (const t of transactions) {
    for (const s of settlements) {
      const refSim = referenceSimilarity(t.normalizedTransactionRef, s.normalizedTransactionRefOnSettlement ?? "");
      const amtSim = amountSimilarity(t.amount, s.grossAmount);
      const dateSim = dateSimilarity(t.paymentDate, s.settlementDate);
      const confidence = computeConfidence(refSim, amtSim, dateSim);
      if (decideTier(confidence) === "UNMATCHED") continue;
      candidates.push({ transaction: t, settlement: s, confidence, referenceSimilarity: refSim, amountSimilarity: amtSim, dateSimilarity: dateSim });
    }
  }

  candidates.sort((a, b) => b.confidence - a.confidence);

  const matches: FuzzyMatch[] = [];
  const claimedTransactions = new Set<string>();
  const claimedSettlements = new Set<string>();

  for (const c of candidates) {
    if (claimedTransactions.has(c.transaction.id) || claimedSettlements.has(c.settlement.id)) continue;
    const tier = decideTier(c.confidence) as "AUTO_MATCH" | "REVIEW";
    matches.push({
      transactionId: c.transaction.id,
      settlementId: c.settlement.id,
      confidence: c.confidence,
      referenceSimilarity: c.referenceSimilarity,
      amountSimilarity: c.amountSimilarity,
      dateSimilarity: c.dateSimilarity,
      tier,
    });
    claimedTransactions.add(c.transaction.id);
    claimedSettlements.add(c.settlement.id);
  }

  return {
    matches,
    unresolvedTransactionIds: transactions.filter((t) => !claimedTransactions.has(t.id)).map((t) => t.id),
    unresolvedSettlementIds: settlements.filter((s) => !claimedSettlements.has(s.id)).map((s) => s.id),
  };
}

// DB orchestrator — mirrors reconciliation.ts's pattern. Only touches
// transactions/settlements reconciliation.ts left without a result.
export async function runFuzzyMatchReconciliation(): Promise<FuzzyMatchResult> {
  const [dbTransactions, dbSettlements] = await Promise.all([
    prisma.transaction.findMany({ where: { reconciliationResult: null } }),
    prisma.settlement.findMany({ where: { reconciliationResult: null } }),
  ]);

  const transactions: FuzzyTransaction[] = dbTransactions.map((t) => ({
    id: t.id,
    normalizedTransactionRef: t.normalizedTransactionRef,
    amount: Number(t.amount),
    paymentDate: t.paymentDate,
  }));
  const settlements: FuzzySettlement[] = dbSettlements.map((s) => ({
    id: s.id,
    normalizedTransactionRefOnSettlement: s.normalizedTransactionRefOnSettlement,
    grossAmount: Number(s.grossAmount),
    settlementDate: s.settlementDate,
  }));

  const result = runFuzzyMatching(transactions, settlements);

  for (const m of result.matches) {
    await prisma.reconciliationResult.create({
      data: {
        transactionId: m.transactionId,
        settlementId: m.settlementId,
        matchStatus: m.tier === "AUTO_MATCH" ? "MATCHED" : "UNMATCHED",
        reviewStatus: m.tier === "AUTO_MATCH" ? "NOT_REQUIRED" : "PENDING_REVIEW",
        confidence: m.confidence,
        referenceSimilarity: m.referenceSimilarity,
        amountSimilarity: m.amountSimilarity,
        dateSimilarity: m.dateSimilarity,
      },
    });
  }

  return result;
}
