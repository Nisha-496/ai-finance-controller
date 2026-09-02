// Manual verification for normalization.ts (Development Rule #2 — confirm each
// module before moving on). Two parts: hand-written edge cases, then a real
// cross-check against the eval dataset's FORMAT_VARIANT/FUZZY deals to make
// sure normalization actually does its job on the data reconciliation.ts will see.
//
// Run: npm run script scripts/test-normalization.ts

import { readFileSync } from "node:fs";
import { join } from "node:path";
import Papa from "papaparse";
import {
  normalizeReference,
  normalizeCurrency,
  normalizeAmount,
  normalizeDate,
} from "../src/lib/normalization";

let pass = 0;
let fail = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    pass++;
  } else {
    fail++;
    console.error(`FAIL: ${label}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  }
}

// --- reference normalization ---
check("order dash", normalizeReference("ORDER-12345"), "ord12345");
check("order underscore", normalizeReference("ORDER_12345"), "ord12345");
check("order lowercase no separator", normalizeReference("order12345"), "ord12345");
check("txn dash", normalizeReference("TXN-100000"), "txn100000");
check("txn underscore lowercase", normalizeReference("txn_100000"), "txn100000");
check("settlement prefix", normalizeReference("SETTLEMENT-100000"), "stl100000");
check("already short stl prefix", normalizeReference("STL-100000"), "stl100000");

// --- currency ---
check("rupee symbol", normalizeCurrency("₹"), "INR");
check("lowercase inr", normalizeCurrency("inr"), "INR");
check("dollar symbol", normalizeCurrency("$"), "USD");
check("missing currency defaults to INR", normalizeCurrency(undefined), "INR");

// --- amount ---
check("plain decimal", normalizeAmount("1234.5"), 1234.5);
check("rupee symbol + commas", normalizeAmount("₹1,23,456.78"), 123456.78);
check("float rounding", normalizeAmount(99.999), 100);
check("number input", normalizeAmount(500), 500);

// --- date ---
check("iso date", normalizeDate("2026-07-12").toISOString().slice(0, 10), "2026-07-12");
check("dd/mm/yyyy", normalizeDate("12/07/2026").toISOString().slice(0, 10), "2026-07-12");
check("mm-dd-yyyy", normalizeDate("07-12-2026").toISOString().slice(0, 10), "2026-07-12");

// --- cross-check against real eval data ---
function loadCsv(path: string): Record<string, string>[] {
  const text = readFileSync(path, "utf8");
  return Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true }).data;
}

const root = join(import.meta.dirname, "..");
const orders = loadCsv(join(root, "data", "eval", "orders.csv"));
const transactions = loadCsv(join(root, "data", "eval", "transactions.csv"));
const settlements = loadCsv(join(root, "data", "eval", "settlements.csv"));
const groundTruth = JSON.parse(readFileSync(join(root, "data", "eval", "ground-truth.json"), "utf8"));

const txnByRef = new Map(transactions.map((t) => [t.transaction_ref, t]));

let crossCheckDeals = 0;
for (const entry of groundTruth) {
  if (!entry.isTruePair || entry.settlementRefs.length !== 1) continue;
  if (entry.scenario !== "FORMAT_VARIANT" && entry.scenario !== "FUZZY_CLOSE" && entry.scenario !== "EXACT") continue;

  const txn = txnByRef.get(entry.transactionRef);
  const settlement = settlements.find((s) => s.settlement_ref === entry.settlementRefs[0]);
  if (!txn || !settlement) continue;

  const normalizedTxnRef = normalizeReference(txn.transaction_ref);
  const normalizedSettlementRef = normalizeReference(settlement.transaction_ref);
  crossCheckDeals++;

  if (entry.scenario === "FUZZY_CLOSE") {
    // by design these should NOT collapse to equal after normalization alone —
    // that's matching.ts's job (Day 2). Confirm they genuinely differ here.
    check(
      `${entry.dealId} (${entry.scenario}) refs differ pre-fuzzy as expected`,
      normalizedTxnRef !== normalizedSettlementRef,
      true,
    );
  } else {
    check(
      `${entry.dealId} (${entry.scenario}) normalized refs match`,
      normalizedSettlementRef,
      normalizedTxnRef,
    );
  }
}

console.log(`\ncross-checked ${crossCheckDeals} real deals from data/eval/`);
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
