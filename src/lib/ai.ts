// Section 10 — the AI layer. The one rule that matters more than any other
// here: AI never gets free database/SQL access. Every function in this file
// takes already-fetched, already-typed data as input — never a query, never a
// connection. The LLM only ever explains/summarizes what it's handed.

import OpenAI from "openai";

// Google's Gemini free tier via its OpenAI-compatible endpoint — no billing
// required, just a Google account. See .env.example for how to get a key.
let client: OpenAI | null = null;

function getClient(): OpenAI {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_API_KEY is not set — the AI layer has no provider configured.");
  }
  client ??= new OpenAI({ apiKey, baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/" });
  return client;
}

const MODEL = "gemini-3.6-flash";
// This model spends part of its token budget on internal reasoning before the
// visible reply, so max_tokens needs real headroom above what the answer
// itself needs — 150-300 silently truncated responses mid-sentence in testing.

// ---------------------------------------------------------------------------
// Exception explanation
// ---------------------------------------------------------------------------

export interface ExceptionExplanationInput {
  exceptionType: string;
  severity: string;
  description: string;
  paymentAmount: number | null;
  settlementGross: number | null;
  fee: number | null;
  tax: number | null;
  difference: number | null;
}

// Builds the exact, bounded context the model is allowed to see — nothing
// beyond these fields, no matter what the caller has access to elsewhere.
export function buildExceptionPrompt(input: ExceptionExplanationInput): string {
  const lines = [
    `Exception type: ${input.exceptionType}`,
    `Severity: ${input.severity}`,
    `System-generated description: ${input.description}`,
  ];
  if (input.paymentAmount !== null) lines.push(`Payment amount: ₹${input.paymentAmount.toFixed(2)}`);
  if (input.settlementGross !== null) lines.push(`Settlement gross amount: ₹${input.settlementGross.toFixed(2)}`);
  if (input.fee !== null) lines.push(`Fee: ₹${input.fee.toFixed(2)}`);
  if (input.tax !== null) lines.push(`Tax: ₹${input.tax.toFixed(2)}`);
  if (input.difference !== null) lines.push(`Unexplained difference: ₹${input.difference.toFixed(2)}`);

  return [
    "You are a finance operations assistant. Explain the following reconciliation exception in one or two plain-language sentences for a finance operator.",
    "Only use the numbers given below — never invent, estimate, or assume any figure not explicitly listed.",
    "Be concrete: state the amounts involved and what's unresolved.",
    "",
    ...lines,
  ].join("\n");
}

export async function explainException(input: ExceptionExplanationInput): Promise<string> {
  const prompt = buildExceptionPrompt(input);
  const response = await getClient().chat.completions.create({
    model: MODEL,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.2,
    max_tokens: 3000,
  });
  return response.choices[0]?.message?.content?.trim() ?? "";
}

// ---------------------------------------------------------------------------
// Finance assistant chat
// ---------------------------------------------------------------------------

export interface ChatContext {
  totals: { orders: number; transactions: number; settlements: number };
  matchRate: number;
  reviewQueueCount: number;
  pendingSettlementAmount: number;
  exceptionsBySeverity: Record<string, number>;
  reviewQueueSample: { transactionRef: string | null; settlementRef: string | null; confidence: number }[];
}

// The chat endpoint's "structured query layer": the backend decides what data
// is relevant to a question (Section 10) before anything reaches the model.
// This stays deliberately simple for the hackathon scope — always includes
// the dashboard snapshot plus a sample of the review queue, since those cover
// the sample questions in ARCHITECTURE.md Section 11. It does not run
// arbitrary queries chosen by the model.
export function buildChatSystemPrompt(context: ChatContext): string {
  return [
    "You are the AI Finance Assistant for a reconciliation platform. Answer the user's question using ONLY the structured data below — never invent numbers, never guess at data you don't have.",
    "If the data below doesn't answer the question, say so explicitly rather than guessing.",
    "Be concise — a few sentences, not an essay.",
    "",
    "=== Current reconciliation snapshot ===",
    `Orders: ${context.totals.orders}, Transactions: ${context.totals.transactions}, Settlements: ${context.totals.settlements}`,
    `Match rate: ${context.matchRate}%`,
    `Pending review: ${context.reviewQueueCount}`,
    `Pending settlement amount: ₹${context.pendingSettlementAmount.toFixed(2)}`,
    `Open exceptions by severity: ${JSON.stringify(context.exceptionsBySeverity)}`,
    "",
    "=== Sample of items in the review queue ===",
    context.reviewQueueSample.length === 0
      ? "(none)"
      : context.reviewQueueSample
          .map((r) => `- transaction ${r.transactionRef ?? "?"} <-> settlement ${r.settlementRef ?? "?"}, confidence ${r.confidence}%`)
          .join("\n"),
  ].join("\n");
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export async function chatWithAssistant(context: ChatContext, history: ChatMessage[]): Promise<string> {
  const response = await getClient().chat.completions.create({
    model: MODEL,
    messages: [{ role: "system", content: buildChatSystemPrompt(context) }, ...history],
    temperature: 0.3,
    max_tokens: 3000,
  });
  return response.choices[0]?.message?.content?.trim() ?? "";
}
