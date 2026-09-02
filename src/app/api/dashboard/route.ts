// GET /api/dashboard — volume, match rate, exceptions, pending settlement (Section 4).

import { NextResponse } from "next/server";
import { getDashboardStats } from "@/lib/queries/dashboard";

export async function GET() {
  return NextResponse.json(await getDashboardStats());
}
