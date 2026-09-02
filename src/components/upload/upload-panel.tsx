"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Source = "orders" | "transactions" | "settlements";

interface UploadResult {
  source: string;
  rowCount: number;
  inserted: number;
  skipped: number;
  errors: { row: number; message: string }[];
}

const SOURCE_META: Record<Source, { label: string; hint: string }> = {
  orders: { label: "Orders", hint: "order_ref, amount, currency, order_date, customer_name" },
  transactions: { label: "Transactions", hint: "transaction_ref, order_ref, amount, currency, payment_date, status" },
  settlements: { label: "Settlements", hint: "settlement_ref, transaction_ref, gross_amount, fee, tax, net_amount, settlement_date" },
};

function UploadSlot({ source }: { source: Source }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);

  async function handleUpload() {
    if (!file) return;
    setBusy(true);
    setResult(null);
    try {
      const formData = new FormData();
      formData.set("source", source);
      formData.set("file", file);
      const response = await fetch("/api/upload", { method: "POST", body: formData });
      const json = (await response.json()) as UploadResult;
      if (!response.ok) {
        toast.error((json as unknown as { error?: string }).error ?? "Upload failed");
        return;
      }
      setResult(json);
      if (json.errors.length === 0) {
        toast.success(`${SOURCE_META[source].label}: ${json.inserted} row(s) inserted`);
      } else {
        toast.warning(`${SOURCE_META[source].label}: ${json.inserted} inserted, ${json.errors.length} row error(s)`);
      }
    } catch {
      toast.error("Network error — could not reach the server");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{SOURCE_META[source].label}</CardTitle>
        <p className="text-xs text-muted-foreground">{SOURCE_META[source].hint}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="text-sm file:mr-3 file:rounded-md file:border file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium"
        />
        <Button onClick={handleUpload} disabled={!file || busy} size="sm" className="w-fit">
          {busy ? "Uploading…" : "Upload"}
        </Button>
        {result && (
          <div className="rounded-md border p-2 text-xs">
            <p>
              {result.rowCount} row(s) parsed, {result.inserted} inserted, {result.skipped} skipped.
            </p>
            {result.errors.length > 0 && (
              <ul className="mt-1 list-disc pl-4 text-[var(--status-critical)]">
                {result.errors.slice(0, 5).map((e, i) => (
                  <li key={i}>
                    row {e.row}: {e.message}
                  </li>
                ))}
                {result.errors.length > 5 && <li>…and {result.errors.length - 5} more</li>}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function UploadPanel() {
  const router = useRouter();
  const [reconciling, setReconciling] = useState(false);
  const [reconcileResult, setReconcileResult] = useState<Record<string, number> | null>(null);

  async function runReconcile() {
    setReconciling(true);
    setReconcileResult(null);
    try {
      const response = await fetch("/api/reconcile", { method: "POST" });
      const json = await response.json();
      if (!response.ok) {
        toast.error(json.error ?? "Reconciliation failed");
        return;
      }
      setReconcileResult(json);
      toast.success("Reconciliation complete");
      router.refresh();
    } catch {
      toast.error("Network error — could not reach the server");
    } finally {
      setReconciling(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 md:grid-cols-3">
        <UploadSlot source="orders" />
        <UploadSlot source="transactions" />
        <UploadSlot source="settlements" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Run reconciliation</CardTitle>
          <p className="text-xs text-muted-foreground">Runs exact match, fuzzy match, and exception detection over everything not yet reconciled.</p>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Button onClick={runReconcile} disabled={reconciling} className="w-fit">
            {reconciling ? "Reconciling…" : "Run reconciliation"}
          </Button>
          {reconcileResult && (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-muted-foreground sm:grid-cols-4">
              {Object.entries(reconcileResult).map(([key, value]) => (
                <div key={key} className="flex justify-between gap-2">
                  <dt>{key.replace(/([A-Z])/g, " $1").toLowerCase()}</dt>
                  <dd className="font-medium text-foreground tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
