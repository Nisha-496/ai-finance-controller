import Link from "next/link";
import { Receipt } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button, buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MatchStatusBadge } from "@/components/status-badge";
import { PageHeader } from "@/components/page-header";
import { listTransactions } from "@/lib/queries/transactions";

const MATCH_STATUSES = ["MATCHED", "UNMATCHED", "MISSING_SETTLEMENT", "AMOUNT_MISMATCH"];

function formatInr(amount: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(amount);
}

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; matchStatus?: string; page?: string }>;
}) {
  const params = await searchParams;
  const page = Number(params.page) || 1;
  const { total, pageSize, transactions } = await listTransactions({
    search: params.search,
    matchStatus: params.matchStatus,
    page,
  });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader icon={Receipt} title="Transactions" description={`${total} total.`} />

      <form className="flex flex-wrap items-end gap-3" action="/transactions">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="search" className="text-xs font-medium text-muted-foreground">
            Search reference
          </label>
          <Input id="search" name="search" defaultValue={params.search} placeholder="TXN-100000" className="w-56" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="matchStatus" className="text-xs font-medium text-muted-foreground">
            Match status
          </label>
          <select
            id="matchStatus"
            name="matchStatus"
            defaultValue={params.matchStatus ?? ""}
            className="h-9 rounded-md border bg-background px-3 text-sm"
          >
            <option value="">All</option>
            {MATCH_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="secondary">
          Filter
        </Button>
        {(params.search || params.matchStatus) && (
          <Link href="/transactions" className={buttonVariants({ variant: "ghost" })}>
            Clear
          </Link>
        )}
      </form>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Transaction ref</TableHead>
                <TableHead>Order ref</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Payment date</TableHead>
                <TableHead>Match status</TableHead>
                <TableHead className="text-right">Confidence</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transactions.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    No transactions match this filter.
                  </TableCell>
                </TableRow>
              )}
              {transactions.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-mono text-xs">{t.transactionRef}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{t.orderRefOnPayment ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatInr(Number(t.amount))}</TableCell>
                  <TableCell className="text-muted-foreground">{t.paymentDate.toISOString().slice(0, 10)}</TableCell>
                  <TableCell>
                    {t.reconciliationResult ? <MatchStatusBadge status={t.reconciliationResult.matchStatus} /> : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {t.reconciliationResult ? `${Number(t.reconciliationResult.confidence)}%` : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 text-sm">
          {page > 1 && (
            <Link className="text-muted-foreground hover:text-foreground" href={{ pathname: "/transactions", query: { ...params, page: page - 1 } }}>
              Previous
            </Link>
          )}
          <span className="text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          {page < totalPages && (
            <Link className="text-muted-foreground hover:text-foreground" href={{ pathname: "/transactions", query: { ...params, page: page + 1 } }}>
              Next
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
