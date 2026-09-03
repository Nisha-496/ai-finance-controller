// Verifies the AI layer's guardrails without making a live API call:
// prompt construction only ever surfaces values actually passed in, and
// context assembly (fetchExceptionContext / buildChatContext) pulls real
// data from the DB rather than anything invented. Development Rule 4.
//
// Run: npm run script scripts/test-ai-context.ts

import { prisma } from "../src/lib/db";
import { buildExceptionPrompt, buildChatSystemPrompt, type ExceptionExplanationInput } from "../src/lib/ai";
import { fetchExceptionContext, buildChatContext } from "../src/lib/queries/ai-context";

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
// Part A — prompt construction never fabricates figures
// ============================================================

const fullInput: ExceptionExplanationInput = {
  exceptionType: "AMOUNT_MISMATCH",
  severity: "MEDIUM",
  description: "Settlement gross amount is ₹277.00 lower than the payment amount.",
  paymentAmount: 1000,
  settlementGross: 723,
  fee: 20,
  tax: 3.6,
  difference: -277,
};
const fullPrompt = buildExceptionPrompt(fullInput);
check("prompt includes payment amount", fullPrompt.includes("1000.00"), true);
check("prompt includes settlement gross", fullPrompt.includes("723.00"), true);
check("prompt includes difference", fullPrompt.includes("-277.00") || fullPrompt.includes("277.00"), true);
check("prompt instructs the model not to invent numbers", fullPrompt.toLowerCase().includes("never invent"), true);

const missingDataInput: ExceptionExplanationInput = {
  exceptionType: "MISSING_PAYMENT",
  severity: "CRITICAL",
  description: "Settlement recorded 37 day(s) ago with no matching payment on our side.",
  paymentAmount: null,
  settlementGross: null,
  fee: null,
  tax: null,
  difference: null,
};
const missingDataPrompt = buildExceptionPrompt(missingDataInput);
check("prompt omits fields that are genuinely null rather than fabricating them", missingDataPrompt.includes("Payment amount"), false);
check("prompt still includes the type and description", missingDataPrompt.includes("MISSING_PAYMENT"), true);

const chatContext = {
  totals: { orders: 10, transactions: 10, settlements: 9 },
  matchRate: 70,
  reviewQueueCount: 2,
  pendingSettlementAmount: 5000,
  exceptionsBySeverity: { LOW: 1, HIGH: 2 },
  reviewQueueSample: [{ transactionRef: "TXN-1", settlementRef: "STL-1", confidence: 88 }],
};
const chatPrompt = buildChatSystemPrompt(chatContext);
check("chat prompt includes match rate", chatPrompt.includes("70%"), true);
check("chat prompt includes pending settlement amount", chatPrompt.includes("5000.00"), true);
check("chat prompt includes review sample", chatPrompt.includes("TXN-1"), true);
check("chat prompt instructs against inventing numbers", chatPrompt.toLowerCase().includes("never invent"), true);

// ============================================================
// Part B — context assembly pulls real data (against demo dataset)
// ============================================================

async function main() {
  const someException = await prisma.financeException.findFirst({ where: { exceptionType: "AMOUNT_MISMATCH" } });
  if (someException) {
    const context = await fetchExceptionContext(someException.id);
    check("fetched context matches the exception's real type", context?.exceptionType, "AMOUNT_MISMATCH");
    check("fetched context has real payment/settlement figures, not null", context?.paymentAmount !== null, true);
    console.log("sample exception context:", context);
  } else {
    console.log("(no AMOUNT_MISMATCH exception in DB — run scripts/test-api.ts first to seed demo data)");
  }

  const missingException = await prisma.financeException.findFirst({ where: { exceptionType: "MISSING_PAYMENT" } });
  if (missingException) {
    const context = await fetchExceptionContext(missingException.id);
    check("MISSING_PAYMENT context has no transaction-side figures", context?.paymentAmount, null);
  }

  const chatCtx = await buildChatContext();
  check("chat context totals are real numbers, not placeholders", typeof chatCtx.totals.transactions, "number");
  check("chat context matches live dashboard stats shape", typeof chatCtx.matchRate, "number");
  console.log("real chat context:", chatCtx);

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
