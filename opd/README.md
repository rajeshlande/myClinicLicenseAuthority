# `opd/` — the OPD multi-tenant knowledge base, committed

Everything in this directory used to live **only** in an unversioned workspace directory
(`/home/user`) — not in a git repo, not in any bundle, one `rm -rf` away from gone. It is the
operational half of this project: the spec, the owner decisions, the runbooks, the phase
tracker, the push script and all ten browser harnesses. Committing it closes tracker task
**L11** ("back up `/home/user` itself").

**Nothing here is application source.** This branch adds documentation and test harnesses
only — no `src/`, no `supabase/`, no workflow, no dependency and no schema change. Central's
`main` is untouched, so `EXPECT_CENTRAL` in `push-groundwork.sh` and the
`myclinic-license-authority-groundwork.bundle` used for the push both stay exactly as verified.

---

## Inventory

| File | What it is |
|---|---|
| `opd-multitenant-implementation-plan.md` | **R1** — the 664-line implementation plan. §2 decision gates D1–D5, §3 corrections C1–C12, §9 the App 2 engine, §11 phases P0–P8, §12.3 the go/no-go checklist, §14 operator runbooks, §15 risks R1–R14 |
| `opd-multitenant-plan-improvements.md` | **R2** — the improvement pass. **R2 wins on conflicts** |
| `OPD-DECISIONS.md` | The owner decision register (D1′ RS256 capability token, D4-a, D5 pilot-first, D6-A, `p7_topology = separate_repos`, `demo_slug_fix = fix_booking_live`, free-tier constraints) plus the slice register with every commit sha |
| `OPD-PHASE-TRACKER.md` | **Start here.** Living tracker: phase status P0–P8, offline tasks T1–T9, live tasks L1–L11, the §12.3 boxes, the deviations register, and the commands that re-derive every number in it |
| `OPD-DEPLOYMENT-RUNBOOK.md` | P7 operator runbook: topology, what CI enforces, per-repo domain steps, Auth + CORS, release pattern, rollback, **§8 keep-warm verification** |
| `OPD-PILOT-MIGRATION-RUNBOOK.md` | P8 pilot: preconditions, provisioning, verification, flipping the flag, the acceptance day, the rollback rehearsal, **§8 operator actions by hand**, §8.5 the offline rehearsal evidence |
| `OPD-BACKUP-RUNBOOK.md` | Backups and the restore drill: what a dump does and does not cover, `pg_dump` recipes, retention, count/checksum verification, **§7 RS256 signing-key escrow** |
| `push-groundwork.sh` | The push path for both repos — fast-forward only, never `--force`, refuses a stale bundle or a mismatched `EXPECT_*`. `push-v3.0.0.sh` is **stale and must not be used**; it is deliberately not committed here |
| `harness/*.cjs` | Ten Playwright harnesses — the only proof of the browser-level guarantees (two-tab isolation, booking tenant resolution, key rotation, the §8.4 operator actions). **T6**: byte-identical to `myclinic/harness/`, where they now run in CI |

---

## Running the harnesses from a checkout

**Canonical home: `myclinic/harness/`.** Tracker task **T6** moved all ten into the
clinic repo and made them layout-agnostic — no `/tmp/pw` resolve, no absolute
`/home/user` path. The copies under `opd/harness/` here are a byte-identical
**snapshot** of that directory, kept so the knowledge base still carries the
evidence; they are not the executable copy. From a fresh clone of
`myclinic-groundwork.bundle`:

```bash
cd myclinic
npm ci
npx playwright install chromium       # CI uses --with-deps
npm run test:e2e                      # 8 suites · 137 browser assertions
```

Playwright **1.65.0** is a pinned devDependency; it has no postinstall browser
download, hence the explicit install step. `test:e2e` is deliberately **not** part
of `verify` (the fast local loop): a separate `.github/workflows/e2e.yml` job runs
on PRs **and on `main`**, which `ci.yml` deliberately skips.

The runner builds `dist-gate/` (directory mode, mock Central env) and `dist/`
(flag off), serves `:5211`–`:5214`, runs the eight asserting suites
**sequentially** — ports are shared, so two at once races — and removes both
outputs in `finally`, even on failure. `dist-gate/` is gitignored as of T6.
`tests/e2e-wiring.test.mjs` ratchets the dependency, the CI job, the async spawn,
the port/suite lists and the cleanup.

| Port | Harnesses |
|---|---|
| `:5211` | `p4b-smoke.cjs` |
| `:5212` | `p4-acceptance.cjs`, `p5b-clinical.cjs`, `p5c-outbox.cjs` (`p4-debug.cjs` is a diagnostic) |
| `:5213` | `p5d-booking.cjs`, `p5e-schema-guard.cjs`, `p5e-setup.cjs` |
| `:5214` | `p5e-setup.cjs` — the flag-off, single-project build |
| `:5215` | `p8-s14-rehearsal.cjs` (starts and stops its own server; the runner does NOT bind this port) |

Two files are deliberately **not** in `npm run test:e2e`, so a green CI run cannot
claim them: `p4-debug.cjs` prints state but asserts nothing and has no exit code,
and `p8-provision.cjs` is a live PostgreSQL 17 proof needing a scratch database
and a sibling Central repo. Run those by hand.

The same files still work from the old workspace layout (`/home/user/harness/`
beside `/home/user/myclinic/`): the repo-root resolver probes `../` for a
`package.json` and falls back to `../myclinic/`. They now use a bare
`require('playwright')`, so from outside the repo set `NODE_PATH` at a Playwright
install — e.g. `NODE_PATH=/home/user/myclinic/node_modules node harness/p8-s14-rehearsal.cjs`.

Every mock host in the harnesses (`central-mock`, `harbour-mock`, `meridian-mock`, …)
is a fake. They are safe to commit because both secret scanners scope to `src/` —
myClinic's `check-no-tenant-secrets` walks `src/`, `.env.example`, `scripts/` and
`dist/assets/`, and Central's `check-admin-static` walks `src/` only. **Do not move
these files under `scripts/`**, and assemble any mock host inside `scripts/` from
parts: a contiguous `*.supabase.co` literal there trips the ratchet.

---

## Verification state at this commit

| Check | Result |
|---|---|
| Central `npm run verify` | **181/181** with this directory committed; contributing 27/27 · 0 warn |
| Central `main` | `c3d3456` — **T10**: 1 file (+16/−7), `scripts/run-tests.mjs` feature-detects `--test-isolation` so the Node 22 `ci.yml` job no longer aborts |
| CI Node matrix | **22.22.0 and 26.13.1 both green** — myClinic 988/988 + e2e 8/8, Central 181/181; see **T10** in the tracker |
| myClinic `main` | `3f18863` — **T10**: 1 file (+17/−1), the storage-resolver test no longer assumes Node has no `sessionStorage`; **T6** (20 files, +2378/−1) is its parent. 988/988 + `test:e2e` 8/8 from a fresh clone; the matching branch was fast-forwarded |
| Push readiness | `DRY_RUN=1 ./push-groundwork.sh` EXIT 0 on both rails: myClinic `b1e174e → 3f18863` (**23 commits**), Central `da36c7b → c3d3456` (15). Nothing pushed |

---

## Deliberately not committed

| Excluded | Why |
|---|---|
| `push-v3.0.0.sh` | **Stale and dangerous**: asserts `EXPECT_MAIN=da36c7b` (Central is at `c3d3456`), tells the operator to apply Central schema **v4** (it is **v8**), and has no path for the myClinic repo |
| `scratch-sync-preview.html` / `.jsx` | Untracked scratch in Central's working tree. Never `git add` them |
| `CLIENT-CONTRACT-*.md`, `CLIENT-SYNC-DIAGNOSTIC.md`, `ENROLLIQ-ADAPTATION-PLAN.md`, `IMPROVEMENT-PLAN.md` | Pre-OPD workspace documents, unrelated to this project |
| The git bundles | Build artifacts, regenerated by `git bundle create … --all` |

---

## Dates in these documents disagree — trust the commit graph

The machine clock, the commit dates and the prose in `OPD-DECISIONS.md` do not agree (see the
date caveat at the top of `OPD-PHASE-TRACKER.md`). Where chronology matters:

```bash
git log --format='%h %ad %s' --date=short
```
