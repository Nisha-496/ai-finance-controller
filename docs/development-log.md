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
