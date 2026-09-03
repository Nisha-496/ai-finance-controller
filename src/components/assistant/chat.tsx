"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const SAMPLE_QUESTIONS = [
  "What are my biggest financial issues today?",
  "How much settlement is pending?",
  "Which transactions require manual review?",
];

export function AssistantChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function send(text: string) {
    if (!text.trim() || loading) return;
    const nextMessages: Message[] = [...messages, { role: "user", content: text }];
    setMessages(nextMessages);
    setInput("");
    setError(null);
    setLoading(true);
    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text, history: messages }),
      });
      const json = await response.json();
      if (!response.ok) {
        setError(json.error ?? "Chat request failed");
        return;
      }
      setMessages([...nextMessages, { role: "assistant", content: json.reply }]);
    } catch {
      setError("Network error — could not reach the server");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex min-h-[420px] flex-col">
        <CardContent className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
          {messages.length === 0 && (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
              <p>Ask about match rate, pending settlement, or what needs review — answered from live reconciliation data.</p>
              <div className="flex flex-wrap justify-center gap-2">
                {SAMPLE_QUESTIONS.map((q) => (
                  <Button key={q} size="sm" variant="outline" onClick={() => send(q)}>
                    {q}
                  </Button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${m.role === "user" ? "self-end bg-primary text-primary-foreground" : "self-start bg-secondary text-secondary-foreground whitespace-pre-wrap"}`}>
              {m.content}
            </div>
          ))}
          {loading && <div className="self-start rounded-lg bg-secondary px-3 py-2 text-sm text-muted-foreground">Thinking…</div>}
          {error && <div className="self-start rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
          <div ref={scrollRef} />
        </CardContent>
      </Card>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask the finance assistant…" disabled={loading} />
        <Button type="submit" disabled={loading || !input.trim()}>
          Send
        </Button>
      </form>
    </div>
  );
}
