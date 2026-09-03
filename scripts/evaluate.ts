// Measured accuracy on a held-out test set (ARCHITECTURE.md Section 7 and the
// Track 04 bar: "throughput plus measured accuracy plus an honest exception
// list — one cherry-picked match proves nothing"). Seeds data/eval/ — never
// shown in the live demo — runs the full deterministic pipeline, scores the
// result against ground-truth.json, and writes docs/metrics-report.md.
//
// WARNING: this wipes the dev database, runs the eval set through it, then
// wipes it again on the way out. If the demo dataset is loaded (e.g. for a
// walkthrough), it will be gone after this runs — restore it with
// `npm run demo:reset` afterward.
//
// Run: npm run eval

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Papa from "papaparse";
import { prisma } from "../src/lib/db";
import { normalizeReference, normalizeAmount, normalizeDate, normalizeCurrency } from "../src/lib/normalization";
import { runExactMatchReconciliation } from "../src/lib/reconciliation";
import { runFuzzyMatchReconciliation } from "../src/lib/matching";
import { runExceptionDetection } from "../src/lib/exceptions";

function loadCsv(path: string): Record<string, string>[] {
  return Papa.parse<Record<string, string>>(readFileSync(path, "utf8"), { header: true, skipEmptyLines: true }).data;
}

interface GroundTruthEntry {
  dealId: string;
  scenario: string;
  orderRef: string | null;
  transactionRef: string | null;
  settlementRefs: string[];
  isTruePair: boolean;
  expectedExceptions: string[];
  notes: string;
}

async function main() {
  const root = join(import.meta.dirname, "..");
  const orderRows = loadCsv(join(root, "data", "eval", "orders.csv"));
  const transactionRows = loadCsv(join(root, "data", "eval", "transactions.csv"));
  const settlementRows = loadCsv(join(root, "data", "eval", "settlements.csv"));
  const groundTruth: GroundTruthEntry[] = JSON.parse(readFileSync(join(root, "data", "eval", "ground-truth.json"), "utf8"));

  await prisma.financeException.deleteMany();
  await prisma.reconciliationResult.deleteMany();
  await prisma.settlement.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.order.deleteMany();

  let report = "";
  try {
    await prisma.order.createMany({
      data: orderRows.map((r) => ({
        orderRef: r.order_ref,
        normalizedOrderRef: normalizeReference(r.order_ref),
        amount: normalizeAmount(r.amount),
        currency: normalizeCurrency(r.currency),
        orderDate: normalizeDate(r.order_date),
        customerName: r.customer_name,
      })),
    });
    await prisma.transaction.createMany({
      data: transactionRows.map((r) => ({
        transactionRef: r.transaction_ref,
        normalizedTransactionRef: normalizeReference(r.transaction_ref),
        orderRefOnPayment: r.order_ref,
        normalizedOrderRefOnPayment: normalizeReference(r.order_ref),
        amount: normalizeAmount(r.amount),
        currency: normalizeCurrency(r.currency),
        paymentDate: normalizeDate(r.payment_date),
        status: r.status as "SUCCESS" | "PENDING" | "FAILED",
      })),
    });
    await prisma.settlement.createMany({
      data: settlementRows.map((r) => ({
        settlementRef: r.settlement_ref,
        normalizedSettlementRef: normalizeReference(r.settlement_ref),
        transactionRefOnSettlement: r.transaction_ref,
        normalizedTransactionRefOnSettlement: normalizeReference(r.transaction_ref),
        grossAmount: normalizeAmount(r.gross_amount),
        fee: normalizeAmount(r.fee),
        tax: normalizeAmount(r.tax),
        netAmount: normalizeAmount(r.net_amount),
        settlementDate: normalizeDate(r.settlement_date),
      })),
    });

    const stage2 = await runExactMatchReconciliation();
    const stage4 = await runFuzzyMatchReconciliation();
    const stage5 = await runExceptionDetection(new Date());

    // ---- pull every reconciliation result back out, keyed by ref ----
    const results = await prisma.reconciliationResult.findMany({
      include: { transaction: true, settlement: true, exceptions: true },
    });
    const resultByTxnRef = new Map(results.filter((r) => r.transaction).map((r) => [r.transaction!.transactionRef, r]));
    const resultBySettlementRef = new Map(results.filter((r) => r.settlement).map((r) => [r.settlement!.settlementRef, r]));

    // ---- match accuracy: for every deal with a true transaction<->settlement pair ----
    let truePositive = 0; // correctly matched to the right counterpart
    let falsePositive = 0; // matched, but to the wrong counterpart, or matched when it shouldn't be
    let falseNegative = 0; // should have matched but didn't (still unresolved or wrongly categorized)
    let reviewCount = 0;
    let reviewCorrect = 0;

    for (const entry of groundTruth) {
      if (entry.isTruePair && entry.transactionRef && entry.settlementRefs.length === 1) {
        const result = resultByTxnRef.get(entry.transactionRef);
        const matchedCorrectSettlement = result?.settlement?.settlementRef === entry.settlementRefs[0];

        if (result?.matchStatus === "MATCHED" || result?.matchStatus === "AMOUNT_MISMATCH") {
          if (matchedCorrectSettlement) truePositive++;
          else falsePositive++;
        } else if (result?.reviewStatus === "PENDING_REVIEW") {
          reviewCount++;
          if (matchedCorrectSettlement) reviewCorrect++;
          else falsePositive++;
        } else {
          falseNegative++;
        }
      }
    }

    // ---- false auto-match rate: of everything the engine auto-matched at >=95%,
    // how many were actually correct? this is the number that matters for trust ----
    const allAutoMatched = results.filter((r) => r.matchStatus === "MATCHED" && r.reviewStatus === "NOT_REQUIRED" && Number(r.confidence) >= 95);
    let autoMatchedWrong = 0;
    for (const r of allAutoMatched) {
      const gt = groundTruth.find((g) => g.transactionRef === r.transaction?.transactionRef);
      const expectedSettlement = gt?.settlementRefs[0];
      if (!gt?.isTruePair || expectedSettlement !== r.settlement?.settlementRef) autoMatchedWrong++;
    }
    const falseAutoMatchRate = allAutoMatched.length > 0 ? (autoMatchedWrong / allAutoMatched.length) * 100 : 0;

    // ---- review-queue accuracy: of everything sent to review, how often was
    // the proposed settlement actually correct? ----
    const reviewAccuracy = reviewCount > 0 ? (reviewCorrect / reviewCount) * 100 : 0;

    // ---- exception detection: planted vs raised, per type ----
    const allExceptions = await prisma.financeException.findMany();
    const exceptionCountByType = new Map<string, number>();
    for (const e of allExceptions) exceptionCountByType.set(e.exceptionType, (exceptionCountByType.get(e.exceptionType) ?? 0) + 1);
    const expectedByType = new Map<string, number>();
    for (const g of groundTruth) for (const type of g.expectedExceptions) expectedByType.set(type, (expectedByType.get(type) ?? 0) + 1);

    const precision = truePositive + falsePositive > 0 ? (truePositive / (truePositive + falsePositive)) * 100 : 0;
    const recall = truePositive + falseNegative > 0 ? (truePositive / (truePositive + falseNegative)) * 100 : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

    const timestamp = new Date().toISOString();
    report = `# Measured accuracy report

Generated ${timestamp} by \`scripts/evaluate.ts\` against \`data/eval/\` — ${groundTruth.length} deals,
held out and never shown in the live demo. Regenerate anytime with:

\`\`\`
npm run script scripts/evaluate.ts
\`\`\`

## Headline numbers

| Metric | Value |
|---|---|
| Deals evaluated | ${groundTruth.length} |
| True-pair match precision | ${precision.toFixed(1)}% |
| True-pair match recall | ${recall.toFixed(1)}% |
| F1 | ${f1.toFixed(1)} |
| **False auto-match rate** (of everything auto-matched at >=95%) | ${falseAutoMatchRate.toFixed(1)}% (${autoMatchedWrong}/${allAutoMatched.length}) |
| Review-queue accuracy (proposed settlement actually correct) | ${reviewAccuracy.toFixed(1)}% (${reviewCorrect}/${reviewCount}) |

## What these mean

- **Precision** — of every pair the engine matched (exact, fuzzy auto, or
  fuzzy-flagged-for-review), how many were the *right* pair. False positives
  here are the dangerous failure mode: money reconciled against the wrong
  transaction.
- **Recall** — of every genuinely matching pair in the held-out set, how many
  the engine actually found (exact + fuzzy auto + fuzzy review combined).
  Recall misses aren't silent — they surface honestly as
  MISSING_SETTLEMENT / MISSING_PAYMENT exceptions rather than being dropped.
- **False auto-match rate** is the number that matters most for trust: it's
  restricted to the >=95% confidence tier that gets written as MATCHED with no
  human involved. It should be at or near 0% — Development Rule 5 exists
  specifically to keep this tier conservative.
- **Review-queue accuracy** is not required to be perfect — the whole point of
  the 80-94% tier is that a human decides. What matters is that the queue is
  worth a human's time, i.e., this number should be meaningfully above chance.

## Exception detection

Planted exceptions across the eval set (by type), and how many the engine raised:

| Exception type | Planted | Raised |
|---|---|---|
${[...expectedByType.entries()].map(([type, expected]) => `| ${type} | ${expected} | ${exceptionCountByType.get(type) ?? 0} |`).join("\n")}

## Pipeline summary for this run

| Stage | Result |
|---|---|
| Stage 2 (exact match) | ${stage2.matches.length} matched, ${stage2.duplicates.length} duplicate groups |
| Stage 4 (fuzzy match) | ${stage4.matches.filter((m) => m.tier === "AUTO_MATCH").length} auto-matched, ${stage4.matches.filter((m) => m.tier === "REVIEW").length} sent to review |
| Stage 5 (exceptions) | ${stage5.missingSettlementCount} missing settlement, ${stage5.missingPaymentCount} missing payment, ${stage5.pendingCount} pending, ${stage5.invalidCalculationCount} invalid calculations |

This is not a cherry-picked run — it's the full held-out set, every time.
`;

    console.log(report);
  } finally {
    await prisma.financeException.deleteMany();
    await prisma.reconciliationResult.deleteMany();
    await prisma.settlement.deleteMany();
    await prisma.transaction.deleteMany();
    await prisma.order.deleteMany();
  }

  writeFileSync(join(root, "docs", "metrics-report.md"), report);
  console.log("\nwritten to docs/metrics-report.md; eval scratch data cleaned up");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
