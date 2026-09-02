import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDashboardStats } from "@/lib/queries/dashboard";
import { MatchStatusChart } from "@/components/dashboard/match-status-chart";

// No fetch()/dynamic-API usage here to signal it, so without this the page
// would be statically prerendered at build time and serve frozen DB data.
export const dynamic = "force-dynamic";

const SEVERITY_META = [
  { key: "LOW", label: "Low", color: "var(--status-good)" },
  { key: "MEDIUM", label: "Medium", color: "var(--status-warning)" },
  { key: "HIGH", label: "High", color: "var(--status-serious)" },
  { key: "CRITICAL", label: "Critical", color: "var(--status-critical)" },
] as const;

function formatInr(amount: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
}

export default async function DashboardPage() {
  const stats = await getDashboardStats();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Volume, match rate, exceptions, and pending settlement.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Transactions</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold tabular-nums">{stats.totals.transactions}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Match rate</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold tabular-nums">{stats.matchRate}%</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Pending review</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold tabular-nums">{stats.reviewQueueCount}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Pending settlement</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold tabular-nums">{formatInr(stats.pendingSettlementAmount)}</CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Match status breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <MatchStatusChart breakdown={stats.matchStatusBreakdown} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Open exceptions by severity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              {SEVERITY_META.map((s) => (
                <div key={s.key} className="flex items-center justify-between rounded-md border px-3 py-2">
                  <span className="flex items-center gap-2 text-sm">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                    {s.label}
                  </span>
                  <span className="text-lg font-semibold tabular-nums">{stats.exceptionsBySeverity[s.key] ?? 0}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
