// GET /api/exceptions — unresolved issues with severity (Section 4).
// Query params: severity, type, status, page, pageSize.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const severity = searchParams.get("severity");
  const exceptionType = searchParams.get("type");
  const status = searchParams.get("status");
  const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("pageSize") ?? "25") || 25));

  const where: Prisma.FinanceExceptionWhereInput = {};
  if (severity) where.severity = severity as Prisma.EnumSeverityFilter["equals"];
  if (exceptionType) where.exceptionType = exceptionType as Prisma.EnumExceptionTypeFilter["equals"];
  if (status) where.status = status as Prisma.EnumExceptionStatusFilter["equals"];

  const [total, exceptions] = await Promise.all([
    prisma.financeException.count({ where }),
    prisma.financeException.findMany({
      where,
      include: {
        reconciliationResult: { include: { transaction: true, settlement: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return NextResponse.json({ total, page, pageSize, exceptions });
}
