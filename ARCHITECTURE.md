# AI Finance Controller — Architecture
Razorpay AI Buildathon 2026 — Track 04: "AI Finance Controller"
Official problem statement: *"Run the books and the cash position."*
Direction chosen: **Multi-source reconciliation** (one of Track 04's four listed directions)
Official bar: *"Throughput plus measured accuracy plus an honest exception list. One cherry-picked match proves nothing."*

Solo build, 4 days.

---

## 1. How this maps to actual judging

The Buildathon scores on four pillars. Everything below is designed against these, not against a generic "build a reconciliation tool" brief.

| Pillar | What it means | Where this build answers it |
|---|---|---|
| **Problem Taste** | Real, meaningful merchant/financial problem | Multi-source reconciliation is an official Track 04 direction — payment/settlement mismatches are a real Razorpay-adjacent pain point |
| **Build Quality** | Clean repo, execution reliability, code trust | Separated `match_status`/`review_status`, stored confidence breakdown, one-module-at-a-time build order, typed Prisma schema |
| **AI Judgment** | Use AI where it earns its place; deterministic where AI is unnecessary | Matching engine is 100% deterministic (normalization + similarity scoring); AI is scoped to exception explanation + chat, and only ever sees data the backend already fetched — never raw DB access, never invents numbers |
| **Failure Recovery** | Show what broke and how it got fixed | `docs/development-log.md` maintained continuously, real issues only — not backfilled |

**The gap the original plan doc missed:** the bar explicitly says *"one cherry-picked match proves nothing"* and submission requires *"measured performance metrics on held-out test sets."* A demo CSV alone doesn't satisfy this — you need a labeled ground-truth set, held separate from whatever's shown live, so the pitch can state real precision/recall numbers instead of "look, it matched these three."

**Fix:** Section 7 below — an evaluation module is a first-class part of this build, not an afterthought.

---

## 2. Tech stack

| Layer | Choice |
|---|---|
| Frontend | Next.js + TypeScript + Tailwind CSS + shadcn/ui + Recharts |
| Backend | Next.js API Routes (single repo) |
| Database | PostgreSQL + Prisma ORM |
| Data processing | CSV parser (papaparse) |
| Fuzzy matching | Deterministic normalization + similarity scoring + confidence calculation — no LLM involved |
| AI | OpenAI API — used only for exception explanation, natural-language chat, and (if time allows) forward cash summary — never for matching decisions |

One Next.js repo — keeps a solo 4-day build manageable and keeps "Build Quality" easy to demonstrate (one `git clone`, one `npm run dev`).

---

## 3. System architecture

```
                    Next.js App
  Dashboard | Transactions | Exceptions | Review | Assistant
                        │
                        ▼
                    API Layer
  Upload | Reconcile | Dashboard | Review | AI | Evaluate
                        │
        ┌───────────────┼───────────────┬───────────────┐
        ▼               ▼               ▼               ▼
   CSV Parser      Reconciliation    AI Layer       Evaluation
   & Validation       Engine        (Explain/Chat)   Engine
        │               │               │               │
        └───────────────┼───────────────┴───────────────┘
                         ▼
                 PostgreSQL + Prisma
```

`Evaluation Engine` is new versus the original plan — it runs the reconciliation engine against a held-out labeled dataset and produces a metrics report, independent of the live demo data.

---

## 4. Core data flow

```
CSV Upload
    ↓
Validation
    ↓
Normalization (Stage 1)
    ↓
Store in DB
    ↓
Deterministic Matching (exact reference match, priority order)
    ↓
Exact match? ──YES──→ MATCHED (confidence 100%)
    │
    NO
    ↓
Fuzzy Matching → Confidence Score
    ↓
┌────────┬──────────┬──────────┐
▼        ▼          ▼
≥95%    80–94%     <80%
AUTO    REVIEW     UNMATCHED
MATCH   QUEUE
```

---

## 5. Reconciliation engine — stages

**Stage 1 — Normalization**
Normalize reference IDs (`ORDER-12345`, `ORDER_12345`, `order12345` → `ord12345`), dates, currency, decimal amounts.

**Stage 2 — Exact Matching** (checked in this priority order, stop at first hit)
1. Exact transaction ID match
2. Exact settlement transaction reference match
3. Exact normalized order reference match
4. Multiple exact candidates for the same record → flag `DUPLICATE`/`AMBIGUOUS`, do not auto-match
5. No deterministic match at any of the above → proceed to fuzzy matching

**Stage 3 — Amount Validation**
Compare payment amount to settlement **gross** amount, never net directly:
`Gross Amount − Fee − Tax = Net Amount`
Prevents legitimate gateway fees from being misclassified as mismatches.

**Stage 4 — Fuzzy Matching**
When references don't match exactly, compute similarity across reference, amount, and date.

**Confidence formula:**
```
Confidence = (Reference Similarity × 50%)
           + (Amount Similarity × 30%)
           + (Date Similarity × 20%)
```

---

## 6. Match decision policy + review workflow

```
Confidence ≥ 95%   → AUTO MATCH
Confidence 80–94%  → AI-SUGGESTED MATCH → review queue (human approval required)
Confidence < 80%   → UNMATCHED
```

Two separate status fields — never merged:

```
match_status:  MATCHED | UNMATCHED | MISSING_SETTLEMENT | AMOUNT_MISMATCH
review_status: NOT_REQUIRED | PENDING_REVIEW | APPROVED | REJECTED
```

| Tier | match_status | review_status |
|---|---|---|
| Exact match | MATCHED (confidence 100) | NOT_REQUIRED |
| Fuzzy, ≥95% | MATCHED (confidence = score) | NOT_REQUIRED |
| Fuzzy, 80–94% | UNMATCHED | PENDING_REVIEW |
| Fuzzy, <80% | UNMATCHED | NOT_REQUIRED |

`SUGGESTED_MATCH` is not a stored value — it's `UNMATCHED` + `PENDING_REVIEW`, so the UI filters on `review_status` without a redundant state.

Review lifecycle (80–94% tier only):
```
PENDING_REVIEW → Manual Review → APPROVE → match_status = MATCHED, review_status = APPROVED
                               → REJECT  → match_status = UNMATCHED, review_status = REJECTED
```

Review APIs:
- `GET /api/reconciliation/review` — all `PENDING_REVIEW` records with confidence breakdown (reference/amount/date scores) so the reviewer sees *why* it was flagged
- `PATCH /api/reconciliation/:id/review` — `{ "action": "APPROVE" | "REJECT" }`

---

## 7. Evaluation engine — measured accuracy (new)

Directly answers the submission requirement: *"measured performance metrics on held-out test sets."*

- `data/eval/` holds a **ground-truth dataset**, generated alongside the demo CSVs but never shown live: each record pre-labeled with the correct outcome (should match / shouldn't / is a duplicate / is a genuine mismatch), including deliberately hard cases (ID format drift, fee-adjusted amounts, near-duplicate references, off-by-one-day settlements).
- `scripts/evaluate.ts` runs the reconciliation engine against this set and computes, per confidence tier and overall:
  - Precision / recall / F1 for MATCHED calls
  - False-auto-match rate (the number that actually matters for trust — how often a ≥95% AUTO MATCH was wrong)
  - Review-queue accuracy (of items sent to 80–94%, how many a human ultimately approved)
  - Exception detection recall (did it catch every planted mismatch/duplicate/missing settlement)
- Output: `docs/metrics-report.md` — the concrete numbers for the pitch. This is what turns "it matched these" into "94% precision on auto-match, 100% recall on planted duplicates, 3 false positives out of 250 held-out records."

This module gets built once the deterministic core (Stages 1–4) is stable — see Day 2 in the build order — and re-run any time matching logic changes.

---

## 8. Exception engine

Types: `AMOUNT_MISMATCH`, `MISSING_SETTLEMENT`, `MISSING_PAYMENT`, `DUPLICATE_TRANSACTION`, `PENDING_TRANSACTION`, `INVALID_SETTLEMENT_CALCULATION`
Severity: `LOW`, `MEDIUM`, `HIGH`, `CRITICAL` (threshold-based, defined in `lib/exceptions.ts`)

Example: Payment ₹10,000 vs Settlement Gross ₹9,500 → `AMOUNT_MISMATCH`, difference ₹500 → severity by threshold.

---

## 9. AI layer — guardrails first

**AI never gets free database/SQL access.**

```
User Question
    ↓
Intent Detection
    ↓
Structured Query Layer (backend fetches only relevant rows)
    ↓
Safe Context assembled
    ↓
LLM (explains/summarizes only what it was given)
    ↓
Natural Language Answer
```

- **AI Exception Explanation** — input: payment amount, settlement gross, difference, fee, tax → output: plain-language explanation (e.g. *"₹500 lower than payment; ₹236 explained by known fees, ₹264 unresolved — needs review."*)
- **AI Finance Assistant** — chat answering from structured data the backend retrieves first (e.g. "which transactions need review" pulls from the review queue, not from free-form SQL)

This is the part that gets scored on **AI Judgment** — the pitch explicitly states matching is deterministic and names exactly where AI is used and why, rather than vaguely gesturing at "AI-powered."

---

## 10. Application pages

`/dashboard` `/transactions` `/reconciliation` `/exceptions` `/review` `/upload` `/assistant`

## 11. Full API list

```
POST  /api/upload
POST  /api/reconcile
GET   /api/dashboard
GET   /api/transactions
GET   /api/exceptions
GET   /api/reconciliation/review
PATCH /api/reconciliation/:id/review
POST  /api/ai/explain
POST  /api/ai/chat
```
Plus `scripts/evaluate.ts` (not a route — run via CLI/CI, produces `docs/metrics-report.md`).

## 12. Database schema

Entities: `orders → transactions → settlements → reconciliation_results → finance_exceptions`

Key fields:
- `settlements`: `gross_amount`, `fee`, `tax`, `net_amount` (kept separate — Stage 3)
- `reconciliation_results`: `match_status`, `review_status`, `confidence`, `reference_similarity`, `amount_similarity`, `date_similarity` (store the breakdown, not just the final score — needed for the review UI and the evaluation report)
- `finance_exceptions`: `exception_type`, `severity`, `description`, `ai_explanation`, `status`

## 13. Project structure

```
ai-finance-controller/
├── app/
│   ├── dashboard/ transactions/ reconciliation/
│   ├── exceptions/ review/ upload/ assistant/
│   └── api/
│       ├── upload/ reconcile/ dashboard/
│       ├── transactions/ exceptions/
│       ├── reconciliation/review/
│       └── ai/ chat/ explain/
├── components/
│   ├── dashboard/ transactions/ exceptions/ review/ assistant/
├── lib/
│   ├── reconciliation.ts  normalization.ts  matching.ts
│   ├── confidence.ts  exceptions.ts  ai.ts
├── prisma/
│   └── schema.prisma
├── data/
│   ├── demo/       ← sample CSVs shown live (intentional ID/format mismatches)
│   └── eval/       ← held-out ground-truth set, never shown live
├── scripts/
│   └── evaluate.ts
└── docs/
    ├── development-log.md
    └── metrics-report.md
```

---

## 14. Build order — 4 days, solo

**Day 1**
1. Next.js project + Prisma schema (all 5 tables, both status fields)
2. Sample CSVs — demo set *and* held-out eval set with ground-truth labels, deliberate ID-format mismatches and fee-based differences
3. Normalization logic (`normalization.ts`)
4. Deterministic exact-match reconciliation engine (`reconciliation.ts`)

**Day 2**
5. Fuzzy matching + confidence formula (`matching.ts`, `confidence.ts`) + match decision policy
6. Exception detection engine (`exceptions.ts`)
7. Core APIs: upload, reconcile, dashboard, transactions, exceptions
   *Checkpoint: full reconciliation + exceptions works end-to-end without AI or review UI.*
8. `scripts/evaluate.ts` — first real metrics run against the eval set

**Day 3**
9. Review workflow: `GET /reconciliation/review` + `PATCH /:id/review`
10. Dashboard + transactions + exceptions + review UI
11. CSV upload UI
    *Checkpoint: working demo, AI still not added — deterministic core is provably solid before layering AI on top.*

**Day 4 — protected, non-negotiable AI time**
12. AI explanation layer (`ai.ts`, structured-context-only prompts)
13. AI finance chat/assistant
14. Polish: loading states, error handling, demo reset, `development-log.md`, re-run `evaluate.ts` for final numbers, pitch script, record 5-minute pitch video

If Day 3 runs long: cut UI polish (extra filters, chart variety) before cutting into Day 4. AI Judgment is a scored pillar — it cannot be the thing that gets dropped.

---

## 15. Development rules

1. Build one module at a time — do not generate the whole project in one go.
2. Test and confirm each module before moving to the next.
3. Keep deterministic financial calculations fully separate from AI code.
4. AI only explains structured data it's given — never invents numbers, never gets raw DB/SQL access.
5. Fuzzy matches must respect confidence thresholds — no auto-writing `MATCHED` below 95%.
6. Keep `match_status` and `review_status` as separate fields, always.
7. Use realistic sample data with deliberate mismatches — demo set for the live walkthrough, eval set held out for measured accuracy.
8. Maintain `docs/development-log.md` continuously with real issues and real fixes — do not backfill fake ones.
9. Get the deterministic core (Day 1–2) fully working and measured before touching AI.

---

## 16. Submission checklist

- [ ] Public repository
- [ ] 5-minute pitch video
- [ ] This architecture doc (kept current)
- [ ] `docs/metrics-report.md` — measured precision/recall/false-match-rate on the held-out set, not cherry-picked demo output
- [ ] `docs/development-log.md` — real issues, real fixes
