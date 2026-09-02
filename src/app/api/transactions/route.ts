// GET /api/transactions — searchable, filterable table (Section 4).
// Query params: search, matchStatus, page, pageSize.

import { NextRequest, NextResponse } from "next/server";
import { listTransactions } from "@/lib/queries/transactions";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const result = await listTransactions({
    search: searchParams.get("search")?.trim() || undefined,
    matchStatus: searchParams.get("matchStatus") || undefined,
    page: Number(searchParams.get("page")) || undefined,
    pageSize: Number(searchParams.get("pageSize")) || undefined,
  });
  return NextResponse.json(result);
}
