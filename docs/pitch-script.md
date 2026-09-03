# Pitch script — 5 minutes

For the Razorpay AI Buildathon submission video. Timings are approximate targets,
not hard stops — adjust pacing to how it actually feels when you say it out loud.
Before recording: run `npm run demo:reset` so the app is in a known, clean state.

---

## 0:00–0:40 — The problem (Problem Taste)

> "Every payment gateway merchant runs into the same wall: payments come in from
> one system, settlements come in from another, and someone has to manually check
> that they match. Reference IDs get reformatted between systems. Gateway fees
> get subtracted before the money lands. Duplicates happen. Settlements go
> missing. Most teams do this in a spreadsheet.
>
> I built AI Finance Controller — a reconciliation platform that does this
> deterministically, correctly, and fast — and only reaches for AI where AI
> actually earns its place: explaining exceptions and answering questions in
> plain language. It never touches the matching logic itself."

## 0:40–1:00 — The one rule (sets up everything else)

> "The whole build follows one rule: never call rule-based matching 'AI.' The
> matching engine — normalization, exact matching, fuzzy scoring, confidence
> tiering — is 100% deterministic. AI is scoped to exactly two things:
> explaining why an exception happened, and answering questions about the
> current state. That's it."

## 1:00–2:30 — Live walkthrough (the core)

Screen-share the running app (`npm run dev`, already reset to demo state).

1. **`/upload`** — "Three CSVs, one per source — orders, payments, settlements.
   [upload the demo files if not already loaded] Then reconcile."
2. **`/dashboard`** — "Here's the result: match rate, exceptions by severity,
   pending settlement. [point at the chart] Green is matched. The other colors
   are real problems, not noise."
3. **`/transactions`** — "Every transaction, searchable, filterable by match
   status. [filter to AMOUNT_MISMATCH or similar] This one's flagged — gross
   settlement doesn't equal the payment, even after accounting for fee and tax."
4. **`/review`** — "This is the interesting tier. 80 to 94% confidence never
   auto-matches — it lands here with the full breakdown: reference similarity,
   amount similarity, date similarity, so a human can see *why* it was flagged
   before approving or rejecting. [click Approve or Reject on one]"
5. **`/exceptions`** — "Every exception, with severity. [click 'Explain with
   AI' on one] That's the AI layer — it only ever explains numbers the backend
   already fetched. It doesn't touch the database, and it can't invent a
   figure that isn't in this specific record."
6. **`/assistant`** — "Or just ask. [click a sample question] The answer is
   generated from the same structured data as the dashboard — not a free-form
   query the model made up."

## 2:30–3:30 — Why this deserves trust (Build Quality + AI Judgment)

> "Two design choices matter more than they look like they should.
>
> First: `match_status` and `review_status` are separate fields. A confidence
> score alone can't tell you both 'is this actually matched' and 'has a human
> signed off' — conflating them loses the audit trail. They're independent on
> purpose.
>
> Second: confidence isn't a guess. It's `reference similarity × 50% + amount
> similarity × 30% + date similarity × 20%` — and nothing gets auto-written as
> MATCHED below 95%, no exceptions, no overrides."

## 3:30–4:15 — The numbers (the bar: "one cherry-picked match proves nothing")

> "None of this means anything without measurement, so here's the real number,
> from a 180-deal held-out set that's never shown in the demo you just watched:
>
> - 100% match precision, 90.7% recall
> - **0% false auto-match rate** — every single auto-matched pair in the
>   held-out set was actually correct
> - 100% review-queue accuracy
> - Every planted exception type — amount mismatches, missing settlements,
>   missing payments, duplicates, pending transactions — correctly detected
>
> That's not the demo data. That's `npm run eval`, full held-out set, every
> time, checked into the repo at `docs/metrics-report.md`."

## 4:15–4:45 — What broke (Failure Recovery)

> "Two things worth mentioning, because they're the actual interesting part of
> building this. Testing the matching engine against real generated data — not
> hand-picked fixtures — caught a genuine precision bug: an orphan settlement
> was crossing the auto-match threshold purely on amount-and-date coincidence,
> with a weak reference match backing it. Fixed by making the amount-similarity
> curve steep enough that coincidence alone can't rescue a weak match. Every
> issue like that, real ones, is logged in `docs/development-log.md` as it
> happened — not written up afterward."

## 4:45–5:00 — Close

> "AI Finance Controller combines deterministic transaction matching with
> AI-assisted exception analysis and natural-language financial intelligence.
> Repo's public, metrics are measured, and every claim in this video is
> reproducible with two commands: `npm run demo:reset` and `npm run eval`."

---

## Recording checklist

- [ ] `npm run demo:reset` run right before recording
- [ ] Local Postgres running (`npm run db:dev` if not already up)
- [ ] `GOOGLE_API_KEY` set in `.env` so the AI demo doesn't fail on camera
- [ ] Dev server running (`npm run dev`), pages pre-loaded in tabs to avoid
      on-camera compile stalls
- [ ] Do one full silent dry run through all six pages before recording for real
