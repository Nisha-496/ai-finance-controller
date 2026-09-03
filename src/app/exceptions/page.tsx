import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SeverityBadge } from "@/components/status-badge";
import { ExplainButton } from "@/components/exceptions/explain-button";
import { PageHeader } from "@/components/page-header";
import { listExceptions } from "@/lib/queries/exceptions";

const SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
const TYPES = ["AMOUNT_MISMATCH", "MISSING_SETTLEMENT", "MISSING_PAYMENT", "DUPLICATE_TRANSACTION", "PENDING_TRANSACTION", "INVALID_SETTLEMENT_CALCULATION"];

export default async function ExceptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ severity?: string; type?: string; page?: string }>;
}) {
  const params = await searchParams;
  const page = Number(params.page) || 1;
  const { total, pageSize, exceptions } = await listExceptions({ severity: params.severity, type: params.type, page });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader icon={TriangleAlert} title="Exceptions" description={`${total} total.`} />

      <form className="flex flex-wrap items-end gap-3" action="/exceptions">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="severity" className="text-xs font-medium text-muted-foreground">
            Severity
          </label>
          <select id="severity" name="severity" defaultValue={params.severity ?? ""} className="h-9 rounded-md border bg-background px-3 text-sm">
            <option value="">All</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="type" className="text-xs font-medium text-muted-foreground">
            Type
          </label>
          <select id="type" name="type" defaultValue={params.type ?? ""} className="h-9 rounded-md border bg-background px-3 text-sm">
            <option value="">All</option>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="secondary">
          Filter
        </Button>
        {(params.severity || params.type) && (
          <Link href="/exceptions" className={buttonVariants({ variant: "ghost" })}>
            Clear
          </Link>
        )}
      </form>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Severity</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Raised</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {exceptions.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No exceptions match this filter.
                  </TableCell>
                </TableRow>
              )}
              {exceptions.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>
                    <SeverityBadge severity={e.severity} />
                  </TableCell>
                  <TableCell className="text-xs font-medium">{e.exceptionType.replace(/_/g, " ")}</TableCell>
                  <TableCell className="max-w-md whitespace-normal text-sm text-muted-foreground">
                    <p>{e.description}</p>
                    <ExplainButton exceptionId={e.id} initialExplanation={e.aiExplanation} />
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {e.reconciliationResult?.transaction?.transactionRef ?? e.reconciliationResult?.settlement?.settlementRef ?? "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{e.createdAt.toISOString().slice(0, 10)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 text-sm">
          {page > 1 && (
            <Link className="text-muted-foreground hover:text-foreground" href={{ pathname: "/exceptions", query: { ...params, page: page - 1 } }}>
              Previous
            </Link>
          )}
          <span className="text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          {page < totalPages && (
            <Link className="text-muted-foreground hover:text-foreground" href={{ pathname: "/exceptions", query: { ...params, page: page + 1 } }}>
              Next
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
