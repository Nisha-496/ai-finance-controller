import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

export interface ListTransactionsParams {
  search?: string;
  matchStatus?: string;
  page?: number;
  pageSize?: number;
}

export async function listTransactions({ search, matchStatus, page = 1, pageSize = 25 }: ListTransactionsParams) {
  const where: Prisma.TransactionWhereInput = {};
  if (search) {
    where.OR = [
      { transactionRef: { contains: search, mode: "insensitive" } },
      { orderRefOnPayment: { contains: search, mode: "insensitive" } },
    ];
  }
  if (matchStatus) {
    where.reconciliationResult = { matchStatus: matchStatus as Prisma.EnumMatchStatusFilter["equals"] };
  }

  const safePage = Math.max(1, page || 1);
  const safePageSize = Math.min(100, Math.max(1, pageSize || 25));

  const [total, transactions] = await Promise.all([
    prisma.transaction.count({ where }),
    prisma.transaction.findMany({
      where,
      include: {
        order: true,
        reconciliationResult: { include: { settlement: true, exceptions: true } },
      },
      orderBy: { paymentDate: "desc" },
      skip: (safePage - 1) * safePageSize,
      take: safePageSize,
    }),
  ]);

  return { total, page: safePage, pageSize: safePageSize, transactions };
}

export type TransactionListResult = Awaited<ReturnType<typeof listTransactions>>;
export type TransactionListItem = TransactionListResult["transactions"][number];
