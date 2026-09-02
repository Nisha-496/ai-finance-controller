"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function ReviewActions({ id }: { id: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busyAction, setBusyAction] = useState<"APPROVE" | "REJECT" | null>(null);

  async function act(action: "APPROVE" | "REJECT") {
    setBusyAction(action);
    try {
      const response = await fetch(`/api/reconciliation/${id}/review`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = await response.json();
      if (!response.ok) {
        toast.error(json.error ?? "Review action failed");
        return;
      }
      toast.success(action === "APPROVE" ? "Match approved" : "Match rejected");
      startTransition(() => router.refresh());
    } catch {
      toast.error("Network error — could not reach the server");
    } finally {
      setBusyAction(null);
    }
  }

  const disabled = busyAction !== null || isPending;

  return (
    <div className="flex gap-2">
      <Button size="sm" onClick={() => act("APPROVE")} disabled={disabled}>
        {busyAction === "APPROVE" ? "Approving…" : "Approve"}
      </Button>
      <Button size="sm" variant="outline" onClick={() => act("REJECT")} disabled={disabled}>
        {busyAction === "REJECT" ? "Rejecting…" : "Reject"}
      </Button>
    </div>
  );
}
