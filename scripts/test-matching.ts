// Manual verification for confidence.ts + matching.ts.
// Part A: hand-written edge cases, including the worked example from
// ARCHITECTURE.md Section 7 (Reference 95%, Amount 100%, Date 90% -> 95.5%).
// Part B: full pipeline on data/eval/ — run Stage 2 first, feed its leftovers
// into Stage 4, and check the fuzzy/borderline deals actually get recovered
// while genuinely-missing deals are correctly left alone.
//
// Run: npm run script scripts/test-matching.ts

import { readFileSync } from "node:fs";
import { join } from "node:path";
import Papa from "papaparse";
import { normalizeReference, normalizeAmount, normalizeDate } from "../src/lib/normalization";
import { runExactMatching, linkTransactionsToOrders, type OrderRecord } from "../src/lib/reconciliation";
import {
  runFuzzyMatching,
  referenceSimilarity,
  amountSimilarity,
  dateSimilarity,
  type FuzzyTransaction,
  type FuzzySettlement,
} from "../src/lib/matching";
import { computeConfidence, decideTier } from "../src/lib/confidence";

let pass = 0;
let fail = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++;
  else {
    fail++;
    console.error(`FAIL: ${label}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  }
}

// ============================================================
// Part A — hand-crafted fixtures
// ============================================================

check("identical refs => 100 similarity", referenceSimilarity("txn100000", "txn100000"), 100);
check("1-char diff out of 9 => 89", referenceSimilarity("txn100000", "txn100001"), 89);
check("completely different refs => low similarity", referenceSimilarity("txn100000", "zzzzzzzzz") < 30, true);
check("empty vs empty => 100", referenceSimilarity("", ""), 100);

check("equal amounts => 100", amountSimilarity(1000, 1000), 100);
check("small relative diff reduces similarity", amountSimilarity(1000, 995) < 100 && amountSimilarity(1000, 995) > 80, true);
check("large relative diff => 0", amountSimilarity(1000, 100), 0);

check("within settlement window => 100", dateSimilarity(new Date("2026-06-01"), new Date("2026-06-04")), 100);
check("well beyond window => low", dateSimilarity(new Date("2026-06-01"), new Date("2026-06-20")) < 20, true);

// worked example from ARCHITECTURE.md Section 7
check("Section 7 worked example", computeConfidence(95, 100, 90), 95.5);

check("95 => AUTO_MATCH", decideTier(95), "AUTO_MATCH");
check("94.99 => REVIEW", decideTier(94.99), "REVIEW");
check("80 => REVIEW", decideTier(80), "REVIEW");
check("79.99 => UNMATCHED", decideTier(79.99), "UNMATCHED");

{
  // runFuzzyMatching: strongest pair should win even if processed later
  const transactions: FuzzyTransaction[] = [
    { id: "T1", normalizedTransactionRef: "txn100000", amount: 1000, paymentDate: new Date("2026-06-01") },
    { id: "T2", normalizedTransactionRef: "txn200000", amount: 2000, paymentDate: new Date("2026-06-01") },
  ];
  const settlements: FuzzySettlement[] = [
    // both settlements are plausible for T1, but S1 is a near-perfect match
    { id: "S1", normalizedTransactionRefOnSettlement: "txn100000", grossAmount: 1000, settlementDate: new Date("2026-06-03") },
    { id: "S2", normalizedTransactionRefOnSettlement: "txn100001", grossAmount: 1000, settlementDate: new Date("2026-06-03") },
    { id: "S3", normalizedTransactionRefOnSettlement: "txn200000", grossAmount: 2000, settlementDate: new Date("2026-06-03") },
  ];
  const result = runFuzzyMatching(transactions, settlements);
  const t1Match = result.matches.find((m) => m.transactionId === "T1");
  check("T1 claimed its exact-ref settlement, not the near-miss", t1Match?.settlementId, "S1");
  check("T2 matched its own settlement", result.matches.find((m) => m.transactionId === "T2")?.settlementId, "S3");
  check("no leftover settlement double-claimed", result.unresolvedSettlementIds, ["S2"]);
}

// ============================================================
// Part B — full pipeline on data/eval/
// ============================================================

function loadCsv(path: string): Record<string, string>[] {
  return Papa.parse<Record<string, string>>(readFileSync(path, "utf8"), { header: true, skipEmptyLines: true }).data;
}

const root = join(import.meta.dirname, "..");
const orderRows = loadCsv(join(root, "data", "eval", "orders.csv"));
const transactionRows = loadCsv(join(root, "data", "eval", "transactions.csv"));
const settlementRows = loadCsv(join(root, "data", "eval", "settlements.csv"));
const groundTruth: {
  dealId: string;
  scenario: string;
  transactionRef: string | null;
  settlementRefs: string[];
  isTruePair: boolean;
}[] = JSON.parse(readFileSync(join(root, "data", "eval", "ground-truth.json"), "utf8"));

const orders: OrderRecord[] = orderRows.map((r) => ({ id: r.order_ref, normalizedOrderRef: normalizeReference(r.order_ref) }));
const stage2Transactions = transactionRows
  .filter((r) => r.status !== "PENDING")
  .map((r) => ({
    id: r.transaction_ref,
    transactionRef: r.transaction_ref,
    normalizedTransactionRef: normalizeReference(r.transaction_ref),
    orderId: null as string | null,
    normalizedOrderRefOnPayment: normalizeReference(r.order_ref),
    amount: normalizeAmount(r.amount),
    paymentDate: normalizeDate(r.payment_date),
  }));
const stage2Settlements = settlementRows.map((r) => ({
  id: r.settlement_ref,
  transactionRefOnSettlement: r.transaction_ref,
  normalizedTransactionRefOnSettlement: normalizeReference(r.transaction_ref),
  grossAmount: normalizeAmount(r.gross_amount),
  settlementDate: normalizeDate(r.settlement_date),
}));

const links = linkTransactionsToOrders(orders, stage2Transactions);
for (const t of stage2Transactions) t.orderId = links.get(t.id) ?? null;

const stage2Result = runExactMatching(orders, stage2Transactions, stage2Settlements);

const stage2TxnById = new Map(stage2Transactions.map((t) => [t.id, t]));
const stage2StlById = new Map(stage2Settlements.map((s) => [s.id, s]));

const fuzzyTransactions: FuzzyTransaction[] = stage2Result.unresolvedTransactionIds.map((id) => {
  const t = stage2TxnById.get(id)!;
  return { id: t.id, normalizedTransactionRef: t.normalizedTransactionRef, amount: t.amount, paymentDate: t.paymentDate };
});
const fuzzySettlements: FuzzySettlement[] = stage2Result.unresolvedSettlementIds.map((id) => {
  const s = stage2StlById.get(id)!;
  return { id: s.id, normalizedTransactionRefOnSettlement: s.normalizedTransactionRefOnSettlement, grossAmount: s.grossAmount, settlementDate: s.settlementDate };
});

const stage4Result = runFuzzyMatching(fuzzyTransactions, fuzzySettlements);
const stage4MatchedTxnIds = new Set(stage4Result.matches.map((m) => m.transactionId));
const stage4MatchedStlIds = new Set(stage4Result.matches.map((m) => m.settlementId));
const stillUnresolvedTxn = new Set(stage4Result.unresolvedTransactionIds);
const stillUnresolvedStl = new Set(stage4Result.unresolvedSettlementIds);

let checkedDeals = 0;
let borderlineTotal = 0;
let borderlineRecovered = 0;
for (const entry of groundTruth) {
  if (entry.scenario === "FUZZY_CLOSE" || entry.scenario === "FUZZY_BORDERLINE") {
    // must have reached Stage 4 unresolved from Stage 2
    const reachedStage4 = stage2Result.unresolvedTransactionIds.includes(entry.transactionRef!);
    check(`${entry.dealId} (${entry.scenario}) reached Stage 4`, reachedStage4, true);

    const matched = stage4Result.matches.find((m) => m.transactionId === entry.transactionRef);
    if (matched) {
      // precision matters more than recall here: whatever DOES get matched must
      // be matched to the right settlement, never a coincidentally-similar one
      check(`${entry.dealId} (${entry.scenario}) matched to the correct settlement`, matched.settlementId, entry.settlementRefs[0]);
    }
    // FUZZY_CLOSE (1-digit typo) should reliably recover. FUZZY_BORDERLINE
    // (2-digit typo + shifted date) is deliberately marginal — some are
    // expected to legitimately fall below the review threshold.
    if (entry.scenario === "FUZZY_CLOSE") {
      check(`${entry.dealId} (FUZZY_CLOSE) recovered by fuzzy matching`, matched !== undefined, true);
    } else {
      borderlineTotal++;
      if (matched) borderlineRecovered++;
    }
    checkedDeals++;
  } else if (entry.scenario === "MISSING_SETTLEMENT") {
    check(`${entry.dealId} (MISSING_SETTLEMENT) still unresolved after fuzzy stage`, stillUnresolvedTxn.has(entry.transactionRef!), true);
    checkedDeals++;
  } else if (entry.scenario === "MISSING_PAYMENT") {
    check(`${entry.dealId} (MISSING_PAYMENT) still unresolved after fuzzy stage`, stillUnresolvedStl.has(entry.settlementRefs[0]), true);
    checkedDeals++;
  }
}

console.log(`\ncross-checked ${checkedDeals} real deals from data/eval/`);
console.log(`FUZZY_BORDERLINE recovery: ${borderlineRecovered}/${borderlineTotal} (deliberately marginal — not all expected to recover)`);
console.log(`stage 4 input: ${fuzzyTransactions.length} transactions, ${fuzzySettlements.length} settlements`);
console.log(`stage 4 resolved: ${stage4Result.matches.length} (${stage4Result.matches.filter((m) => m.tier === "AUTO_MATCH").length} auto, ${stage4Result.matches.filter((m) => m.tier === "REVIEW").length} review)`);
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
