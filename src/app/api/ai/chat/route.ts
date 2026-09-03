// POST /api/ai/chat — { "message": string, "history"?: {role, content}[] }.
// The client resends prior turns each request; nothing is persisted server-side
// (no chat_messages table — out of scope for the hackathon core).

import { NextRequest, NextResponse } from "next/server";
import { buildChatContext } from "@/lib/queries/ai-context";
import { chatWithAssistant, type ChatMessage } from "@/lib/ai";

function isChatMessage(v: unknown): v is ChatMessage {
  return (
    typeof v === "object" &&
    v !== null &&
    ((v as ChatMessage).role === "user" || (v as ChatMessage).role === "assistant") &&
    typeof (v as ChatMessage).content === "string"
  );
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const message = body?.message;
  const history = Array.isArray(body?.history) ? body.history.filter(isChatMessage) : [];

  if (typeof message !== "string" || message.trim() === "") {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  const context = await buildChatContext();

  let reply: string;
  try {
    reply = await chatWithAssistant(context, [...history, { role: "user", content: message }]);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }

  return NextResponse.json({ reply });
}
