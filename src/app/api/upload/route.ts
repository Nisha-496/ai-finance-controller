// POST /api/upload — one CSV from one source at a time (Section 13).
// multipart/form-data: `source` (orders|transactions|settlements), `file`.

import { NextRequest, NextResponse } from "next/server";
import Papa from "papaparse";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { normalizeReference, normalizeAmount, normalizeCurrency, normalizeDate } from "@/lib/normalization";

type Source = "orders" | "transactions" | "settlements";
const SOURCES: Source[] = ["orders", "transactions", "settlements"];

interface RowError {
  row: number;
  message: string;
}

function requireField(row: Record<string, string>, field: string): string {
  const value = row[field];
  if (!value || value.trim() === "") throw new Error(`missing required field "${field}"`);
  return value;
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const source = formData.get("source");
  const file = formData.get("file");

  if (typeof source !== "string" || !SOURCES.includes(source as Source)) {
    return NextResponse.json({ error: `source must be one of: ${SOURCES.join(", ")}` }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  const text = await file.text();
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
  if (parsed.errors.length > 0) {
    return NextResponse.json({ error: "CSV parse error", details: parsed.errors.slice(0, 5) }, { status: 400 });
  }

  const rows = parsed.data;
  const errors: RowError[] = [];
  let inserted = 0;

  if (source === "orders") {
    const data: Prisma.OrderCreateManyInput[] = [];
    rows.forEach((r, i) => {
      try {
        const orderRef = requireField(r, "order_ref");
        data.push({
          orderRef,
          normalizedOrderRef: normalizeReference(orderRef),
          amount: normalizeAmount(requireField(r, "amount")),
          currency: normalizeCurrency(r.currency),
          orderDate: normalizeDate(requireField(r, "order_date")),
          customerName: r.customer_name || null,
          rawRow: r,
        });
      } catch (err) {
        errors.push({ row: i + 2, message: (err as Error).message });
      }
    });
    inserted = (await prisma.order.createMany({ data, skipDuplicates: true })).count;
  } else if (source === "transactions") {
    const data: Prisma.TransactionCreateManyInput[] = [];
    rows.forEach((r, i) => {
      try {
        const transactionRef = requireField(r, "transaction_ref");
        const orderRef = r.order_ref || null;
        const status = (r.status || "SUCCESS").toUpperCase();
        if (!["SUCCESS", "PENDING", "FAILED"].includes(status)) {
          throw new Error(`invalid status "${r.status}" — expected SUCCESS, PENDING, or FAILED`);
        }
        data.push({
          transactionRef,
          normalizedTransactionRef: normalizeReference(transactionRef),
          orderRefOnPayment: orderRef,
          normalizedOrderRefOnPayment: orderRef ? normalizeReference(orderRef) : null,
          amount: normalizeAmount(requireField(r, "amount")),
          currency: normalizeCurrency(r.currency),
          paymentDate: normalizeDate(requireField(r, "payment_date")),
          status: status as "SUCCESS" | "PENDING" | "FAILED",
          rawRow: r,
        });
      } catch (err) {
        errors.push({ row: i + 2, message: (err as Error).message });
      }
    });
    inserted = (await prisma.transaction.createMany({ data, skipDuplicates: true })).count;
  } else {
    const data: Prisma.SettlementCreateManyInput[] = [];
    rows.forEach((r, i) => {
      try {
        const settlementRef = requireField(r, "settlement_ref");
        const transactionRef = r.transaction_ref || null;
        data.push({
          settlementRef,
          normalizedSettlementRef: normalizeReference(settlementRef),
          transactionRefOnSettlement: transactionRef,
          normalizedTransactionRefOnSettlement: transactionRef ? normalizeReference(transactionRef) : null,
          grossAmount: normalizeAmount(requireField(r, "gross_amount")),
          fee: normalizeAmount(r.fee || "0"),
          tax: normalizeAmount(r.tax || "0"),
          netAmount: normalizeAmount(requireField(r, "net_amount")),
          settlementDate: normalizeDate(requireField(r, "settlement_date")),
          rawRow: r,
        });
      } catch (err) {
        errors.push({ row: i + 2, message: (err as Error).message });
      }
    });
    inserted = (await prisma.settlement.createMany({ data, skipDuplicates: true })).count;
  }

  return NextResponse.json({ source, rowCount: rows.length, inserted, skipped: rows.length - inserted - errors.length, errors });
}
