// Stage 1 — Normalization (ARCHITECTURE.md Section 5).
// Pure functions only, no DB/IO — keeps this independently testable and reusable
// from both the reconciliation engine and the CSV upload validator.

const LONG_FORM_PREFIXES: [RegExp, string][] = [
  [/^order/, "ord"],
  [/^transaction/, "txn"],
  [/^settlement/, "stl"],
];

// "ORDER-12345", "ORDER_12345", "order12345" -> "ord12345"
export function normalizeReference(raw: string): string {
  let s = raw.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const [prefix, replacement] of LONG_FORM_PREFIXES) {
    if (prefix.test(s)) {
      s = s.replace(prefix, replacement);
      break;
    }
  }
  return s;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  "₹": "INR",
  "$": "USD",
  "€": "EUR",
  "£": "GBP",
};

export function normalizeCurrency(raw: string | null | undefined): string {
  if (!raw) return "INR";
  const trimmed = raw.trim();
  if (trimmed in CURRENCY_SYMBOLS) return CURRENCY_SYMBOLS[trimmed];
  return trimmed.toUpperCase();
}

// Strips currency symbols/thousand separators and rounds to paise/cents to avoid
// float drift before amounts are compared or written to a Decimal column.
export function normalizeAmount(raw: string | number): number {
  if (typeof raw === "number") return Math.round(raw * 100) / 100;
  const cleaned = raw.replace(/[₹$€£,\s]/g, "");
  const value = Number(cleaned);
  if (Number.isNaN(value)) {
    throw new Error(`normalizeAmount: cannot parse amount "${raw}"`);
  }
  return Math.round(value * 100) / 100;
}

const DATE_FORMATS: ((s: string) => Date | null)[] = [
  // YYYY-MM-DD (ISO, what our own CSVs use)
  (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
  },
  // DD/MM/YYYY (common in Indian bank/gateway exports)
  (s) => {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
    return m ? new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])) : null;
  },
  // MM-DD-YYYY
  (s) => {
    const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s);
    return m ? new Date(Date.UTC(+m[3], +m[1] - 1, +m[2])) : null;
  },
];

// Parses to a UTC midnight Date so date-only comparisons in Stage 4 aren't
// affected by time-of-day noise from whichever source recorded the timestamp.
export function normalizeDate(raw: string | Date): Date {
  if (raw instanceof Date) {
    return new Date(Date.UTC(raw.getUTCFullYear(), raw.getUTCMonth(), raw.getUTCDate()));
  }
  const trimmed = raw.trim();
  for (const parse of DATE_FORMATS) {
    const d = parse(trimmed);
    if (d && !Number.isNaN(d.getTime())) return d;
  }
  const fallback = new Date(trimmed);
  if (!Number.isNaN(fallback.getTime())) {
    return new Date(Date.UTC(fallback.getUTCFullYear(), fallback.getUTCMonth(), fallback.getUTCDate()));
  }
  throw new Error(`normalizeDate: cannot parse date "${raw}"`);
}
