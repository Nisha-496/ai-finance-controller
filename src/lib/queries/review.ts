import { prisma } from "@/lib/db";

export async function listPendingReview() {
  const results = await prisma.reconciliationResult.findMany({
    where: { reviewStatus: "PENDING_REVIEW" },
    include: { transaction: { include: { order: true } }, settlement: true },
    orderBy: { confidence: "desc" },
  });
  return { total: results.length, results };
}

export type ReviewListResult = Awaited<ReturnType<typeof listPendingReview>>;
export type ReviewListItem = ReviewListResult["results"][number];
