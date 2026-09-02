// Integration test for the core API routes (Section 13 / Build Step 7). Calls
// the real route-handler functions with real NextRequest/FormData objects —
// not a mocked layer — against the actual local Postgres database.
//
// Deliberately does NOT clean up afterward: this seeds the dev DB with the
// demo dataset, fully reconciled, so Day 3's UI has something real to render.
//
// Run: npm run script scripts/test-api.ts

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { prisma } from "../src/lib/db";
import { POST as uploadPost } from "../src/app/api/upload/route";
import { POST as reconcilePost } from "../src/app/api/reconcile/route";
import { GET as dashboardGet } from "../src/app/api/dashboard/route";
import { GET as transactionsGet } from "../src/app/api/transactions/route";
import { GET as exceptionsGet } from "../src/app/api/exceptions/route";

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

const root = join(import.meta.dirname, "..");

async function uploadCsv(source: string, filename: string) {
  const csvText = readFileSync(join(root, "data", "demo", filename), "utf8");
  const file = new File([csvText], filename, { type: "text/csv" });
  const formData = new FormData();
  formData.set("source", source);
  formData.set("file", file);
  const request = new NextRequest("http://localhost/api/upload", { method: "POST", body: formData });
  const response = await uploadPost(request);
  return response.json();
}

async function main() {
  await prisma.financeException.deleteMany();
  await prisma.reconciliationResult.deleteMany();
  await prisma.settlement.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.order.deleteMany();

  const ordersResult = await uploadCsv("orders", "orders.csv");
  console.log("orders upload:", ordersResult);
  check("orders uploaded with no errors", ordersResult.errors.length, 0);
  check("orders insert count matches row count", ordersResult.inserted, ordersResult.rowCount);

  const txnResult = await uploadCsv("transactions", "transactions.csv");
  console.log("transactions upload:", txnResult);
  check("transactions uploaded with no errors", txnResult.errors.length, 0);

  const stlResult = await uploadCsv("settlements", "settlements.csv");
  console.log("settlements upload:", stlResult);
  check("settlements uploaded with no errors", stlResult.errors.length, 0);

  // malformed upload should fail cleanly, not crash
  const badCsv = new File(["order_ref,amount\n,100"], "bad.csv", { type: "text/csv" });
  const badFormData = new FormData();
  badFormData.set("source", "orders");
  badFormData.set("file", badCsv);
  const badResponse = await uploadPost(new NextRequest("http://localhost/api/upload", { method: "POST", body: badFormData }));
  const badJson = await badResponse.json();
  check("row with missing required field is reported, not thrown", badJson.errors.length, 1);

  const reconcileResponse = await reconcilePost();
  const reconcileJson = await reconcileResponse.json();
  console.log("reconcile:", reconcileJson);
  check("reconcile ran and returned counts", typeof reconcileJson.exactMatches, "number");

  const dashboardResponse = await dashboardGet();
  const dashboardJson = await dashboardResponse.json();
  console.log("dashboard:", dashboardJson);
  check("dashboard transaction total matches uploaded count", dashboardJson.totals.transactions, txnResult.inserted);
  check("dashboard match rate is a sane percentage", dashboardJson.matchRate >= 0 && dashboardJson.matchRate <= 100, true);

  const matchedRequest = new NextRequest("http://localhost/api/transactions?matchStatus=MATCHED&pageSize=50");
  const matchedResponse = await transactionsGet(matchedRequest);
  const matchedJson = await matchedResponse.json();
  console.log(`transactions?matchStatus=MATCHED: ${matchedJson.total} total`);
  check(
    "every returned transaction is actually MATCHED",
    matchedJson.transactions.every((t: { reconciliationResult?: { matchStatus?: string } }) => t.reconciliationResult?.matchStatus === "MATCHED"),
    true,
  );

  const searchRequest = new NextRequest("http://localhost/api/transactions?search=TXN-100000");
  const searchResponse = await transactionsGet(searchRequest);
  const searchJson = await searchResponse.json();
  check("search by ref finds at most the matching rows", searchJson.transactions.length <= 2, true);

  const exceptionsResponse = await exceptionsGet(new NextRequest("http://localhost/api/exceptions?pageSize=100"));
  const exceptionsJson = await exceptionsResponse.json();
  console.log(`exceptions: ${exceptionsJson.total} total`);
  const severities = new Set(exceptionsJson.exceptions.map((e: { severity: string }) => e.severity));
  check("exception severities are all valid enum values", [...severities].every((s) => ["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(s as string)), true);

  const highOnlyResponse = await exceptionsGet(new NextRequest("http://localhost/api/exceptions?severity=HIGH"));
  const highOnlyJson = await highOnlyResponse.json();
  check(
    "severity filter actually filters",
    highOnlyJson.exceptions.every((e: { severity: string }) => e.severity === "HIGH"),
    true,
  );

  console.log("\ndemo dataset left in the database for Day 3's UI.");
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
