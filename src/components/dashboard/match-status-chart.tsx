"use client";

import { Bar, BarChart, Cell, LabelList, XAxis, YAxis } from "recharts";

const STATUS_META: Record<string, { label: string; color: string }> = {
  MATCHED: { label: "Matched", color: "var(--status-good)" },
  AMOUNT_MISMATCH: { label: "Amount mismatch", color: "var(--status-serious)" },
  MISSING_SETTLEMENT: { label: "Missing settlement", color: "var(--status-warning)" },
  UNMATCHED: { label: "Unmatched", color: "var(--border)" },
};

const ORDER = ["MATCHED", "AMOUNT_MISMATCH", "MISSING_SETTLEMENT", "UNMATCHED"];

export function MatchStatusChart({ breakdown }: { breakdown: Record<string, number> }) {
  const data = ORDER.filter((key) => breakdown[key] !== undefined).map((key) => ({
    key,
    label: STATUS_META[key].label,
    count: breakdown[key],
    color: STATUS_META[key].color,
  }));

  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">No reconciliation results yet.</p>;
  }

  return (
    <BarChart
      width={480}
      height={40 * data.length + 20}
      data={data}
      layout="vertical"
      margin={{ top: 4, right: 32, bottom: 4, left: 0 }}
    >
      <XAxis type="number" hide />
      <YAxis type="category" dataKey="label" width={140} tickLine={false} axisLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 13 }} />
      <Bar dataKey="count" radius={[4, 4, 4, 4]} barSize={22}>
        {data.map((entry) => (
          <Cell key={entry.key} fill={entry.color} />
        ))}
        <LabelList dataKey="count" position="right" style={{ fill: "var(--foreground)", fontSize: 13, fontWeight: 500 }} />
      </Bar>
    </BarChart>
  );
}
