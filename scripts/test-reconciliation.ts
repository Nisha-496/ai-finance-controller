// Manual verification for reconciliation.ts's pure exact-matching logic.
// Part A: hand-crafted fixtures for cases the real dataset doesn't exercise
// (priority 3 fallback in particular — our generator never distorts it).
// Part B: cross-check against every relevant deal in data/eval/.
//
// Run: npm run script scripts/test-reconciliation.ts

import { readFileSync } from "node:fs";
import { join } from "node:path";
import Papa from "papaparse";
import { normalizeReference, normalizeAmount } from "../src/lib/normalization";
import {
  runExactMatching,
  linkTransactionsToOrders,
  type OrderRecord,
  type TransactionRecord,
  type SettlementRecord,
} from "../src/lib/reconciliation";

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

function txn(id: string, overrides: Partial<TransactionRecord> = {}): TransactionRecord {
  const transactionRef = overrides.transactionRef ?? id;
  return {
    id,
    transactionRef,
    normalizedTransactionRef: normalizeReference(transactionRef),
    orderId: null,
    normalizedOrderRefOnPayment: null,
    amount: 1000,
    ...overrides,
  };
}
function stl(id: string, overrides: Partial<SettlementRecord> = {}): SettlementRecord {
  const transactionRefOnSettlement = overrides.transactionRefOnSettlement ?? id;
  return {
    id,
    transactionRefOnSettlement,
    normalizedTransactionRefOnSettlement: normalizeReference(transactionRefOnSettlement),
    grossAmount: 1000,
    ...overrides,
  };
}

{
  // Priority 1: raw exact match
  const result = runExactMatching([], [txn("TXN-1")], [stl("TXN-1")]);
  check("priority 1 exact match found", result.matches.length, 1);
  check("priority 1 amountOk", result.matches[0]?.amountOk, true);
  check("priority 1 tagged correctly", result.matches[0]?.matchPriority, 1);
}

{
  // Priority 2: raw refs differ in format, normalized refs match
  const result = runExactMatching(
    [],
    [txn("TXN-2", { transactionRef: "TXN-100002" })],
    [stl("S1", { transactionRefOnSettlement: "txn_100002", normalizedTransactionRefOnSettlement: normalizeReference("txn_100002") })],
  );
  check("priority 2 format-variant match found", result.matches.length, 1);
  check("priority 2 tagged correctly", result.matches[0]?.matchPriority, 2);
}

{
  // Priority 3: settlement's "transaction ref" is actually the merchant's order ref
  const order: OrderRecord = { id: "ORD-1", normalizedOrderRef: normalizeReference("ORDER-500") };
  const transaction = txn("TXN-9", { normalizedOrderRefOnPayment: normalizeReference("ORDER-500"), orderId: "ORD-1" });
  const settlement = stl("S2", {
    transactionRefOnSettlement: "ORDER-500",
    normalizedTransactionRefOnSettlement: normalizeReference("ORDER-500"),
  });
  const result = runExactMatching([order], [transaction], [settlement]);
  check("priority 3 fallback-through-order match found", result.matches.length, 1);
  check("priority 3 tagged correctly", result.matches[0]?.matchPriority, 3);
}

{
  // linkTransactionsToOrders feeding priority 3
  const orders: OrderRecord[] = [{ id: "ORD-A", normalizedOrderRef: normalizeReference("ORDER-777") }];
  const transactions: TransactionRecord[] = [txn("TXN-A", { normalizedOrderRefOnPayment: normalizeReference("ORDER-777") })];
  const links = linkTransactionsToOrders(orders, transactions);
  check("order link resolved", links.get("TXN-A"), "ORD-A");
}

{
  // Duplicate: two settlements claim the same transaction reference
  const result = runExactMatching(
    [],
    [txn("TXN-3")],
    [stl("S-A", { transactionRefOnSettlement: "TXN-3" }), stl("S-B", { transactionRefOnSettlement: "TXN-3" })],
  );
  check("duplicate settlements produce zero matches", result.matches.length, 0);
  check("duplicate group recorded", result.duplicates.length, 1);
  check("duplicate group has both settlements", result.duplicates[0]?.settlementIds.sort(), ["S-A", "S-B"]);
  check("duplicate group consumed the transaction", result.unresolvedTransactionIds.length, 0);
}

{
  // Amount mismatch: reference matches, gross doesn't equal payment
  const result = runExactMatching([], [txn("TXN-4", { amount: 1000 })], [stl("TXN-4", { grossAmount: 850 })]);
  check("amount mismatch still counts as a reference match", result.matches.length, 1);
  check("amount mismatch flagged", result.matches[0]?.amountOk, false);
  check("amount diff computed correctly", result.matches[0]?.grossVsPaymentDiff, -150);
}

{
  // No candidate anywhere — passed through untouched for Stage 4
  const result = runExactMatching([], [txn("TXN-5")], [stl("TXN-999")]);
  check("unmatched transaction passed through", result.unresolvedTransactionIds, ["TXN-5"]);
  check("unmatched settlement passed through", result.unresolvedSettlementIds, ["TXN-999"]);
}

// ============================================================
// Part B — cross-check against data/eval/
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
  orderRef: string | null;
  transactionRef: string | null;
  settlementRefs: string[];
  isTruePair: boolean;
}[] = JSON.parse(readFileSync(join(root, "data", "eval", "ground-truth.json"), "utf8"));

const orders: OrderRecord[] = orderRows.map((r) => ({ id: r.order_ref, normalizedOrderRef: normalizeReference(r.order_ref) }));
const transactions: TransactionRecord[] = transactionRows
  .filter((r) => r.status !== "PENDING")
  .map((r) => ({
    id: r.transaction_ref,
    transactionRef: r.transaction_ref,
    normalizedTransactionRef: normalizeReference(r.transaction_ref),
    orderId: null,
    normalizedOrderRefOnPayment: normalizeReference(r.order_ref),
    amount: normalizeAmount(r.amount),
  }));
const settlements: SettlementRecord[] = settlementRows.map((r) => ({
  id: r.settlement_ref,
  transactionRefOnSettlement: r.transaction_ref,
  normalizedTransactionRefOnSettlement: normalizeReference(r.transaction_ref),
  grossAmount: normalizeAmount(r.gross_amount),
}));

const links = linkTransactionsToOrders(orders, transactions);
for (const t of transactions) t.orderId = links.get(t.id) ?? null;

const result = runExactMatching(orders, transactions, settlements);
const matchedPairs = new Map(result.matches.map((m) => [`${m.transactionId}::${m.settlementId}`, m]));
const duplicateSettlementIds = new Set(result.duplicates.flatMap((d) => d.settlementIds));
const unresolvedTxn = new Set(result.unresolvedTransactionIds);
const unresolvedStl = new Set(result.unresolvedSettlementIds);

let checkedDeals = 0;
for (const entry of groundTruth) {
  if (entry.scenario === "EXACT" || entry.scenario === "FORMAT_VARIANT") {
    const m = matchedPairs.get(`${entry.transactionRef}::${entry.settlementRefs[0]}`);
    check(`${entry.dealId} (${entry.scenario}) exact-matched with correct amount`, m?.amountOk, true);
    checkedDeals++;
  } else if (entry.scenario === "AMOUNT_MISMATCH") {
    const m = matchedPairs.get(`${entry.transactionRef}::${entry.settlementRefs[0]}`);
    check(`${entry.dealId} (AMOUNT_MISMATCH) reference matched but amount flagged`, m?.amountOk, false);
    checkedDeals++;
  } else if (entry.scenario === "DUPLICATE_SETTLEMENT") {
    check(
      `${entry.dealId} (DUPLICATE_SETTLEMENT) both settlements flagged as duplicates`,
      entry.settlementRefs.every((ref) => duplicateSettlementIds.has(ref)),
      true,
    );
    checkedDeals++;
  } else if (entry.scenario === "FUZZY_CLOSE" || entry.scenario === "FUZZY_BORDERLINE") {
    check(
      `${entry.dealId} (${entry.scenario}) left unresolved for Stage 4`,
      unresolvedTxn.has(entry.transactionRef!) && unresolvedStl.has(entry.settlementRefs[0]),
      true,
    );
    checkedDeals++;
  } else if (entry.scenario === "MISSING_SETTLEMENT") {
    check(`${entry.dealId} (MISSING_SETTLEMENT) transaction left unresolved`, unresolvedTxn.has(entry.transactionRef!), true);
    checkedDeals++;
  } else if (entry.scenario === "MISSING_PAYMENT") {
    check(`${entry.dealId} (MISSING_PAYMENT) settlement left unresolved`, unresolvedStl.has(entry.settlementRefs[0]), true);
    checkedDeals++;
  }
  // PENDING transactions are excluded from the transactions array above (no settlement
  // expected), so there's nothing meaningful to assert against Stage 2 output for them.
}

console.log(`\ncross-checked ${checkedDeals} real deals from data/eval/`);
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
