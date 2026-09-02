import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listPendingReview } from "@/lib/queries/review";
import { ReviewActions } from "@/components/review/review-actions";

// Same reasoning as dashboard/page.tsx — force dynamic so approvals/rejections
// are reflected immediately instead of a stale build-time snapshot.
export const dynamic = "force-dynamic";

function formatInr(amount: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(amount);
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-16 text-muted-foreground">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-chart-1" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
      <span className="w-10 text-right tabular-nums text-muted-foreground">{value}%</span>
    </div>
  );
}

export default async function ReviewPage() {
  const { total, results } = await listPendingReview();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Review queue</h1>
        <p className="text-sm text-muted-foreground">
          {total} suggested match{total === 1 ? "" : "es"} awaiting approval — confidence 80–94%, never auto-matched.
        </p>
      </div>

      {results.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">Nothing pending review right now.</CardContent>
        </Card>
      )}

      <div className="flex flex-col gap-4">
        {results.map((r) => (
          <Card key={r.id}>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base font-medium">
                Confidence {Number(r.confidence)}%
              </CardTitle>
              <ReviewActions id={r.id} />
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-1 rounded-md border p-3">
                <span className="text-xs font-medium text-muted-foreground">Transaction</span>
                <span className="font-mono text-sm">{r.transaction?.transactionRef ?? "—"}</span>
                <span className="text-sm text-muted-foreground">
                  {r.transaction ? formatInr(Number(r.transaction.amount)) : ""} · {r.transaction?.paymentDate.toISOString().slice(0, 10)}
                </span>
              </div>
              <div className="flex flex-col gap-1 rounded-md border p-3">
                <span className="text-xs font-medium text-muted-foreground">Proposed settlement</span>
                <span className="font-mono text-sm">{r.settlement?.settlementRef ?? "—"}</span>
                <span className="text-sm text-muted-foreground">
                  {r.settlement ? formatInr(Number(r.settlement.grossAmount)) : ""} · {r.settlement?.settlementDate.toISOString().slice(0, 10)}
                </span>
              </div>
              <div className="flex flex-col gap-2 md:col-span-2">
                <span className="text-xs font-medium text-muted-foreground">Why it was flagged</span>
                <ScoreBar label="Reference" value={Number(r.referenceSimilarity ?? 0)} />
                <ScoreBar label="Amount" value={Number(r.amountSimilarity ?? 0)} />
                <ScoreBar label="Date" value={Number(r.dateSimilarity ?? 0)} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
