# Development log

Real issues hit during the build and how they were actually resolved — kept live,
not backfilled after the fact (Development Rule 8, ARCHITECTURE.md).

## 2026-09-02 — Day 1

**Prisma CLI's "latest" tag is a beta cloud-platform CLI, not the ORM CLI.**
`npm install prisma @prisma/client` pulled `prisma@8.0.0-rc.12`, which turned out to
be a public-beta rewrite of the CLI around Prisma's own cloud platform (`prisma auth
login`, `prisma project create`, `prisma git connect`) — not what a local,
self-hosted Postgres hackathon build needs. `@prisma/client`'s "latest" was still
7.10.0, so the two packages had drifted apart. Fixed by pinning both to `7.10.0`
explicitly, which kept the standard local `schema.prisma` + `migrate dev` workflow.

**Prisma 7 requires a driver adapter; schema.prisma can no longer hold the DB url.**
`datasource.url = env("DATABASE_URL")` in schema.prisma now fails validation
(`P1012`) — connection config moved to `prisma7.config.ts`, and `PrismaClient` must
be constructed with an explicit `adapter` (`@prisma/adapter-pg` wrapping `pg`)
instead of connecting implicitly. Wired this up in `src/lib/db.ts`.

**Local Postgres (`prisma dev`) was reachable but `PrismaClient` still got
`ECONNREFUSED`.** A raw `pg` client connected fine to `127.0.0.1:51214`, but the
same URL with `localhost` failed. Node was resolving `localhost` to `::1` (IPv6)
while the dev server only listens on IPv4. Fixed by using `127.0.0.1` in
`DATABASE_URL` instead of `localhost`.

**Standalone scripts saw `DATABASE_URL` as `undefined`.** Next.js auto-loads `.env`;
plain `tsx`/`node` do not. Fixed by running one-off scripts with Node's native
`--env-file=.env` flag (`npm run script <path>`), rather than adding a `dotenv`
import to every script.

**Amount+date coincidence let fuzzy matching cross the review threshold on a
completely wrong pair.** Cross-checking `matching.ts` against the ~44 leftover
transactions competing for each unresolved settlement in `data/eval/`, one orphan
settlement (`STL-102000`, genuinely no matching transaction — a `MISSING_PAYMENT`
case) scored 86.3% confidence against an unrelated transaction that just happened
to have a similar amount on a nearby date, crossing the 80% review threshold on a
weak (78%) reference match alone. With dozens of candidates in a batch, the
original `amountSimilarity` curve (zero similarity only past a 20% relative gap)
was lenient enough that amount+date coincidence alone could rescue a mediocre
reference. Tightened the curve to zero out past a 5% relative gap — confirmed the
same pair now scores 77.9%, correctly below threshold — and relaxed the test's
assumption that every `FUZZY_BORDERLINE` case must recover (some are deliberately
marginal and should legitimately stay unresolved; what matters is that whatever
*does* get matched is matched correctly, which now holds for all 54 cross-checked
deals). Caught by testing against the real eval set's full candidate pool, not
hand-picked one-pair fixtures — a two-candidate unit test would never have
surfaced a collision that only shows up with dozens of competing candidates.

## 2026-09-03 — Day 4

**No budget for OpenAI.** The architecture doc specified OpenAI, and `src/lib/ai.ts`
was built against it — but there was no money for API credit. Switched to Google
Gemini's free tier (no billing, just a Google account) via its OpenAI-compatible
endpoint, so the rest of the code (the `openai` SDK client, the whole prompt/context
design) didn't need to change — only the base URL, API key env var, and model name.

**Stale model name.** `gemini-2.0-flash` no longer exists — Google's error message
named the replacement directly (`gemini-3.6-flash`), so no guessing was needed once
a real API key was in hand to surface the real error.

**Responses were silently truncated mid-sentence.** With `max_tokens: 150`, the
first live call returned literally one word ("The"). Root cause: this model spends
part of its token budget on internal reasoning before the visible reply, so a small
`max_tokens` starves the actual answer. Fixed by raising it to 3000 for both
`explainException` and `chatWithAssistant` — confirmed via direct calls outside any
UI that the full, correct explanation now comes back before touching the API routes
or components at all.

**Confirmed both AI paths live, in a real browser, not just via direct script
calls.** The exceptions page's "Explain with AI" button and the assistant chat both
verified end to end with Playwright — actual click, actual network request, actual
model response rendered and (for explanations) persisted to `aiExplanation` and
visible again on page reload. The first attempt at this test closed the browser
after a fixed 6-second wait and looked like a failure; the real issue was the test
not waiting for the actual response before closing, not the feature.

## 2026-09-02 — Day 3

**`prisma dev`'s local Postgres proxy breaks under 2+ genuinely simultaneous
connections.** `/dashboard` fired 7 queries via `Promise.all` and consistently
failed on the 3rd one with `P1017 ConnectionClosed` — reproducible outside
Next.js too, and always at the same array index regardless of which query was
there (confirmed by reordering). Root cause isn't the query, the model, or pool
sizing (`max: 5` didn't help) — it's specifically *simultaneous new connection
establishment* against the local dev proxy (a preview tool, `prisma dev
v0.16.28`). Fixed by capping the adapter's pool at `max: 1` in `src/lib/db.ts`,
which serializes all DB access through one connection — a fine tradeoff for a
single-demo-user hackathon app, not something to ship to real production
traffic without revisiting. Re-verified every prior test script still passes
after the change.

**Two pages were silently static-prerendered at build time.** `/dashboard` and
`/review` query Prisma directly with no `fetch()`/dynamic-API usage for Next.js
to key off, so without an explicit signal they got frozen into build-time HTML
— the review queue would never have updated after a deploy. Not caught by
`npm run build` type-checking; only visible in the route table's `○` vs `ƒ`
column. Fixed with `export const dynamic = "force-dynamic"` on both.

**A shadcn-generated CSS variable was self-referential.** `globals.css` shipped
`--font-sans: var(--font-sans)` — resolves to nothing, so every page silently
fell back to the browser's default serif font. Only visible in a real
screenshot, not in a build log or a passing test. Fixed to point at the actual
Geist variable (`--font-geist-sans`), matching the working `--font-mono` line
right next to it.

**Long exception descriptions overlapped the adjacent table columns.** shadcn's
`TableCell` defaults to `whitespace-nowrap`; a `max-w-md` without an explicit
`whitespace-normal` override doesn't wrap, it just visually spills into the
next column. Caught the same way — a real screenshot, not the build.

All four of these were invisible to `tsc`, `next build`, and every prior
integration test — they only surfaced by actually starting the dev server,
loading pages in a real headless browser (Playwright), and looking at the
screenshots. That's now part of how every UI change in this project gets
verified, not optional polish.

**First full pipeline run exposed a naive test assumption, not a bug.**
`scripts/test-exceptions.ts` seeds a real Postgres database from `data/eval/` and
runs all three stages (`reconciliation.ts` -> `matching.ts` -> `exceptions.ts`) end
to end. Initial assertions expected `MISSING_SETTLEMENT`/`MISSING_PAYMENT`
exception counts to equal the ground truth's scenario counts directly (6 and 10).
Actual counts came back higher (17 and 21). Root cause: 11 of 17 `FUZZY_BORDERLINE`
deals are deliberately marginal and legitimately fail to recover in Stage 4 — and
correctly cascade into "missing" rather than vanishing (`6 + 11 = 17`,
`10 + 11 = 21`, exact). Fixed the test to assert the real invariant (every Stage 4
leftover is accounted for) instead of assuming perfect fuzzy recall. Also added a
`status != FAILED` filter to both `reconciliation.ts` and `matching.ts`'s queries
while building this — a failed payment should never compete for a settlement
match in the first place.

**Data generator produced an accidental cross-deal collision.** `perturbDigits()`
originally picked a random digit position to simulate a typo. With deal cores only
1 apart (100000, 100001, ...), a 1-digit perturbation of deal 100055 landed exactly
on deal 100015's real ID a few indices away. `reconciliation.ts` correctly flagged
it as a genuine duplicate — but that corrupted the ground truth for both deals,
since neither was actually supposed to be ambiguous. Caught by
`scripts/test-reconciliation.ts`'s cross-check against the real eval dataset (a
hand-written fixture wouldn't have surfaced this). Fixed by restricting
perturbation to trailing digits only and spacing deal cores 1000 apart, making the
collision structurally impossible rather than just unlikely. Regenerated both
datasets after the fix; all 313 assertions across the normalization and
reconciliation verification scripts pass.
