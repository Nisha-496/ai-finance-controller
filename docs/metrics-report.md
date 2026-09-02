# Measured accuracy report

Generated 2026-09-02T07:39:19.157Z by `scripts/evaluate.ts` against `data/eval/` — 180 deals,
held out and never shown in the live demo. Regenerate anytime with:

```
npm run script scripts/evaluate.ts
```

## Headline numbers

| Metric | Value |
|---|---|
| Deals evaluated | 180 |
| True-pair match precision | 100.0% |
| True-pair match recall | 90.7% |
| F1 | 95.1 |
| **False auto-match rate** (of everything auto-matched at >=95%) | 0.0% (0/86) |
| Review-queue accuracy (proposed settlement actually correct) | 100.0% (27/27) |

## What these mean

- **Precision** — of every pair the engine matched (exact, fuzzy auto, or
  fuzzy-flagged-for-review), how many were the *right* pair. False positives
  here are the dangerous failure mode: money reconciled against the wrong
  transaction.
- **Recall** — of every genuinely matching pair in the held-out set, how many
  the engine actually found (exact + fuzzy auto + fuzzy review combined).
  Recall misses aren't silent — they surface honestly as
  MISSING_SETTLEMENT / MISSING_PAYMENT exceptions rather than being dropped.
- **False auto-match rate** is the number that matters most for trust: it's
  restricted to the >=95% confidence tier that gets written as MATCHED with no
  human involved. It should be at or near 0% — Development Rule 5 exists
  specifically to keep this tier conservative.
- **Review-queue accuracy** is not required to be perfect — the whole point of
  the 80-94% tier is that a human decides. What matters is that the queue is
  worth a human's time, i.e., this number should be meaningfully above chance.

## Exception detection

Planted exceptions across the eval set (by type), and how many the engine raised:

| Exception type | Planted | Raised |
|---|---|---|
| AMOUNT_MISMATCH | 21 | 21 |
| MISSING_PAYMENT | 10 | 21 |
| MISSING_SETTLEMENT | 6 | 17 |
| DUPLICATE_TRANSACTION | 10 | 30 |
| PENDING_TRANSACTION | 9 | 9 |

## Pipeline summary for this run

| Stage | Result |
|---|---|
| Stage 2 (exact match) | 107 matched, 10 duplicate groups |
| Stage 4 (fuzzy match) | 0 auto-matched, 27 sent to review |
| Stage 5 (exceptions) | 17 missing settlement, 21 missing payment, 9 pending, 0 invalid calculations |

This is not a cherry-picked run — it's the full held-out set, every time.
