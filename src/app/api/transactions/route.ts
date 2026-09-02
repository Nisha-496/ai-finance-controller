// GET /api/transactions — searchable, filterable table (Section 4).
// Query params: search, matchStatus, page, pageSize.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const search = searchParams.get("search")?.trim();
  const matchStatus = searchParams.get("matchStatus");
  const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("pageSize") ?? "25") || 25));

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

  const [total, transactions] = await Promise.all([
    prisma.transaction.count({ where }),
    prisma.transaction.findMany({
      where,
      include: {
        order: true,
        reconciliationResult: { include: { settlement: true, exceptions: true } },
      },
      orderBy: { paymentDate: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return NextResponse.json({ total, page, pageSize, transactions });
}
