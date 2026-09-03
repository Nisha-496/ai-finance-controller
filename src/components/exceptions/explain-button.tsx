"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function ExplainButton({ exceptionId, initialExplanation }: { exceptionId: string; initialExplanation: string | null }) {
  const [explanation, setExplanation] = useState(initialExplanation);
  const [loading, setLoading] = useState(false);

  async function explain() {
    setLoading(true);
    try {
      const response = await fetch("/api/ai/explain", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ exceptionId }),
      });
      const json = await response.json();
      if (!response.ok) {
        toast.error(json.error ?? "Explanation failed");
        return;
      }
      setExplanation(json.explanation);
    } catch {
      toast.error("Network error — could not reach the server");
    } finally {
      setLoading(false);
    }
  }

  if (explanation) {
    return <p className="mt-1 rounded-md bg-secondary/60 p-2 text-xs text-foreground">✦ {explanation}</p>;
  }

  return (
    <Button size="xs" variant="outline" onClick={explain} disabled={loading} className="mt-1">
      {loading ? "Explaining…" : "Explain with AI"}
    </Button>
  );
}
