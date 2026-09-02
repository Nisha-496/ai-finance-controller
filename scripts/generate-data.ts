// Deterministic synthetic dataset generator for the reconciliation engine.
//
// Produces two independent datasets from the same generator, run with different
// seeds and sizes:
//   data/demo/  - small, curated-by-scenario-mix set shown in the live walkthrough
//   data/eval/  - larger held-out set, paired with ground-truth.json, never shown
//                 live. scripts/evaluate.ts (Day 2) runs the reconciliation engine
//                 against it to produce measured precision/recall numbers.
//
// Ground truth records semantic truth only (is this transaction/settlement pair
// really the same underlying deal, and which exceptions should fire) — never a
// predicted confidence score, since the matching algorithm that produces
// confidence doesn't exist yet at generation time. See ARCHITECTURE.md Section 7.
//
// Run: npm run script scripts/generate-data.ts

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Rng = () => number;

function mulberry32(seed: number): Rng {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: Rng, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

function randInt(rng: Rng, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const FIRST_NAMES = [
  "Aarav", "Vivaan", "Aditi", "Diya", "Kabir", "Meera", "Rohan", "Ishaan",
  "Ananya", "Priya", "Arjun", "Sneha", "Karan", "Pooja", "Nikhil", "Riya",
  "Aditya", "Neha", "Rahul", "Simran",
];
const LAST_NAMES = [
  "Sharma", "Verma", "Patel", "Gupta", "Reddy", "Iyer", "Nair", "Singh",
  "Menon", "Rao", "Bose", "Kapoor", "Malhotra", "Chatterjee", "Joshi",
];

function randomName(rng: Rng): string {
  return `${pick(rng, FIRST_NAMES)} ${pick(rng, LAST_NAMES)}`;
}

// Swaps a couple of digits to simulate a typo/transposition at a fixed edit distance.
function perturbDigits(core: string, rng: Rng, count: number): string {
  const chars = core.split("");
  for (let i = 0; i < count; i++) {
    const idx = randInt(rng, 0, chars.length - 1);
    let digit = randInt(rng, 0, 9).toString();
    if (digit === chars[idx]) digit = ((Number(digit) + 1) % 10).toString();
    chars[idx] = digit;
  }
  return chars.join("");
}

type ScenarioType =
  | "EXACT"
  | "FORMAT_VARIANT"
  | "FUZZY_CLOSE"
  | "FUZZY_BORDERLINE"
  | "AMOUNT_MISMATCH"
  | "MISSING_SETTLEMENT"
  | "MISSING_PAYMENT"
  | "DUPLICATE_SETTLEMENT"
  | "PENDING";

const SCENARIOS: { type: ScenarioType; weight: number }[] = [
  { type: "EXACT", weight: 30 },
  { type: "FORMAT_VARIANT", weight: 15 },
  { type: "FUZZY_CLOSE", weight: 10 },
  { type: "FUZZY_BORDERLINE", weight: 10 },
  { type: "AMOUNT_MISMATCH", weight: 10 },
  { type: "MISSING_SETTLEMENT", weight: 8 },
  { type: "MISSING_PAYMENT", weight: 7 },
  { type: "DUPLICATE_SETTLEMENT", weight: 5 },
  { type: "PENDING", weight: 5 },
];

function pickScenario(rng: Rng): ScenarioType {
  const total = SCENARIOS.reduce((s, x) => s + x.weight, 0);
  let r = rng() * total;
  for (const s of SCENARIOS) {
    if (r < s.weight) return s.type;
    r -= s.weight;
  }
  return SCENARIOS[SCENARIOS.length - 1].type;
}

interface OrderRow {
  order_ref: string;
  amount: string;
  currency: string;
  order_date: string;
  customer_name: string;
}
interface TransactionRow {
  transaction_ref: string;
  order_ref: string;
  amount: string;
  currency: string;
  payment_date: string;
  status: "SUCCESS" | "PENDING" | "FAILED";
}
interface SettlementRow {
  settlement_ref: string;
  transaction_ref: string;
  gross_amount: string;
  fee: string;
  tax: string;
  net_amount: string;
  settlement_date: string;
}
interface GroundTruthEntry {
  dealId: string;
  scenario: ScenarioType;
  orderRef: string | null;
  transactionRef: string | null;
  settlementRefs: string[];
  isTruePair: boolean;
  expectedExceptions: string[];
  notes: string;
}

const ORDER_REF_STYLES = (core: string) => [
  `ORDER-${core}`,
  `ORDER_${core}`,
  `order${core}`,
  `ORD${core}`,
];
const TXN_REF_STYLES = (core: string) => [
  `TXN${core}`,
  `txn_${core}`,
  `TXN-${core}`,
];

function buildDeal(rng: Rng, index: number, baseDate: Date): {
  scenario: ScenarioType;
  orders: OrderRow[];
  transactions: TransactionRow[];
  settlements: SettlementRow[];
  groundTruth: GroundTruthEntry[];
} {
  const scenario = pickScenario(rng);
  const core = String(100000 + index);
  const dealId = `DEAL-${core}`;
  const orderRef = pick(rng, ORDER_REF_STYLES(core));
  const cleanTxnRef = pick(rng, TXN_REF_STYLES(core));
  const settlementRef = `STL-${core}`;

  const orderDate = addDays(baseDate, randInt(rng, 0, 89));
  const paymentDate = addDays(orderDate, randInt(rng, 0, 1));
  const grossAmount = round2(randInt(rng, 500, 50000) + rng());
  const fee = round2(grossAmount * 0.02 + 3);
  const tax = round2(fee * 0.18);
  const netAmount = round2(grossAmount - fee - tax);
  const customerName = randomName(rng);

  const orders: OrderRow[] = [
    {
      order_ref: orderRef,
      amount: grossAmount.toFixed(2),
      currency: "INR",
      order_date: fmtDate(orderDate),
      customer_name: customerName,
    },
  ];

  const baseTransaction = (status: TransactionRow["status"] = "SUCCESS"): TransactionRow => ({
    transaction_ref: cleanTxnRef,
    order_ref: orderRef,
    amount: grossAmount.toFixed(2),
    currency: "INR",
    payment_date: fmtDate(paymentDate),
    status,
  });

  const settlementDate = addDays(paymentDate, randInt(rng, 2, 4));
  const cleanSettlement = (overrides: Partial<SettlementRow> = {}): SettlementRow => ({
    settlement_ref: settlementRef,
    transaction_ref: cleanTxnRef,
    gross_amount: grossAmount.toFixed(2),
    fee: fee.toFixed(2),
    tax: tax.toFixed(2),
    net_amount: netAmount.toFixed(2),
    settlement_date: fmtDate(settlementDate),
    ...overrides,
  });

  switch (scenario) {
    case "EXACT": {
      return {
        scenario,
        orders,
        transactions: [baseTransaction()],
        settlements: [cleanSettlement()],
        groundTruth: [{
          dealId, scenario, orderRef, transactionRef: cleanTxnRef,
          settlementRefs: [settlementRef], isTruePair: true, expectedExceptions: [],
          notes: "Clean exact match across all three sources.",
        }],
      };
    }
    case "FORMAT_VARIANT": {
      // settlement records the transaction ref in a differently-formatted but
      // equivalent style — must be recovered by normalization, not fuzzy matching.
      const variantTxnRef = pick(rng, TXN_REF_STYLES(core).filter((s) => s !== cleanTxnRef));
      return {
        scenario,
        orders,
        transactions: [baseTransaction()],
        settlements: [cleanSettlement({ transaction_ref: variantTxnRef })],
        groundTruth: [{
          dealId, scenario, orderRef, transactionRef: cleanTxnRef,
          settlementRefs: [settlementRef], isTruePair: true, expectedExceptions: [],
          notes: `Settlement uses "${variantTxnRef}" for the same transaction — normalization should still resolve this as exact.`,
        }],
      };
    }
    case "FUZZY_CLOSE": {
      const typoTxnRef = cleanTxnRef.replace(core, perturbDigits(core, rng, 1));
      return {
        scenario,
        orders,
        transactions: [baseTransaction()],
        settlements: [cleanSettlement({ transaction_ref: typoTxnRef })],
        groundTruth: [{
          dealId, scenario, orderRef, transactionRef: cleanTxnRef,
          settlementRefs: [settlementRef], isTruePair: true, expectedExceptions: [],
          notes: `Settlement reference has a 1-digit typo ("${typoTxnRef}" vs "${cleanTxnRef}") — should still be recovered, likely via fuzzy match.`,
        }],
      };
    }
    case "FUZZY_BORDERLINE": {
      const fuzzyTxnRef = cleanTxnRef.replace(core, perturbDigits(core, rng, 2));
      const shiftedSettlementDate = addDays(settlementDate, randInt(rng, 4, 6));
      return {
        scenario,
        orders,
        transactions: [baseTransaction()],
        settlements: [cleanSettlement({
          transaction_ref: fuzzyTxnRef,
          settlement_date: fmtDate(shiftedSettlementDate),
        })],
        groundTruth: [{
          dealId, scenario, orderRef, transactionRef: cleanTxnRef,
          settlementRefs: [settlementRef], isTruePair: true, expectedExceptions: [],
          notes: "Reference has a 2-digit drift and the settlement date is shifted — a genuinely ambiguous case, good review-queue material.",
        }],
      };
    }
    case "AMOUNT_MISMATCH": {
      // A real discrepancy beyond fee/tax — not explained by Gross - Fee - Tax = Net.
      const shortfall = round2(randInt(rng, 50, 500));
      const wrongGross = round2(grossAmount - shortfall);
      const wrongFee = round2(wrongGross * 0.02 + 3);
      const wrongTax = round2(wrongFee * 0.18);
      const wrongNet = round2(wrongGross - wrongFee - wrongTax);
      return {
        scenario,
        orders,
        transactions: [baseTransaction()],
        settlements: [cleanSettlement({
          gross_amount: wrongGross.toFixed(2),
          fee: wrongFee.toFixed(2),
          tax: wrongTax.toFixed(2),
          net_amount: wrongNet.toFixed(2),
        })],
        groundTruth: [{
          dealId, scenario, orderRef, transactionRef: cleanTxnRef,
          settlementRefs: [settlementRef], isTruePair: true,
          expectedExceptions: ["AMOUNT_MISMATCH"],
          notes: `Settlement gross (₹${wrongGross}) is ₹${shortfall} short of the payment (₹${grossAmount}) — a real mismatch, not a fee artifact.`,
        }],
      };
    }
    case "MISSING_SETTLEMENT": {
      return {
        scenario,
        orders,
        transactions: [baseTransaction()],
        settlements: [],
        groundTruth: [{
          dealId, scenario, orderRef, transactionRef: cleanTxnRef,
          settlementRefs: [], isTruePair: false,
          expectedExceptions: ["MISSING_SETTLEMENT"],
          notes: "Payment went through but no settlement has arrived yet.",
        }],
      };
    }
    case "MISSING_PAYMENT": {
      // Orphan settlement — no order or transaction was ever recorded for it.
      return {
        scenario,
        orders: [],
        transactions: [],
        settlements: [cleanSettlement()],
        groundTruth: [{
          dealId, scenario, orderRef: null, transactionRef: null,
          settlementRefs: [settlementRef], isTruePair: false,
          expectedExceptions: ["MISSING_PAYMENT"],
          notes: "Settlement exists with no matching payment on our side.",
        }],
      };
    }
    case "DUPLICATE_SETTLEMENT": {
      const settlementRefB = `STL-${core}B`;
      return {
        scenario,
        orders,
        transactions: [baseTransaction()],
        settlements: [
          cleanSettlement(),
          cleanSettlement({ settlement_ref: settlementRefB }),
        ],
        groundTruth: [{
          dealId, scenario, orderRef, transactionRef: cleanTxnRef,
          settlementRefs: [settlementRef, settlementRefB], isTruePair: true,
          expectedExceptions: ["DUPLICATE_TRANSACTION"],
          notes: "Two settlement records both claim the same transaction reference — must be flagged, not auto-matched to either.",
        }],
      };
    }
    case "PENDING": {
      return {
        scenario,
        orders,
        transactions: [baseTransaction("PENDING")],
        settlements: [],
        groundTruth: [{
          dealId, scenario, orderRef, transactionRef: cleanTxnRef,
          settlementRefs: [], isTruePair: false,
          expectedExceptions: ["PENDING_TRANSACTION"],
          notes: "Payment is still pending — no settlement expected yet, should not be flagged as missing.",
        }],
      };
    }
  }
}

function toCsv<T extends Record<string, unknown>>(rows: T[], columns: (keyof T)[]): string {
  const escape = (v: unknown) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => escape(row[c])).join(","));
  }
  return lines.join("\n") + "\n";
}

function generateDataset(seed: number, dealCount: number) {
  const rng = mulberry32(seed);
  const baseDate = new Date("2026-06-01T00:00:00.000Z");

  const orders: OrderRow[] = [];
  const transactions: TransactionRow[] = [];
  const settlements: SettlementRow[] = [];
  const groundTruth: GroundTruthEntry[] = [];
  const scenarioCounts: Record<string, number> = {};

  for (let i = 0; i < dealCount; i++) {
    const deal = buildDeal(rng, i, baseDate);
    orders.push(...deal.orders);
    transactions.push(...deal.transactions);
    settlements.push(...deal.settlements);
    groundTruth.push(...deal.groundTruth);
    scenarioCounts[deal.scenario] = (scenarioCounts[deal.scenario] ?? 0) + 1;
  }

  return { orders, transactions, settlements, groundTruth, scenarioCounts };
}

function writeDataset(dir: string, data: ReturnType<typeof generateDataset>) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "orders.csv"),
    toCsv(data.orders, ["order_ref", "amount", "currency", "order_date", "customer_name"]),
  );
  writeFileSync(
    join(dir, "transactions.csv"),
    toCsv(data.transactions, ["transaction_ref", "order_ref", "amount", "currency", "payment_date", "status"]),
  );
  writeFileSync(
    join(dir, "settlements.csv"),
    toCsv(data.settlements, ["settlement_ref", "transaction_ref", "gross_amount", "fee", "tax", "net_amount", "settlement_date"]),
  );
}

function main() {
  const root = join(import.meta.dirname, "..");

  const demo = generateDataset(20260902, 25);
  writeDataset(join(root, "data", "demo"), demo);

  const evalSet = generateDataset(7102026, 180);
  writeDataset(join(root, "data", "eval"), evalSet);
  writeFileSync(
    join(root, "data", "eval", "ground-truth.json"),
    JSON.stringify(evalSet.groundTruth, null, 2) + "\n",
  );

  console.log("demo dataset:", demo.orders.length, "orders /", demo.transactions.length, "transactions /", demo.settlements.length, "settlements");
  console.log("  scenario mix:", demo.scenarioCounts);
  console.log("eval dataset:", evalSet.orders.length, "orders /", evalSet.transactions.length, "transactions /", evalSet.settlements.length, "settlements");
  console.log("  scenario mix:", evalSet.scenarioCounts);
}

main();
