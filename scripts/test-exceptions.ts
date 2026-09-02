// Manual verification for exceptions.ts, plus the first full end-to-end run of
// all three stages together (reconciliation.ts -> matching.ts -> exceptions.ts)
// against a real Postgres database, seeded from data/eval/. Cleans up after
// itself so the dev DB is left empty for the actual app.
//
// Run: npm run script scripts/test-exceptions.ts

import { readFileSync } from "node:fs";
import { join } from "node:path";
import Papa from "papaparse";
import { prisma } from "../src/lib/db";
import { normalizeReference, normalizeAmount, normalizeDate, normalizeCurrency } from "../src/lib/normalization";
import { runExactMatchReconciliation } from "../src/lib/reconciliation";
import { runFuzzyMatchReconciliation } from "../src/lib/matching";
import {
  runExceptionDetection,
  classifyUnresolvedTransaction,
  classifyUnresolvedSettlement,
  checkSettlementCalculation,
} from "../src/lib/exceptions";

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

const NOW = new Date("2026-09-02T00:00:00.000Z");

check("FAILED transaction produces no outcome", classifyUnresolvedTransaction({ status: "FAILED", paymentDate: NOW }, NOW), null);
check(
  "SUCCESS transaction -> MISSING_SETTLEMENT",
  classifyUnresolvedTransaction({ status: "SUCCESS", paymentDate: NOW }, NOW)?.exceptionType,
  "MISSING_SETTLEMENT",
);
check(
  "PENDING transaction -> PENDING_TRANSACTION",
  classifyUnresolvedTransaction({ status: "PENDING", paymentDate: NOW }, NOW)?.exceptionType,
  "PENDING_TRANSACTION",
);
{
  const oldDate = new Date(NOW.getTime() - 35 * 86_400_000);
  check("35 days overdue -> CRITICAL", classifyUnresolvedTransaction({ status: "SUCCESS", paymentDate: oldDate }, NOW)?.severity, "CRITICAL");
}
{
  const recent = new Date(NOW.getTime() - 2 * 86_400_000);
  check("2 days overdue -> LOW", classifyUnresolvedTransaction({ status: "SUCCESS", paymentDate: recent }, NOW)?.severity, "LOW");
}
check(
  "orphan settlement -> MISSING_PAYMENT",
  classifyUnresolvedSettlement({ settlementDate: NOW }, NOW).exceptionType,
  "MISSING_PAYMENT",
);

check("correct arithmetic passes", checkSettlementCalculation({ grossAmount: 1000, fee: 20, tax: 3.6, netAmount: 976.4 }).ok, true);
check("broken arithmetic fails", checkSettlementCalculation({ grossAmount: 1000, fee: 20, tax: 3.6, netAmount: 900 }).ok, false);

// ============================================================
// Part B — full pipeline against a real Postgres database
// ============================================================

function loadCsv(path: string): Record<string, string>[] {
  return Papa.parse<Record<string, string>>(readFileSync(path, "utf8"), { header: true, skipEmptyLines: true }).data;
}

async function main() {
  const root = join(import.meta.dirname, "..");
  const orderRows = loadCsv(join(root, "data", "eval", "orders.csv"));
  const transactionRows = loadCsv(join(root, "data", "eval", "transactions.csv"));
  const settlementRows = loadCsv(join(root, "data", "eval", "settlements.csv"));
  const groundTruth: { scenario: string }[] = JSON.parse(readFileSync(join(root, "data", "eval", "ground-truth.json"), "utf8"));

  const expected = {
    AMOUNT_MISMATCH: groundTruth.filter((g) => g.scenario === "AMOUNT_MISMATCH").length,
    MISSING_SETTLEMENT: groundTruth.filter((g) => g.scenario === "MISSING_SETTLEMENT").length,
    MISSING_PAYMENT: groundTruth.filter((g) => g.scenario === "MISSING_PAYMENT").length,
    PENDING_TRANSACTION: groundTruth.filter((g) => g.scenario === "PENDING").length,
    DUPLICATE_SETTLEMENT_deals: groundTruth.filter((g) => g.scenario === "DUPLICATE_SETTLEMENT").length,
  };

  // clean slate
  await prisma.financeException.deleteMany();
  await prisma.reconciliationResult.deleteMany();
  await prisma.settlement.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.order.deleteMany();

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

    console.log(`seeded ${orderRows.length} orders, ${transactionRows.length} transactions, ${settlementRows.length} settlements`);

    const stage2 = await runExactMatchReconciliation();
    const stage4 = await runFuzzyMatchReconciliation();
    const stage5 = await runExceptionDetection(new Date("2026-09-02T00:00:00.000Z"));

    console.log("stage 2 (exact):", { matches: stage2.matches.length, duplicates: stage2.duplicates.length });
    console.log("stage 4 (fuzzy):", { matches: stage4.matches.length });
    console.log("stage 5 (exceptions):", stage5);

    // global invariant: every transaction and every settlement has exactly one result
    const totalTransactions = await prisma.transaction.count();
    const totalSettlements = await prisma.settlement.count();
    const resultsWithTxn = await prisma.reconciliationResult.count({ where: { transactionId: { not: null } } });
    const resultsWithStl = await prisma.reconciliationResult.count({ where: { settlementId: { not: null } } });
    check("every transaction has exactly one reconciliation result", resultsWithTxn, totalTransactions);
    check("every settlement has exactly one reconciliation result", resultsWithStl, totalSettlements);

    const exceptionCounts = await prisma.financeException.groupBy({ by: ["exceptionType"], _count: true });
    const countByType = Object.fromEntries(exceptionCounts.map((e) => [e.exceptionType, e._count]));

    check("AMOUNT_MISMATCH exception count matches ground truth", countByType.AMOUNT_MISMATCH ?? 0, expected.AMOUNT_MISMATCH);
    check("PENDING_TRANSACTION exception count matches ground truth", countByType.PENDING_TRANSACTION ?? 0, expected.PENDING_TRANSACTION);
    // MISSING_SETTLEMENT/MISSING_PAYMENT counts are NOT expected to equal the
    // ground-truth scenario counts directly — some FUZZY_BORDERLINE deals are
    // deliberately marginal and legitimately fail to recover in Stage 4, which
    // correctly cascades into "missing" here rather than vanishing silently.
    // The real invariant is that every leftover from Stage 4 is accounted for.
    check(
      "MISSING_SETTLEMENT + PENDING_TRANSACTION + skipped-FAILED account for every unresolved transaction",
      stage5.missingSettlementCount + stage5.pendingCount + stage5.skippedFailedCount,
      stage4.unresolvedTransactionIds.length,
    );
    check("MISSING_PAYMENT accounts for every unresolved settlement", stage5.missingPaymentCount, stage4.unresolvedSettlementIds.length);
    check("MISSING_SETTLEMENT count is at least the true-missing ground truth count", stage5.missingSettlementCount >= expected.MISSING_SETTLEMENT, true);
    check("MISSING_PAYMENT count is at least the true-missing ground truth count", stage5.missingPaymentCount >= expected.MISSING_PAYMENT, true);
    // 2 settlement-side + 1 transaction-side exception per typical duplicate deal
    check(
      "DUPLICATE_TRANSACTION exception count matches ground truth shape",
      countByType.DUPLICATE_TRANSACTION ?? 0,
      expected.DUPLICATE_SETTLEMENT_deals * 3,
    );

    const reviewCount = await prisma.reconciliationResult.count({ where: { reviewStatus: "PENDING_REVIEW" } });
    check("every PENDING_REVIEW row came from the fuzzy stage's review tier", reviewCount, stage4.matches.filter((m) => m.tier === "REVIEW").length);
  } finally {
    await prisma.financeException.deleteMany();
    await prisma.reconciliationResult.deleteMany();
    await prisma.settlement.deleteMany();
    await prisma.transaction.deleteMany();
    await prisma.order.deleteMany();
    console.log("\ncleaned up seeded data");
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
