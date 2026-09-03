import Link from "next/link";
import { LayoutDashboard, Receipt, Percent, ClipboardCheck, Wallet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDashboardStats } from "@/lib/queries/dashboard";
import { MatchStatusChart } from "@/components/dashboard/match-status-chart";
import { SeverityBadge } from "@/components/status-badge";
import { PageHeader } from "@/components/page-header";

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

function StatCard({ icon: Icon, label, value }: { icon: typeof Receipt; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between p-5">
        <div>
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight">{value}</p>
        </div>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">
          <Icon className="h-5 w-5" strokeWidth={2} />
        </span>
      </CardContent>
    </Card>
  );
}

export default async function DashboardPage() {
  const stats = await getDashboardStats();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader icon={LayoutDashboard} title="Dashboard" description="Volume, match rate, exceptions, and pending settlement." />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard icon={Receipt} label="Transactions" value={String(stats.totals.transactions)} />
        <StatCard icon={Percent} label="Match rate" value={`${stats.matchRate}%`} />
        <StatCard icon={ClipboardCheck} label="Pending review" value={String(stats.reviewQueueCount)} />
        <StatCard icon={Wallet} label="Pending settlement" value={formatInr(stats.pendingSettlementAmount)} />
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

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Recent exceptions</CardTitle>
          <Link href="/exceptions" className="text-xs font-medium text-brand hover:underline">
            View all
          </Link>
        </CardHeader>
        <CardContent className="flex flex-col divide-y">
          {stats.recentExceptions.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No exceptions yet.</p>}
          {stats.recentExceptions.map((e) => (
            <div key={e.id} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
              <div className="flex items-center gap-3">
                <SeverityBadge severity={e.severity} />
                <div>
                  <p className="text-sm font-medium">{e.exceptionType.replace(/_/g, " ")}</p>
                  <p className="line-clamp-1 max-w-md text-xs text-muted-foreground">{e.description}</p>
                </div>
              </div>
              <span className="shrink-0 font-mono text-xs text-muted-foreground">
                {e.reconciliationResult?.transaction?.transactionRef ?? e.reconciliationResult?.settlement?.settlementRef ?? "—"}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
