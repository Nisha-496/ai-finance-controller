// Integration test for the review workflow API (Section 8). Runs against
// whatever is currently in the local database — expects the demo dataset
// seeded by scripts/test-api.ts (which leaves a couple of PENDING_REVIEW rows).
// Restores the two records it touches back to PENDING_REVIEW afterward so the
// demo data is left exactly as it was for Day 3's UI work.
//
// Run: npm run script scripts/test-review.ts

import { NextRequest } from "next/server";
import { prisma } from "../src/lib/db";
import { GET as reviewListGet } from "../src/app/api/reconciliation/review/route";
import { PATCH as reviewPatch } from "../src/app/api/reconciliation/[id]/review/route";

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

function patchCtx(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function patch(id: string, action: unknown) {
  const request = new NextRequest(`http://localhost/api/reconciliation/${id}/review`, {
    method: "PATCH",
    body: JSON.stringify({ action }),
    headers: { "content-type": "application/json" },
  });
  const response = await reviewPatch(request, patchCtx(id));
  return { status: response.status, json: await response.json() };
}

async function main() {
  const listResponse = await reviewListGet();
  const listJson = await listResponse.json();
  console.log(`review queue: ${listJson.total} pending`);
  check("review list only contains PENDING_REVIEW rows", listJson.results.every((r: { reviewStatus: string }) => r.reviewStatus === "PENDING_REVIEW"), true);
  check(
    "every review row carries its confidence breakdown",
    listJson.results.every((r: { referenceSimilarity: unknown; amountSimilarity: unknown; dateSimilarity: unknown }) =>
      r.referenceSimilarity !== null && r.amountSimilarity !== null && r.dateSimilarity !== null),
    true,
  );

  if (listJson.total < 2) {
    console.error(`Expected at least 2 PENDING_REVIEW rows from the demo dataset, found ${listJson.total}. Run 'npm run script scripts/test-api.ts' first.`);
    process.exitCode = 1;
    return;
  }

  const [approveTarget, rejectTarget] = listJson.results;

  // invalid action
  const badAction = await patch(approveTarget.id, "MAYBE");
  check("invalid action rejected with 400", badAction.status, 400);

  // nonexistent id
  const missing = await patch("does-not-exist", "APPROVE");
  check("nonexistent id returns 404", missing.status, 404);

  // approve
  const approved = await patch(approveTarget.id, "APPROVE");
  check("approve returns 200", approved.status, 200);
  check("approve sets matchStatus MATCHED", approved.json.result.matchStatus, "MATCHED");
  check("approve sets reviewStatus APPROVED", approved.json.result.reviewStatus, "APPROVED");
  check("approve sets reviewedAt", approved.json.result.reviewedAt !== null, true);

  // reject
  const rejected = await patch(rejectTarget.id, "REJECT");
  check("reject returns 200", rejected.status, 200);
  check("reject sets matchStatus UNMATCHED", rejected.json.result.matchStatus, "UNMATCHED");
  check("reject sets reviewStatus REJECTED", rejected.json.result.reviewStatus, "REJECTED");

  // re-reviewing an already-decided record should be rejected
  const doubleApprove = await patch(approveTarget.id, "APPROVE");
  check("re-reviewing an already-approved record returns 409", doubleApprove.status, 409);

  // both should now be gone from the pending queue
  const afterListResponse = await reviewListGet();
  const afterListJson = await afterListResponse.json();
  check("queue shrank by exactly 2", afterListJson.total, listJson.total - 2);

  // restore both to PENDING_REVIEW so the demo dataset is unchanged for Day 3's UI
  await prisma.reconciliationResult.update({
    where: { id: approveTarget.id },
    data: { matchStatus: approveTarget.matchStatus, reviewStatus: "PENDING_REVIEW", reviewedAt: null },
  });
  await prisma.reconciliationResult.update({
    where: { id: rejectTarget.id },
    data: { matchStatus: rejectTarget.matchStatus, reviewStatus: "PENDING_REVIEW", reviewedAt: null },
  });
  console.log("restored both records to PENDING_REVIEW — demo dataset unchanged for Day 3");

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
