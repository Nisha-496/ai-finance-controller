// GET /api/exceptions — unresolved issues with severity (Section 4).
// Query params: severity, type, status, page, pageSize.

import { NextRequest, NextResponse } from "next/server";
import { listExceptions } from "@/lib/queries/exceptions";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const result = await listExceptions({
    severity: searchParams.get("severity") || undefined,
    type: searchParams.get("type") || undefined,
    status: searchParams.get("status") || undefined,
    page: Number(searchParams.get("page")) || undefined,
    pageSize: Number(searchParams.get("pageSize")) || undefined,
  });
  return NextResponse.json(result);
}
