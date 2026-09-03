// POST /api/ai/explain — { "exceptionId": string }.
// Fetches the exception's already-computed numbers, hands them to the model,
// and persists the explanation. The model never queries anything itself.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { fetchExceptionContext } from "@/lib/queries/ai-context";
import { explainException } from "@/lib/ai";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const exceptionId = body?.exceptionId;
  if (typeof exceptionId !== "string") {
    return NextResponse.json({ error: "exceptionId is required" }, { status: 400 });
  }

  const context = await fetchExceptionContext(exceptionId);
  if (!context) {
    return NextResponse.json({ error: "exception not found" }, { status: 404 });
  }

  let explanation: string;
  try {
    explanation = await explainException(context);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }

  await prisma.financeException.update({ where: { id: exceptionId }, data: { aiExplanation: explanation } });

  return NextResponse.json({ exceptionId, explanation });
}
