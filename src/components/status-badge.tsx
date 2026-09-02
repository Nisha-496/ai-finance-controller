import { Badge } from "@/components/ui/badge";

const MATCH_STATUS_META: Record<string, { label: string; color: string }> = {
  MATCHED: { label: "Matched", color: "var(--status-good)" },
  AMOUNT_MISMATCH: { label: "Amount mismatch", color: "var(--status-serious)" },
  MISSING_SETTLEMENT: { label: "Missing settlement", color: "var(--status-warning)" },
  UNMATCHED: { label: "Unmatched", color: "var(--muted-foreground)" },
};

const REVIEW_STATUS_META: Record<string, { label: string; color: string }> = {
  NOT_REQUIRED: { label: "Not required", color: "var(--muted-foreground)" },
  PENDING_REVIEW: { label: "Pending review", color: "var(--status-warning)" },
  APPROVED: { label: "Approved", color: "var(--status-good)" },
  REJECTED: { label: "Rejected", color: "var(--status-critical)" },
};

const SEVERITY_META: Record<string, { label: string; color: string }> = {
  LOW: { label: "Low", color: "var(--status-good)" },
  MEDIUM: { label: "Medium", color: "var(--status-warning)" },
  HIGH: { label: "High", color: "var(--status-serious)" },
  CRITICAL: { label: "Critical", color: "var(--status-critical)" },
};

function DotBadge({ label, color }: { label: string; color: string }) {
  return (
    <Badge variant="outline" className="gap-1.5">
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </Badge>
  );
}

export function MatchStatusBadge({ status }: { status: string }) {
  const meta = MATCH_STATUS_META[status] ?? { label: status, color: "var(--muted-foreground)" };
  return <DotBadge label={meta.label} color={meta.color} />;
}

export function ReviewStatusBadge({ status }: { status: string }) {
  const meta = REVIEW_STATUS_META[status] ?? { label: status, color: "var(--muted-foreground)" };
  return <DotBadge label={meta.label} color={meta.color} />;
}

export function SeverityBadge({ severity }: { severity: string }) {
  const meta = SEVERITY_META[severity] ?? { label: severity, color: "var(--muted-foreground)" };
  return <DotBadge label={meta.label} color={meta.color} />;
}
