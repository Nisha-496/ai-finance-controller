// Wipes the database and reseeds it from data/demo/, fully reconciled —
// the exact state to be in right before a live walkthrough. Safe to run
// as many times as needed; it always starts from a clean slate.
//
// Run: npm run demo:reset

import { readFileSync } from "node:fs";
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

async function main() {
  const root = join(import.meta.dirname, "..");
  const orderRows = loadCsv(join(root, "data", "demo", "orders.csv"));
  const transactionRows = loadCsv(join(root, "data", "demo", "transactions.csv"));
  const settlementRows = loadCsv(join(root, "data", "demo", "settlements.csv"));

  console.log("wiping existing data...");
  await prisma.financeException.deleteMany();
  await prisma.reconciliationResult.deleteMany();
  await prisma.settlement.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.order.deleteMany();

  console.log(`seeding ${orderRows.length} orders, ${transactionRows.length} transactions, ${settlementRows.length} settlements...`);
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

  console.log("running reconciliation...");
  const stage2 = await runExactMatchReconciliation();
  const stage4 = await runFuzzyMatchReconciliation();
  const stage5 = await runExceptionDetection();

  console.log("\nready for the demo:");
  console.log(`  exact matches: ${stage2.matches.length}, duplicate groups: ${stage2.duplicates.length}`);
  console.log(`  fuzzy: ${stage4.matches.filter((m) => m.tier === "AUTO_MATCH").length} auto-matched, ${stage4.matches.filter((m) => m.tier === "REVIEW").length} sent to review`);
  console.log(`  exceptions: ${stage5.missingSettlementCount} missing settlement, ${stage5.missingPaymentCount} missing payment, ${stage5.pendingCount} pending, ${stage5.invalidCalculationCount} invalid calculations`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
