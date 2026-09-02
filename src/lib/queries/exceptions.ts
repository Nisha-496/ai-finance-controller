import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

export interface ListExceptionsParams {
  severity?: string;
  type?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}

export async function listExceptions({ severity, type, status, page = 1, pageSize = 25 }: ListExceptionsParams) {
  const where: Prisma.FinanceExceptionWhereInput = {};
  if (severity) where.severity = severity as Prisma.EnumSeverityFilter["equals"];
  if (type) where.exceptionType = type as Prisma.EnumExceptionTypeFilter["equals"];
  if (status) where.status = status as Prisma.EnumExceptionStatusFilter["equals"];

  const safePage = Math.max(1, page || 1);
  const safePageSize = Math.min(100, Math.max(1, pageSize || 25));

  const [total, exceptions] = await Promise.all([
    prisma.financeException.count({ where }),
    prisma.financeException.findMany({
      where,
      include: {
        reconciliationResult: { include: { transaction: true, settlement: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (safePage - 1) * safePageSize,
      take: safePageSize,
    }),
  ]);

  return { total, page: safePage, pageSize: safePageSize, exceptions };
}

export type ExceptionListResult = Awaited<ReturnType<typeof listExceptions>>;
export type ExceptionListItem = ExceptionListResult["exceptions"][number];
