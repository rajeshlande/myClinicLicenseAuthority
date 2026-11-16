# OPD Multi-Tenant — Phase & Task Tracker

**Living document.** This is the single place to answer *"what is done, what is pending,
and what exactly closes each pending item"*. It is derived from
`opd-multitenant-implementation-plan.md` (R1) + `opd-multitenant-plan-improvements.md` (R2)
and verified against the two repos, not against memory.

| As of | Value |
|---|---|
| Last verified | **2026-11-16** — `date -u` on this machine. See the date caveat below before trusting any date in this workspace |
| Workspace docs | `OPD-PHASE-TRACKER.md` (this file) · `OPD-DECISIONS.md` 187 · `OPD-DEPLOYMENT-RUNBOOK.md` 230 · `OPD-PILOT-MIGRATION-RUNBOOK.md` 359 · `OPD-BACKUP-RUNBOOK.md` 200 · `OPD-README.md` (committed as `opd/README.md` — the entry point for the snapshot: inventory, harness layout, port map, Playwright bootstrap, exclusions) — live copies in `/home/user`, snapshot committed under `opd/` on the Central branch `central_tenent_mangement` (**L11 closed**) |
| myClinic | `3f18863` (**T6 + T10 CI runtime fix**) · APP **1.43.0** · `SCHEMA_VERSION` **21** · tenant template **22** · **988 tests / 66 files** · 10 harnesses in `harness/`, 8 suites in `test:e2e` · dirty 0 |
| Central (myClinicLicenseAuthority) | `c3d3456` (**T10 CI runtime fix**) · APP **3.2.0** · schema **v8** · **181 tests / 31 files** · live SQL **73 PASS** · directory allowlist **5** · write chains **16/16** · dirty = 2 untracked scratch files |
| Contract | **v5**, sha `0f6377ad5b1ac8d889b8015d0191549aeae6f1125bc0bc2fc0cf700e2553994a`, byte-identical in both repos |
| Pushed? | **No.** Bundles: `myclinic-groundwork.bundle` (lands `3f18863`), `myclinic-license-authority-groundwork.bundle` (lands `c3d3456`), plus the two `-tenent-mangement.bundle` branch files. `DRY_RUN=1 ./push-groundwork.sh` EXIT 0 on both rails: myClinic `b1e174e → 3f18863` (**23 commits**), Central `da36c7b → c3d3456` (15). Byte sizes and ref counts are deliberately not recorded — bundles are re-cut on every commit, so both go stale immediately; `git bundle list-heads` is the source of truth |
| Branch bundles | `central-tenent-mangement.bundle` — `central_tenent_mangement` (= `main` + the `opd/` snapshot commit) + `main` · `myclinic-tenent-mangement.bundle` — `central_tenent_mangement` and `main` both `3f18863`. Because both are cut with `--all`, Central's branch bundle and its push bundle now carry **identical refs** — either file works for testing the branch. The branch tip sha moves whenever `opd/` is refreshed, so it is deliberately not recorded here; `git bundle list-heads` is the source of truth |
| Live PG17 evidence | myClinic base **156**, tenant **41**, Central **73** ⇒ **270 checks, 0 FAIL** |
| Browser harnesses | **T6 DONE** — 10 files in `myclinic/harness/`, byte-identical in `/home/user/harness/` and `opd/harness/`; bare `require('playwright')`, no `/tmp/pw`; `npm run test:e2e` **8/8 suites, 137 assertions** from a fresh clone; separate `e2e.yml` job on PRs + `main` |

> **Date caveat — dates in this workspace do not agree, so treat them as unreliable.**
> Three sources conflict: this machine's clock reads **2026-11-13 UTC**; every groundwork
> commit in both repos is dated **2026-11-13** (myClinic's first, `576ec0d`, is 2026-11-02;
> Central's first, `21e04e1`, is 2026-11-06); and `OPD-DECISIONS.md` is headed *"recorded
> 2026-11-11"* with *"Groundwork complete 2026-11-11; P1a–P3 and P4a landed 2026-11-12"* —
> i.e. the register's prose **pre-dates the commits it describes**. The session context
> supplied yet another date.
>
> The two T10 CI-compatibility commits are dated **2026-11-16**; everything from
> T1–T6 is dated 2026-11-13. That is a real elapsed gap, not a prose error.
>
> **Rule for this tracker:** where chronology matters, trust the commit graph
> (`git log --format='%h %ad %s' --date=short`), never prose. Stamp entries with `date -u`
> taken at verification time, and never back-fill a date from memory.

---

## 0. How to update this tracker (protocol)

The owner's standing instruction: **update this file after completing a phase or a task.**

1. Flip the task's **Status** cell and put the commit sha (or `docs-only`, or the date) in
   its **Closed by** cell. Never delete a row — mark it `SUPERSEDED`, `MOOT` or `DECLINED`
   with the reason, so the trail survives.
2. If that task was the last open one in a phase, flip the phase row in §1 and update its
   **What remains** cell to `—`.
3. Add one dated line to §7 **Update log**: what closed, the evidence that proved it
   (test counts, harness scores, live SQL PASS numbers), and anything it invalidated.
4. Re-verify the header table (HEADs, test counts, bundle sizes) whenever a commit lands —
   a stale header is worse than none. Use §6's commands; do not type numbers from memory.
5. If a task's completion invalidates a bundle pin, say so in the update log:
   **any myClinic commit invalidates `EXPECT_MYCLINIC`; any Central commit invalidates
   `EXPECT_CENTRAL`**, and both need the bundle re-cut + `DRY_RUN=1` re-proved.
6. If new evidence contradicts a claim in this file, correct the claim and record the
   correction in the update log. Three already exist: see T2, T9 and the §4 box count.
7. **The committed snapshot.** Every document here — plus the plan, the register,
   `push-groundwork.sh` and all ten harnesses — is also committed to the Central branch
   `central_tenent_mangement` under `opd/`. That copy is a **snapshot**, not a link: if you
   patch a document in `/home/user`, refresh `opd/` on the branch in the same turn, or the two
   drift — the exact failure this project ratchets against everywhere else. The live copy in
   `/home/user` is authoritative. Filename mapping: identical, except `OPD-README.md` here is
   `opd/README.md` there. Refresh with:
   `git -C myclinic-subscription-engine checkout central_tenent_mangement &&
   cp /home/user/OPD-*.md /home/user/opd-multitenant-*.md /home/user/push-groundwork.sh <repo>/opd/
   && cp /home/user/harness/*.cjs <repo>/opd/harness/ && git -C <repo> add opd/ && git -C <repo>
   commit --amend --no-edit` — then re-run `npm run verify`, re-cut the branch bundle and
   re-clone-test it, because an amended tip invalidates any bundle already cut from it.
   **A bundle's `HEAD` is whatever branch was checked out when it was cut**, and `git clone
   <bundle>` lands on that branch — so cut the *branch* bundle while on
   `central_tenent_mangement` (the owner must land on the docs) and the *push* bundle while on
   `main` (where `push-groundwork.sh` expects to be). Both are `--all`, so both carry every ref;
   only the landing branch differs. Check with
   `git bundle list-heads <file> | awk '$2=="HEAD"'` before handing either one over.
8. **Run the gates with the tree STAGED.** `check-contributing` scans `git ls-files`,
   so a NEW file is invisible to it until `git add`. T5's first `verify` passed 27/27
   with an untracked test file holding a `sb_secret_…` literal, then failed the moment
   it was committed. Order: write → `git add` → `npm run verify` → commit.
9. **After amending `main`, REBUILD any branch parented on the old sha — do not rebase
   it.** `git rebase main` replays the amended-away commit and conflicts on itself
   (exactly what happened to the `opd/` branch after T5's amend). Use
   `git checkout -B central_tenent_mangement main`, re-copy the snapshot, commit again.
   If a rebase is already stuck: `git rebase --abort`, then confirm `main` and the
   branch ref are both still where they were before touching anything else. And never
   chain a critical commit behind a command whose failure a pipe can hide —
   `git rebase … | tail -1` returns 0 even when the rebase stopped on a conflict.

10. **A runner that serves HTTP to its own children must spawn them asynchronously.**
    `spawnSync` freezes the parent's event loop, so servers living in it answer
    nothing and every `page.goto()` times out — the one harness serving itself in
    its own process stays GREEN and hides the fault (T6's first run: 1/8). A fixture
    that returns `[]` for every clinical table is the same class of false negative:
    the app correctly showed onboarding, so a missing sign-out button looked like an
    app regression. Re-run a harness from a clean clone before believing an old
    "all green" note — that is precisely what T6 made possible.

  11. **Prove the CI matrix on the versions it actually names.** Both repos pin
      `.nvmrc` to `26.13.0` and `pages.yml` uses `node-version-file`, while `ci.yml`
      runs `[22, 26]` — yet every T6 result had been taken on the sandbox's Node
      `v20.20.2`. Re-running on real 22/26 binaries found one `npm test` failure on
      Node 26 (a native `sessionStorage` global broke an assumption of absence) and
      an exit-9 abort on Node 22 (`--test-isolation=none` is only stable in Node 24+;
      Node 22 has the EXPERIMENTAL spelling). Prefer feature detection —
      `spawnSync(node, ['--flag', '--version'])` — to version arithmetic, and pin
      any global a test assumes rather than assuming the runtime has none. A green
      suite on the wrong runtime proves nothing about the deploy workflow.

**Legend** — `DONE` closed and proved · `DONE-DEVIATED` closed, deliberately not as the plan
worded it (see §5) · `PARTIAL` some tasks open · `OPEN` not started · `BLOCKED-LIVE` needs the
owner's real infrastructure · `MOOT` the requirement no longer applies, with evidence ·
`DECLINED` the owner explicitly chose not to do it.

---

## Next three actions

| # | Action | Who | Cost |
|---|---|---|---|
| 1 | **L1 → L5**: push both repos, watch Pages green, apply Central schema v8 (expect **73 PASS**), DNS/CNAME per repo, Auth redirect allowlist + tenant CORS | Owner (live) | ~1 session; nothing pushed until you run it |
| 2 | **L6 — the D1′ scratch-tenant token proof.** §12.3 box 1, and the only thing that actually gates the pilot | Owner (live) | 1–2 h; has designed fallbacks if third-party auth is unavailable |
| 3 | **L10 — escrow the RS256 signing key.** It is in no dump, no commit and no bundle (`keys/` and `*.pem` are gitignored; the only other copy is an unreadable Edge Function secret) | Owner (once, ~10 min) | Losing it invalidates every issued licence and every tenant's D1′ trust. `OPD-BACKUP-RUNBOOK.md` §7 |
| 4 | **No offline work remains.** T6 closed at myClinic `99c5ef7`; **T10** (below) closed the declared Node 22/26 CI matrix at `3f18863` / `c3d3456`; T7 DECLINED, T9 MOOT, L11 DONE. Everything left is owner-side and live (L1 → L12), gated on **L6** | Agent (offline) | The accepted cost was paid twice: both `EXPECT_*` re-pinned, all four bundles re-cut, `opd/` refreshed, `DRY_RUN=1` EXIT 0 |

---

## 1. Phase tracker (plan §11)

| Phase | Status | Closed by | What remains |
|---|---|---|---|
| **P0** Decisions & prerequisites | **PARTIAL** | decisions recorded in `OPD-DECISIONS.md` | **L6** — the acceptance criterion *"a Master token is accepted by a scratch tenant and `auth.uid()` returns the Master UUID"* is unproven. Also DNS/domain verification (**L4**) |
| **P1** Master schema & security | **DONE-DEVIATED** | Central `969e2e7`; schema v7 at close (v8 since T5); G1/G3, P1a `d446762`, P1b `96400c8`, P2 `a393fa0`, P3 `d468c7b`, P5d-i `89c5538` | — (deviations: no Edge Functions, `public.*` not `vault.*`, `clinic_activity_log` not `audit_log`, `is_license_admin()` not `platform_admins` — see §5) |
| **P2** App 1 Admin Portal | **DONE** | Central console: **10 pages** + the tenant Connection step; `check-admin-static` (`5f2e1b7`); **T5 `1dd0086`** added the §14 operator console (`#/directory`: list, deactivate/reactivate, rotate key, revoke, member editor, audit trail) | — (the old "no schema change needed" note was half wrong: the ACTIONS needed none, the AUDIT view did ⇒ `workspace_audit_log`, schema v8, owner decision `t5_audit = new_table`) |
| **P3** Tenant template | **DONE** | `supabase/tenant/{tenant-schema.sql, tenant-schema-tests.sql, README.md}`; contract v4→v5 | — (46 policies, **0** targeting anon, 7 `is_tenant_member()` gates, 11 `tenant_slug` pins, 41 live checks) |
| **P4** App 2 dual-client engine | **DONE** | P4a `5f6c684`, P4b `b1a7e54`, P4c `7d11a98`, F7 `cc23963` | — (two-tab isolation + 6-step sign-out proved in `harness/p4-acceptance.cjs` 15/15) |
| **P5** App 2 operational migration | **DONE** | P5a `daed5a5` … P5e-ii `b819f49`; P8e `2f24930` closed the booking fail-open | — (the 2 legacy singleton importers + 5 per-clinic env files stay frozen until **L9**) |
| **P6** Tests, ratchets, security | **DONE** | Central `5f2e1b7` + **`9a150ba`** (T1); myClinic's 4 scanners; mutation tests in both repos | — (all four ratchets now run automatically: `check:admin-static`, `check:tenant-accessor`, `check:tenant-secrets`, `check:write-verify`) |
| **P7** CI/CD & Pages topology | **DONE in code, UNPROVEN live** | myClinic `cbe5012`, Central `a3077cf` | **L2** — no Actions run has ever executed. Topology deviated to separate repos (§5) |
| **P8** Pilot & cutover | **PARTIAL — prep done, pilot not started** | P8-prep `5d91ae8`, Central §12 `6ba851e`, P8d `969e2e7`, P8e `2f24930`; `provision-tenant` 28/0; rehearsal 28/0 | **L7, L8, L9, L10** |

---

## 2. Pending tasks — offline (agent can do these here)

### T1 · Wire the `check-write-verify` ratchet into Central — **DONE** · *P6*

**Why it matters.** P8d exists because Central RLS refuses a non-admin **silently** on
UPDATE/DELETE (0 rows, no exception). The scanner proves all 9 privileged write chains count
their rows — but nothing runs it automatically, so a new unverified chain would ship quietly.

**Steps**
1. `package.json`: add `"check:write-verify": "node scripts/check-write-verify.mjs"` and
   append `&& npm run check:write-verify` to `verify`.
2. `.github/workflows/ci.yml` and `pages.yml`: add a `run: npm run check:write-verify` step
   next to the existing `check:admin-static` step (it scans `src/`, so it can run pre-build).
3. Add a drift test in the style `check-contributing` already uses: assert `package.json`'s
   `verify` contains `check:write-verify` **and** both workflows reference it.
4. Prove it bites: drop a `.select('id')` from one write site, confirm EXIT ≠ 0, restore.

**Proof of done** · `npm run verify` prints the write-verify block; mutation fails; 164 → ~166 tests.
**Cost / risk** · A Central commit ⇒ **re-cut the Central bundle + re-pin `EXPECT_CENTRAL` +
re-run `DRY_RUN=1`**. Do it *after* the push, or accept the re-cut before it.
**Closed 2026-11-13 by Central `9a150ba`** (4 files: `package.json`, `ci.yml`, `pages.yml`,
`tests/write-verify.test.mjs`). New `check:write-verify` script, `verify` ends with it, and a
step in each workflow carrying **no `env:`** — the scanner reads `src/` only, so unlike
`check:admin-static` it cannot be skipped for want of a secret (the step comment says so,
because "commented out until the secret exists" is how ratchets die). Three tests pin the
*wiring* rather than only the rule: the script exists **and** is one of the `&&` steps `verify`
actually runs; both workflows reference it; it reads no env. **Mutation-proved both ways, then
reverted byte-exact** (diff-verified against `/tmp` backups): dropping `.select('id')` from the
real `clinic_activity_log` append ⇒ EXIT 1 naming `activity.mjs:87 [clinic_activity_log] no
.select() read-back: a silent RLS refusal returns { data: null, error: null }`; unplugging the
`verify` step and neutering the `ci.yml` step ⇒ both wiring tests fail. `npm run verify` EXIT 0
at the committed tree: **167/167** (was 164), contributing 27/27 · 0 warn, ratchet 9/9 as the
last thing verify prints. **Invalidated and repaired:** `EXPECT_CENTRAL` re-pinned to
`9a150ba…`, the push script's header range corrected (`→ 9a150ba`, 13 commits), the Central
push bundle re-cut (24 refs, 851,162 B) and `DRY_RUN=1` re-proved EXIT 0 on both rails.

### T2 · Keep-warm verification steps in the runbooks — **DONE** · *P8* · docs-only

**Correction recorded:** an earlier audit note claimed keep-warm is "never scheduled".
**That was wrong.** `schema.sql` §8.5 ships the schedule — `cron.schedule('opd-keep-warm',
'17 */6 * * *', 'select public.run_keep_warm_cycle(20);')` — guarded on `pg_extension`
containing **both** pg_cron and pg_net, with a NOTICE either way and an exception handler.
Every 6 h against a 5-day target leaves 2 days of margin before the free tier's 7-day pause.

**The real gap:** the guard means the job silently does *not* exist if either extension is
off, the live SQL suite can only prove the `revoke` (a bare PG17 has no pg_cron), and **no
runbook tells the operator to confirm the job exists and fires**.

**Steps** — add to `OPD-DEPLOYMENT-RUNBOOK.md` (and to the pilot runbook §1 preconditions):
```sql
select extname from pg_extension where extname in ('pg_cron','pg_net');   -- both required
select jobid, jobname, schedule, command, active
  from cron.job where jobname = 'opd-keep-warm';                          -- '17 */6 * * *'
select status, return_message, start_time
  from cron.job_run_details order by start_time desc limit 8;             -- must show success
```
Plus the recovery path: if the extensions are off, applying `schema.sql` printed
`keep-warm: pg_cron/pg_net not enabled — Settings & Health probing only`; enable both in the
dashboard and re-apply (idempotent — re-scheduling the same job name replaces it). Note that
`run_keep_warm_cycle` is revoked from `public, anon, authenticated, service_role`, so **no
external caller can trigger it** — that is deliberate (no browser-driven fleet probe), and it
means pg_cron is the only scheduler that works without a deliberate grant change.

**Proof of done** · the three queries appear in both runbooks with expected outputs.
**Cost / risk** · none — workspace docs, no repo commit, no bundle impact.
**Closed 2026-11-13** · `OPD-DEPLOYMENT-RUNBOOK.md` gained **§8** (159 → 230 lines): both
producers documented with their real contract values (`pause_days` 7, `target_days` 5,
`17 */6 * * *`, probe `/rest/v1/`, stamp `keep_warm_at`), four verification queries with
expected outputs, the extension-guard failure mode, and why no external caller can run the
cycle (revoked from `service_role` too, so a GitHub Action is *not* an available fallback).
The pilot runbook §1 gained a keep-warm precondition. Live confirmation is **L7**.

### T3 · Mark the stale `PUB` decision row superseded — **DONE** · docs-only

`OPD-DECISIONS.md`'s `PUB` row still prescribes the **aggregated** topology ("myClinic repo
publishes `/admin/` from Central's build output; `CNAME yoursaas.com` lives in myClinic"),
which the owner's later `p7_topology = separate_repos` decision reversed. The push script's
step 3 already says "per repo, two domains".

**Steps** · `/tmp` backup, then an asserted `count==1` python patch prefixing the row's
Decision cell with **SUPERSEDED by `p7_topology = separate_repos` (see the P7 row)** and
correcting the consequence text (each repo keeps its own Pages deploy, `CNAME` and domain;
the G2 service-worker scoping work survives unchanged because each SW is scoped to its own
base). **Proof of done** · no row in the register contradicts another. **Cost** · none.
**Closed 2026-11-13** · the `PUB` row now reads **SUPERSEDED — do not implement**, names
`p7_topology = separate_repos` as the reversing decision, and separates what survived (the
service-worker scoping work, G2 → S9 `a6cda0b`, correct under either topology) from what was
abandoned (Central's `pages.yml` as an artifact job — it publishes its own site with its own
`Write CNAME` + assert step, P7b `a3077cf`).

### T4 · Per-tenant backup / restore runbook — **DONE** · *P8 deliverable* · docs-only

`OPD-DECISIONS.md` free-tier item 3 names this a P8 deliverable and says the data-loss risk
is "recorded, not hidden". Supabase Free has **no automatic backups and no PITR**.

**Steps** · new `OPD-BACKUP-RUNBOOK.md`: per-clinic `pg_dump` from the project's
`DATABASE_URL` (dashboard → Settings → Database), a nightly schedule (GitHub Actions in the
*clinic's own* repo, or owner cron), retention, and — the part that makes it real — a
**restore drill**: restore into a scratch project, apply `supabase/tenant/tenant-schema.sql`,
run `tenant-schema-tests.sql`, expect **41 PASS**. Record the constraints: a paused project
cannot be dumped until restored; dumps must never be committed to git; 500 MB cap per project.
**Proof of done** · the drill has been executed once and its output recorded. **Cost** · docs.
**Closed 2026-11-13** · new `OPD-BACKUP-RUNBOOK.md`: a 6-asset inventory, `pg_dump` recipes
(session mode 5432, `postgres` role because it bypasses RLS — an anon-key dump would be
empty), schedule + retention, a quarterly **restore drill** ending in `tenant-schema-tests.sql`
**41 PASS**, the §10 count/checksum queries, a "what this does not protect you from" table,
signing-key escrow, a drill log and a first-run checklist. **Two findings it turned up:**
(a) *no Storage buckets exist* — zero `storage.from(` call sites and logos are data URLs on
the clinic row, so a database dump is a whole-clinic backup; (b) **the RS256 signing key is
backed up by nothing** ⇒ new task **L10**.

### T5 · Central §14 operator UI (deactivate / rotate key / revoke member) — **DONE** · *P2 + P8*

**Closed 2026-11-13 by Central `1dd0086`** (16 files, +1874/−13): `src/pages/WorkspacesPage.jsx`
(route `#/directory`, nav *Control Plane*), `src/lib/workspace-console.mjs` (the pure half),
`tests/workspace-console.test.mjs` (13 tests), schema **v8** (`public.workspace_audit_log`) with 6
new §13 live-SQL checks, the 5th `DIRECTORY_AUTHORITY_ALLOWLIST` entry, `workspace_audit_log`
added to `PRIVILEGED_TABLES`, and APP 3.1.0 → **3.2.0** / SCHEMA 7 → **8**.
**Proof** · `npm run verify` EXIT 0 ⇒ **181/181**, contributing **27/27**, `check:admin-static`
clean, `check:write-verify` **16/16** (9 → 16 chains), `test:security` EXIT 0; live PostgreSQL 17
`schema-tests.sql` **67 → 73 PASS**, 0 FAIL, `app_meta.schema_version = 8`, 8 registry rows.
Five mutations proved the new gates bite and were reverted byte-exact: dropped audit read-back,
removed row count, de-allowlisted page, drifted vocabulary entry, FK flipped to CASCADE. That last
one exposed a **weak test** — `on delete set null` also appears on `subscriptions.workspace_id`, so
the unscoped assertion stayed green while the property was gone; the FK / no-cascade / payload
assertions are now scoped to the audit table's own DDL, and both a CASCADE flip and a weakened
payload CHECK now fail (the second also trips the JS↔SQL vocabulary cross-pin).

**One claim below was wrong and is corrected here (rule 5).** The ACTIONS needed no schema change —
`workspaces_admin_write` and `workspace_members_admin_write` are already `for all to authenticated
using (is_license_admin())`, and `my_workspaces()` / `public_workspace_by_slug()` / both keep-warm
surfaces already filter `is_active` — but the AUDIT view did. §14's runbooks all end with "audit
log", and Central had no surface that could hold an OPERATOR action: `clinic_activity_log` is
subscription-scoped (NOT NULL `subscription_id`, a closed 12-value `event_kind` CHECK) and a
directory row can exist with no subscription, while `sync_attempts` / `activated_machines` record
client behaviour, not operator intent. **Owner decision `t5_audit = new_table`** ⇒ v8: append-only
for every role (select+insert granted, update/delete revoked — not even an admin can tidy history),
`ON DELETE SET NULL` + a denormalised `workspace_slug` so a revocation's attribution outlives the
row it deleted, and a payload CHECK that refuses a key or JWT literal so the trail can never hold a
credential. **Rejected, not to be re-proposed:** logging operator actions as `notes_changed`
(dishonest labelling, and impossible with no subscription); a client-side journal (useless for
attribution, and P8e just removed fail-open local state); a read-only view over existing surfaces
(no attribution at all). **Shape** (owner delegated `t5_shape = you_choose`): ONE page, so the
allowlist grows 4 → 5 instead of 4 → 7 — all four runbooks operate on one selected clinic, which
is what master-detail is for, and the pure half names no privileged term so it needs no entry.

**Residual — the console has never been clicked.** Its decisions are unit-tested (13 tests), its
writes are ratcheted (7 of the 16 chains) and its database half is proved live (6 §13 checks), but
no browser has rendered it: **T6** put Playwright in *myClinic* and gave it eight CI suites,
but none of them exercise Central's admin console, and Central has no live project to point
at until **L1**+**L3**. So the first real click-through is a live task
— recorded as **L12**. Until then, treat the layout as unproven and the *behaviour* as proved only
at the level of the pure module, the gates and the SQL.

**Steps** *(the plan as written — where it differs from what shipped, the Closed block above wins:
`workspace-ops.mjs` shipped as `workspace-console.mjs`, the chain count went 9 → 16 not ~12, and
live SQL went 67 → 73 not 70)*
1. `src/lib/workspace-ops.mjs` — every write routed through `write-verify.mjs` so a silent
   0-row refusal throws `SilentWriteRefusal` (which `explainError` renders as a 42501 +
   `fix:'role'` hint). **Do not** add optimistic flips or success toasts before the row count.
2. `src/pages/WorkspacesPage.jsx` — list `workspaces` (name, slug, `is_active`,
   `tenant_schema_version`, `keep_warm_at`, member count) with the three actions; key rotation
   pastes a new publishable key (the CHECK at `schema.sql:1783` rejects `service_role|sb_secret`).
3. Route + nav entry. Gate on `is_license_admin()` for UX only — RLS is the real gate.
4. **Deliberate gate widening:** a new page naming `workspaces` / `workspace_members` /
   `supabase_anon_key` trips `DIRECTORY_TERM_RE`, so it must be added to
   `DIRECTORY_AUTHORITY_ALLOWLIST` (today exactly 4: `OnboardingWizard.jsx`, `keep-warm.mjs`,
   `tenant-connection.mjs`, `SetupPage.jsx`). Adding a 5th widens §12.1 item 1 — record the
   decision, and keep the module confined to directory terms (no clinical read through it).
5. Tests: pure-module tests for the ops decisions + a mutation test; the new write sites raise
   `check-write-verify`'s chain count (9 → ~12) and must all be verified.
6. SQL: splice §12j–§12l into `schema-tests.sql` (assert-once, ONE transaction, unique
   fixtures) proving the UI's exact writes: admin 1 row, non-admin 0 rows silently.

**Proof of done** · `npm run verify` green (~180 tests), `check-write-verify` N/N,
live SQL 67 → 70 PASS, `check-admin-static` green with the recorded 5th allowlist entry.
**Cost / risk** · Central commit ⇒ bundle re-cut + `EXPECT_CENTRAL` re-pin.

### T6 · Move the browser harnesses into the repos + CI — **DONE** · *P6/P7*

> **The plan text below is retained for the record.** Where it differs from what
> shipped, the **Closed** block at the end of this section wins (§0 rule 5). Two
> examples: `dist-gate/` is now gitignored, and `:5214` (the flag-off build) has its
> own server.

The 10 harnesses were the **only** proof of the browser-level guarantees (two-tab isolation,
booking tenant resolution, F2 key rotation, §8.4 operator actions). They lived in
`/home/user/harness`, unversioned — after a push they could not be re-run from a fresh clone.

**Steps**
1. Decide ownership: all 9 acceptance harnesses exercise myClinic (only `p8-provision` touches
   Central, via `--central-database-url`) ⇒ put them in `myclinic/harness/`.
2. Add `playwright` as a devDependency + `npx playwright install --with-deps chromium` in CI.
3. Add `test:e2e`: build `dist-gate` with the directory env, serve it, run the harnesses,
   `rm -rf dist-gate` (it is **not** gitignored). Keep it a **separate CI job**, not part of
   `verify`, to protect the local loop.
4. Preserve the port allocation — `:5211` p4b-smoke · `:5212` p4-acceptance/p4-debug/p5b/p5c ·
   `:5213` p5d-booking/p5e-schema-guard/p5e-setup · `:5215` p8-s14-rehearsal — and never run
   two at once on a shared port.
5. **Landmine:** `check-no-tenant-secrets` scans `src/`, `.env.example`, `scripts/` and
   `dist/assets/` and forbids `https://*.supabase.co` literals; it excludes `tests/`. A
   top-level `harness/` directory is therefore **not scanned**, which is why the mock hosts
   (`harbour-mock.supabase.co`, `central-mock.supabase.co`) are safe there — but moving them
   under `scripts/` or `tests/`-adjacent paths, or adding them to the scan list, would
   false-fail. Keep them in `harness/`, or rename the mock hosts to `.invalid`.
6. `check-contributing` scans `git ls-files` ⇒ `git add` the new files **before** the gate run.

**Proof of done** · a fresh clone runs `npm run test:e2e` green with no `/tmp/pw` dependency.
**Cost / risk** · myClinic commit ⇒ bundle re-cut + `EXPECT_MYCLINIC` re-pin.

**Closed 2026-11-13 — myClinic `99c5ef7` (20 files, +2378/−1; no `src/`, schema, contract or
version change).** Ownership followed step 1: all ten harnesses are in `myclinic/harness/`,
byte-identical to the workspace copies and to `opd/harness/`. They use a bare
`require('playwright')` and a repo-root resolver that works both inside the repo and beside
it; `p8-provision.cjs`'s absolute `/home/user` paths became overridable and layout-aware.
Playwright **1.65.0** is pinned in `devDependencies` (no postinstall browser download),
added to `ALLOWED_DEV_DEPENDENCIES`, and listed in `THIRD_PARTY_NOTICES.md`.

`npm run test:e2e` → `scripts/run-e2e.mjs`: builds `dist-gate/` (directory mode, mock
Central env assembled from parts because `check-no-tenant-secrets` walks `scripts/`) and
`dist/` (flag off), serves `:5211`–`:5214`, runs the **eight asserting suites sequentially**
and removes both outputs in `finally`. `:5215` stays with `p8-s14-rehearsal.cjs`, which
serves itself. `p4-debug.cjs` (no assertions, no exit code) and `p8-provision.cjs` (live
PG17 + a sibling Central repo) are **excluded**, so a green CI run cannot claim them.
`dist-gate/` is now gitignored. A separate `.github/workflows/e2e.yml` job installs
Chromium with `--with-deps` and runs the suites on PRs **and on `main`** (which `ci.yml`
skips) — never inside `verify`, which stays the fast local loop. `CONTRIBUTING.md` §5
documents the port map and why mock hosts must stay out of `scripts/`.

**Two real defects surfaced on the first clean-repo run — the whole value of versioning
them.** (a) The runner used `spawnSync` for the harness child, freezing its own HTTP
servers: seven suites timed out on `page.goto` and only the self-serving §8.4 harness
passed (1/8). Children are now spawned asynchronously (§0 rule 10). (b)
`p4-acceptance.cjs` mocked every clinical table as `[]`, so `store.jsx:273` routed the
session to `/onboarding` — no app chrome, no sign-out button. Its tenant fixtures now
carry the `profiles`/`clinics`/`staff` shape already proven by `p5b-clinical.cjs`. One
further stale expectation: the signing-out tab now lands on the public landing screen
(`AppLayout.jsx:116` → `navigate('/')`) while the broadcast forces other tabs to
`/login`; that check now pins `'#/'` **and** asserts the app chrome is gone — stronger
than the old hash-only assertion, not a loosening of it. **The header table's "10
harnesses, all green" claim was therefore wrong for p4-acceptance**; corrected in place
per §0 rule 5. The design choices are recorded in `OPD-DECISIONS.md` (T6 row).

**Proof.** `tests/e2e-wiring.test.mjs` (8 tests) ratchets the pinned/locked dependency, the
separate CI job on `main`, zero `/tmp/pw` + zero absolute workspace paths in any harness,
the async spawn, the frozen port/suite lists, artefact cleanup and the P4 fixture. Three
mutations bite and revert byte-exact: reintroducing `/tmp/pw`, making the child synchronous,
dropping `playwright` from `devDependencies`. With the tree STAGED (§0 rule 8):
`npm run verify` EXIT 0 → **988/988** (was 980), contributing **29/29 · 0 fail · 0 warn**,
`no-tenant-secrets` 143 source + 20 bundle files, `test:security` EXIT 0,
`npm audit --audit-level=high` **0 vulnerabilities**. `npm run test:e2e` → **8/8 suites,
137 browser assertions**. **Fresh clone of `myclinic-groundwork.bundle`**: `npm ci`
152 packages / playwright 1.65.0 → `test:e2e` 8/8 → `verify` 988/988 → clean tree and
zero `/tmp/pw` resolution anywhere. Cost paid: `EXPECT_MYCLINIC` re-pinned
`2f24930…` → `99c5ef7…`, both myClinic bundles + both Central bundles re-cut, `opd/`
snapshot refreshed, `DRY_RUN=1 ./push-groundwork.sh` EXIT 0 on both rails.

**Residual.** These are mocked-tenant browser proofs against a local build. Nothing here
has been clicked against the live Central project or the two real domains — that is
**L2** (CI on the real remotes) and **L12** (the §14 console click-through).

### T8 · Record why there is no data-migration step — **DONE** · *P8* · docs-only

Plan §10 specifies a full P8 data migration (export per-clinic rows, remap or drop
`clinic_id`, preserve Master Auth UUIDs, seed `tenant_members`, re-point booking slugs,
replay/clear outboxes, validate counts and checksums). **As built, that is unnecessary for a
clinic that already owns its project**, and no document says so — the pilot runbook's §2 goes
straight from "preconditions" to "provision", which reads like a missing step.

Evidence: the tenant overlay is **additive over live data** — restrictive
`<table>_tenant_gate` policies layered on the existing permissive rules (`README.md`: *"No
existing table, column, function or policy is dropped"*), `clinic_id` retained but pinned via
`tenant_meta` / `tenant_clinic_id()`, and the free-tier topology decision gives every clinic
its **own** project. So `provision-tenant --apply --database-url <the clinic's own project>`
wraps existing rows in place; nothing is copied.

**Steps** · patch pilot runbook §2 with a short "Why there is no row-copy step" note carrying
that evidence, **plus** the residual case: a clinic whose rows live in a *shared* project has
**no export/checksum tooling** and must be escalated rather than improvised.
**Proof of done** · the runbook explains the absence. **Cost** · docs only.
**Closed 2026-11-13** · pilot runbook §2 (319 → 355 lines) now opens with **"Why there is no
row-copy step"**: four pieces of evidence (the additive-over-live-data README promise, the
restrictive `<table>_tenant_gate` layering, `clinic_id` retained and pinned via
`tenant_clinic_id()`, Master Auth UUIDs untouched), the free-tier topology decision it follows
from, and the residual case stated as a **stop-and-escalate**: a clinic whose rows live in a
*shared* project needs the §10 migration, which is not built, so the overlay must not be
applied to it.

### T7 · `provision-tenant` reserved-slug guard — **DECLINED** (do not implement)

Owner decision `demo_slug_fix = fix_booking_live`: fix the class (P8e, `2f24930`) rather than
add a guard. `sunrise-opd` (the demo clinic's slug) is still not rejected at provisioning, so
it stays a **by-hand check** documented in the pilot runbook §8.5. Reopen only if the owner
reverses the decision.

### T9 · Plan §10 data-migration tooling — **MOOT** for own-project clinics

Superseded by the evidence in T8. Would become live work only if a pilot clinic turns out to
share a project. **Correction recorded:** an earlier audit listed this as unbuilt work; it is
unbuilt *and* unneeded for the topology actually adopted.

---

### T10 · Prove the declared CI Node matrix — **DONE** · *runtime compatibility*

**Why it matters.** P7 wired `ci.yml` on `[22, 26]` and `pages.yml` on
`node-version-file: .nvmrc` (`26.13.0`); both repos declare `engines.node >=22`.
All prior evidence — 988/988, 181/181, e2e 8/8, the fresh-clone proofs — was taken
on the sandbox's Node `v20.20.2`, so none of it covered the versions the push will
actually run. A read-only audit with npm-supplied `22.22.0` / `26.13.1` binaries
found **two blocking CI defects in the delivered bundles**.

**Found.** (a) Node 26 exposes a native `sessionStorage` object on `globalThis`;
`workspace-storage.test.mjs` asserted `sessionStore(undefined) === null`, so myClinic
`npm test` went **987/988** on the exact runtime `pages.yml` uses. The resolver itself
is correct — `usable()` accepts the native Storage — the test's assumption was wrong.
(b) Central's `scripts/run-tests.mjs` guarded `--test-isolation=none` with
`major > 22 || (major === 22 && minor >= 8)`. Node 22.22.0 only has the
`--experimental-test-isolation` spelling, so the Node 22 `ci.yml` job died with
`bad option` (exit 9) before any test ran.

**Fix.** Test-only, no `src/`, schema, contract or version change. myClinic `3f18863`
(+17/−1, `tests/workspace-storage.test.mjs`) pins `globalThis.sessionStorage` in a
`try/finally`, asserts both the absent and native cases, and restores the descriptor.
Central `c3d3456` (+16/−7, `scripts/run-tests.mjs`) probes `process.execPath` with
the flag and falls back to the single-process importer when it is rejected.

**Proof of done.** myClinic on **22.22.0 / 26.13.1**: `npm ci` EXIT 0, `npm run verify`
**988/988**, `npm run test:e2e` **8/8**, `test:security` EXIT 0, `npm audit` 0
vulnerabilities. Central on **22.22.0 / 26.13.1**: `npm ci` EXIT 0, `npm run verify`
**181/181** (incl. `check:admin-static`, contributing, write-verify 16/16),
`test:security` EXIT 0. Both fixes also pass on sandbox Node 20.20.2. Two mutations
bite exactly: restoring the old assertion ⇒ 12/13 on Node 26; restoring the version
guard ⇒ exit 9 on Node 22. Both reverted byte-identical vs `/tmp/t6node/`.

**Cost / risk.** A commit in BOTH repos ⇒ `EXPECT_MYCLINIC` and `EXPECT_CENTRAL`
re-pinned, **all four bundles re-cut**, the Central `opd/` branch rebuilt from the
new `main` (§0 rule 9), 19 snapshot files re-synced, `DRY_RUN=1` re-proved. Paid in
full on 2026-11-16. **Closed 2026-11-16** by myClinic `3f18863` and Central `c3d3456`.

---

## 3. Pending tasks — live (owner only)

| ID | Task | Steps | Proof of done |
|---|---|---|---|
| **L1** | Push both repos | `cd /home/user && ./push-groundwork.sh` (ff-only, never `--force`; `ONLY=myclinic` or `ONLY=central` for one rail; `DRY_RUN=1` to re-verify). It refuses on a stale bundle, a mismatched `EXPECT_*`, or a non-fast-forward | myClinic `b1e174e → 99c5ef7` (**22 commits**), Central `da36c7b → 1dd0086` (14). No tag at either HEAD ⇒ only `main` moves |
| **L2** | Both Pages runs green, plus myClinic's T6 e2e job | Watch "Deploy to GitHub Pages" in each repo (§13.3 guards + CNAME write/assert) and "Browser acceptance harnesses (T6)" in myClinic — a separate job that also runs on `main` | Green runs close plan §12.3's "both CI pipelines green" and **L1**'s only unknown. If red: redeploy the previous `main` — no DB change is in play yet |
| **L3** | Central database → **v8** | Run `supabase/schema.sql` in the live SQL editor (idempotent, additive), then `supabase/schema-tests.sql` | **73 PASS** (56 + the 11 §12 operator-runbook checks + the 6 §13 audit-log checks). Any other number means the live DB is not where this bundle expects |
| **L4** | Domains, per repo | `OPD-DEPLOYMENT-RUNBOOK.md` §3: set `PAGES_CNAME` (or commit `public/CNAME`), add the DNS record, verify the domain in Pages settings, enforce HTTPS. **Two repos ⇒ two domains**, not `yoursaas.com/admin/` | §12.3 box 9; `dist/CNAME` present in both published artifacts |
| **L5** | Auth + CORS | Runbook §4: the Master's redirect allowlist must list **both** app domains *with their hash fragments*; Site URL set; every tenant project allows the clinic origin for REST/Auth/Realtime. PKCE stays on | A real sign-in on each domain; a tenant read from the clinic origin |
| **L6** | **D1′ scratch-tenant token proof — the pilot's only true gate** | 1) Scratch tenant project (free org cap = 2: Central + 1 scratch). 2) Enable third-party auth on it pointing at Central's JWKS `https://<central-ref>.supabase.co/auth/v1/.well-known/jwks.json` (dashboard, or `POST /v1/projects/{ref}/config/auth/third-party-auth` with a PAT). 3) Confirm Central mints **RS256 with a `kid`** and that the JWKS endpoint serves that key. 4) Mint a capability token: TTL 900, claims `aud`, `role:'authenticated'`, `workspace_id`, `tenant_slug`, `tenant_schema_version`, `sub` = a real Master auth UUID. 5) Apply `supabase/tenant/tenant-schema.sql`, `tenant_pin_slug`, `tenant_admit_member`. 6) Call a tenant read with `Authorization: Bearer <token>` | A probe returns `auth.uid()` = the Master UUID and `is_tenant_member()` = true; a token minted for a **different** slug is refused. **Fallbacks if third-party auth is unavailable on the tier:** (a) Ed25519 capability token in a custom header verified in tenant RLS via pgsodium (zero platform config), (b) shared HS256 secret (last resort). Then tick §12.3 box 1 and record D1 as signed off |
| **L7** | Confirm keep-warm is live | Run **T2**'s three queries on the live Central project | `cron.job` shows `opd-keep-warm` at `17 */6 * * *`, active; `cron.job_run_details` shows successes |
| **L8** | The pilot | `OPD-PILOT-MIGRATION-RUNBOOK.md`: §1 preconditions (incl. **L6**) → §2 provision ONE clinic (`npm run provision:tenant`, then admit staff by Master UUID) → §3 verify (`tenant_status()` pinned, v22, `my_workspaces()`, `public_workspace_by_slug()`) → §4 flip `VITE_WORKSPACE_DIRECTORY` for that deploy → §5 acceptance day (login → patient → appointment → consultation → invoice → day close) → §6 rollback rehearsal → §7 boxes closed. §8 = operator actions by hand; §8.5 = the offline rehearsal evidence | Pilot staff complete a full day; rollback to `v1.43.0` restores the old flow in **< 15 min** |
| **L9** | Terminal cutover — **only after L8 passes** (D5 = pilot-first) | Delete `supabase.js` + the singleton; strip `VITE_SUPABASE_*` from the 5 per-clinic env files; migrate `auth-context.jsx`, `Setup.jsx`, `public-booking.mjs` off the singleton; empty `LEGACY_SINGLETON_IMPORTERS` 2 → 0 and `LEGACY_PER_CLINIC_ENV_BASELINE` 5 → 0 (mutation-proved, ratchets only ever shrink); cut the **v2.0.0** line | §12.3 fully closed; the app can no longer roll back to single-project — this is the point of no return |
| **L12** | Click-through the §14 operator console (**T5**'s residual) | After **L1**+**L3**: sign in as an admin, open `#/directory`, and on ONE test clinic run deactivate → reactivate → rotate key → add / change-role / remove a member → revoke; then open the Audit trail tab | A success notice appears ONLY after the row count was proven; the audit tab lists every action with your email as actor; the revoked clinic's row survives, marked detached; and a session without `app_metadata.role='admin'` gets the empty-directory warning plus the grant SQL instead of a fake success |

### L10 · Escrow the RS256 signing key — **OPEN, do once today**

`OPD-BACKUP-RUNBOOK.md` §7. The key is in **no dump, no commit and no bundle**:
`scripts/deploy-signer.mjs` generates or reuses it in a gitignored `keys/` directory and sets
`LICENSE_PRIVATE_KEY` as an Edge Function secret, and `.gitignore` excludes `keys/`, `.env`,
`.env.*` and `*.pem`. `supabase secrets list` shows names, not values — so if the local `keys/`
directory is gone the key is **unrecoverable**, and with it every licence signature already
issued and every tenant's third-party-auth trust (D1′). Steps: `ls -l keys/`; if the PEM is
there, copy it plus the public half into an encrypted offline store; if it is not, treat the
key as unrecoverable and plan a rotation as a scheduled event (`npm run keygen` →
`npm run deploy:signer` → re-publish the JWKS → re-verify third-party-auth on **every** tenant,
holding new sign-ins — risk R13). Never in a repo, a build-step CI variable, a bundle or a dump.

### L11 · Back up `/home/user` itself — **DONE** (via the `opd/` snapshot; an off-machine copy is still yours to make)

The runbooks, the decision register, this tracker and **all ten browser harnesses** live only
in `/home/user` — not a git repo, not in either bundle. One deleted directory loses the entire
operational knowledge base and every browser-level proof.

**Closed 2026-11-13** by committing the whole knowledge base to the Central branch
`central_tenent_mangement` under `opd/` (8 documents + `push-groundwork.sh` + all ten harnesses
+ a README recording the layout the harnesses expect, the port map, the Playwright bootstrap
and what was deliberately excluded). Docs-only: no `src/`, `supabase/`, workflow, dependency or
schema change, so Central `main` stayed at `1dd0086` for that push and `EXPECT_CENTRAL` plus the push bundle were
exactly as verified. **Residual, still yours:** a branch on this same machine is not an
off-machine backup — push it somewhere or copy the directory off the box. **T6** (harnesses
wired into myClinic's CI, runnable from a fresh clone) is now **DONE** and is the stronger fix
for the harness half; the documents still need `opd/` refreshed after every edit (§0 rule 7).

**Do NOT do during the pilot:** any part of **L9**. Those two baselines *are* the rollback
guarantee — while they are non-zero, level 1 (drop the flag, redeploy `main`) always works.

---

## 4. Plan §12.3 go/no-go checklist

| # | Box | Status | Evidence / what closes it |
|---|---|---|---|
| 1 | D1 signed off; Master token verified on a scratch tenant with correct `auth.uid()` | **OPEN** | **L6**. Decided in writing (D1′ RS256 capability token); the tenant half is proved on local PG17 (41 PASS, incl. a token minted for workspace A refused by workspace B) — never against a real Supabase project |
| 2 | `tenant_members` allowlist on every tenant, used by every clinical policy | **CLOSED** | `tenant-schema.sql`: 46 policies, **0** to anon, 7 `is_tenant_member()` gates, 11 `tenant_slug` pins |
| 3 | No `service_role` / `sb_secret_` key in any client-readable row or `dist/` asset | **CLOSED** | CHECK at Central `schema.sql:1783`; `check-no-tenant-secrets` (source + bundle); the `pages.yml` guard; `inspectTenantCredential` refuses a privileged key before `createClient` |
| 4 | `is_active` + licence verdict gate the mount | **CLOSED** | `my_workspaces()` filters `is_active`; the licence verdict is coalesced into the gate (F1 deviation); rehearsal proved deactivation ejects a live session |
| 5 | Cached slug revalidated every boot; cached credentials never trusted | **CLOSED** | `directory-reads.mjs` caches **only the slug** (F2); rehearsal proved rotation + deactivation mid-session, key header captured |
| 6 | `sessionStorage` active pointer; two-tab test green | **CLOSED** | `opd.active.workspace` per tab; `harness/p4-acceptance.cjs` 15/15 |
| 7 | Logout wipes RAM, both storage scopes, outbox and demo snapshot | **CLOSED** | §9.4's six steps in order, tested; `purgeAppStorage` + `purgeAllClinicalCache()`; the frozen 4-key keep-list |
| 8 | All three brief checklist items pass **and** fail on injected mutations | **CLOSED** | `check-admin-static` (Central), `check-no-tenant-secrets` + `check-tenant-accessor` (myClinic), mutation tests in both repos. Caveat: the **fourth** ratchet, `check-write-verify`, is unwired → **T1** |
| 9 | `CNAME` present in published `dist/`; both apps load on the custom domain | **OPEN** | **L4**. Note the plan's single-domain `yoursaas.com/admin/` shape was superseded — two repos, two domains |
| 10 | Rollback to `v1.43.0` rehearsed | **PARTIAL** | Tag `v1.43.0` = `b1e174e`, verified ancestor; level 1/2 documented; the flag-off rebuild proved locally. **Never executed against production** → **L8 §6** |

**7 of 10 closed. Box 10 is partial and boxes 1 and 9 are open — all three need live
infrastructure, and all three are downstream of L1 (the push).** An earlier audit note claimed
"8 of 10" by counting box 10 as closed; it is not — a rollback rehearsed only against a local
build has never been executed against production.

---

## 5. Deviations register (plan → as built, all deliberate)

| Plan said | As built | Authority |
|---|---|---|
| One Pages site: `/` = App 2, `/admin/` = App 1, one `CNAME yoursaas.com` (D2/C4/R11) | **Two repos, two Pages deploys, two CNAMEs, two domains** | owner `p7_topology = separate_repos` |
| D1 option A (JWKS) / B (shared HS256) / C (token broker) | **D1′** — Central-minted **RS256 scoped capability token**, 900 s TTL, `tenant_slug` pin, SPKI published as JWKS, tenants trust via third-party auth | owner delegated "best option" |
| Five admin Edge Functions with `service_role` (§6), audit via `audit_log` (C11) | **No Edge Functions.** Direct RLS-gated writes + `force row level security` + `is_license_admin()` + `clinic_activity_log` + the `write-verify` ratchet; provisioning is an operator CLI (`scripts/provision-tenant.mjs`) | P1/P8a; only the pre-existing licence functions ship (`sync-clinic-license`, `verify-license`) **T5 added `workspace_audit_log` (schema v8)** for OPERATOR actions; `clinic_activity_log` remains the subscription-event timeline. |
| `vault.workspaces`, `vault.workspace_members`, `vault.platform_admins` | `public.workspaces`, `public.workspace_members`, `auth.jwt()->'app_metadata'->>'role' = 'admin'` | D6-A + P1 |
| Split `store.jsx` into `DirectoryProvider` + `ClinicalStore` (§10) | **A seam**: `resolveClinicalClient` / `useClinicalClient` — `store.jsx` now has 0 references to master or the singleton | F1 deviation (Stage 2 = `my_workspaces()`, licence verdict coalesced) |
| Tenant template removes/constantises `clinic_id` (§8) | `clinic_id` **retained and pinned** via `tenant_meta` / `tenant_clinic_id()`, enforced by restrictive `<table>_tenant_gate` policies over the existing permissive ones | P3 — additive over live data |
| Flag `VITE_MULTI_TENANT` (P8) | **`VITE_WORKSPACE_DIRECTORY`** (0 hits for the plan's name) | P4/P8 |
| New `v2.0.0` release line at P8 | Still **1.43.0 / schema 21** — 1.43.0 *is* the rollback anchor | A5 + D5; the new line belongs at **L9** |
| Full P8 data migration with counts/checksums (§10) | Not needed for a clinic that owns its project | **T8 / T9** |
| Realtime wiring + acceptance test (C10/R14) | **Moot**: the app has **zero `.channel(` call sites**. Teardown is still defensive (`removeAllChannels?.()`, `realtime?.setAuth?.(null)`) | verified by grep |

---

## 6. Evidence index — how to re-verify any number in this file

```bash
cd /home/user/myclinic && git rev-parse --short HEAD && npm test 2>&1 | tail -8
cd /home/user/myclinic-subscription-engine && git rev-parse --short HEAD && npm test 2>&1 | tail -8
node myclinic-subscription-engine/scripts/check-write-verify.mjs          # 16/16, EXIT 0
git bundle list-heads /home/user/myclinic-groundwork.bundle | head -2
DRY_RUN=1 ./push-groundwork.sh                                            # EXIT 0, pushes nothing

# browser harnesses — T6: repo-native, no /tmp/pw, no hand-built dist-gate
cd /home/user/myclinic && npm run test:e2e   # 8/8 suites, 137 assertions; builds + serves + cleans
# for a single harness from the old workspace layout (see opd/README.md):
# NODE_PATH=/home/user/myclinic/node_modules node harness/p8-s14-rehearsal.cjs

# live PostgreSQL 17 suites (270 checks): dropdb/createdb p8s_* → /tmp/pg-setup.sql
# → /tmp/authprime.sql → schema file(s) → tests file, all with -v ON_ERROR_STOP=1, then dropdb
```

**Before any `npm run verify`: `rm -rf dist && npx vite build` with default env** — a stale
`dist/` false-fails both dist scanners, and both need their `masterUrl` env passed.

---

## 7. Update log

| Date | What closed | Evidence | Invalidated |
|---|---|---|---|
| 2026-11-13 | **Tracker created** from a full re-read of the 664-line plan + both repos. Phase status, 8 offline tasks (T1–T9), 9 live tasks (L1–L9), §12.3 boxes, deviations register | myClinic `2f24930` 980/980; Central `969e2e7` 164/164 + 67 live SQL PASS; harnesses 24/24, 28/0, 28/0 | — |
| 2026-11-13 | **P8e** closed the booking fail-open: a live build refuses an unresolved slug instead of serving the demo workspace | myClinic `2f24930` (6 files, +154/−24); 980/980 (was 975); `p5d-booking` 24/24 mutation-proved; rehearsal still 28/0; fresh-clone sweep green | `EXPECT_MYCLINIC` + the myClinic bundle (both re-cut and re-proved) |
| 2026-11-13 | **T2, T3, T4, T8 closed** — all docs-only, no repo commit, so both bundles and both `EXPECT_*` pins are untouched and the push path is unchanged. New `OPD-BACKUP-RUNBOOK.md`; deployment runbook 159 → 230 (§8 keep-warm verification); pilot runbook 319 → 355 (§1 two new preconditions, §2 "why there is no row-copy step"); `OPD-DECISIONS.md` `PUB` row marked superseded | Files re-read after patching; line counts in the header row; no `git` state changed (myClinic `2f24930` dirty 0, Central `969e2e7` dirty 2 = the known scratch files) | Nothing — deliberately: these tasks were chosen because they cannot invalidate a pin |
| 2026-11-13 | **Branch `central_tenent_mangement` created in Central**, carrying the unversioned knowledge base under `opd/` ⇒ **L11 closed**. A matching branch was created in myClinic at its tip (no extra commits — P8e is already on `main`) so one branch name exists in both repos | `npm run verify` EXIT 0 with the tree staged: **164/164**, `check:admin-static` green, contributing **27/27 · 0 fail · 0 warn**; `test:security` EXIT 0; `check-write-verify` 9/9. Scratch files never staged (0 of the 2 untracked). Both scanners scope to `^src/`, which is why mock `*.supabase.co` hosts in the harnesses are safe — recorded in `opd/README.md` so nobody moves them under `scripts/` | Nothing on either `main`; branch bundles cut as **separate files** so both push bundles stay byte-identical |
| 2026-11-13 | **T1 closed ⇒ P6 is DONE.** The write-verify ratchet is now an npm script, the last step of `verify`, and a step in both workflows — Central `9a150ba` (4 files) | `npm run verify` EXIT 0 at the committed tree: **167/167**, contributing 27/27 · 0 warn, `check:admin-static` green, ratchet **9/9**. Mutations: dropping a `.select('id')` read-back ⇒ EXIT 1 naming the site; unplugging the wiring ⇒ both new tests fail. Reverted byte-exact (diff vs `/tmp/t1bak`) | **`EXPECT_CENTRAL` re-pinned** `969e2e7…` → `9a150ba…`; Central push bundle re-cut (23 → 24 refs, 851,162 B); `DRY_RUN=1` re-proved EXIT 0, Central now `da36c7b → 9a150ba` (13 commits). myClinic untouched |
| 2026-11-13 | **Branch rebased onto the new `main` and its snapshot refreshed** (rule 7): `central_tenent_mangement` is now `9a150ba` + the `opd/` commit, with the tracker and `push-groundwork.sh` copies re-synced. Both Central bundles re-cut so no bundle carries the pre-rebase tip | all 20 snapshot files diff-verified byte-identical to their live copies; `npm run verify` EXIT 0 on the branch (**167/167**, 27/27, ratchet 9/9); `git bundle list-heads` shows 0 stale refs; fresh clone of the branch bundle ⇒ lands on `central_tenent_mangement`, `npm ci` 128 packages / **0 vulnerabilities**, `verify` EXIT 0 (**167/167**, ratchet 9/9, both workflows carry the step), `opd/` holds 7 docs + README + `push-groundwork.sh` + 10 harnesses, and the clone is clean afterwards. Caught and fixed en route: a bundle cut while on `main` clones onto `main` and the docs look absent — both Central bundles are now cut with their intended landing branch checked out (rule 7) | Branch tip sha moved (rebase + amend) — anybody who cloned the earlier bundle must re-download or `git fetch` + reset |
| 2026-11-13 | **Branch bundles cut and download-proved** | Fresh clone of `central-tenent-mangement.bundle`: HEAD lands on the branch, `opd/` intact (10 files + 10 harnesses), `npm ci` **0 vulnerabilities**, `npm run verify` EXIT 0 (**164/164**, contributing **27/27 · 0 warn**). Fresh clone of `myclinic-tenent-mangement.bundle`: `central_tenent_mangement` checks out at `2f24930` with P8e present. Both push bundles' sha256 identical before and after ⇒ no pin, no bundle and no `main` was disturbed | — |
| 2026-11-13 | **Two new owner tasks opened from the backup work: L10 and L11.** L10 — the RS256 signing key is escrowed nowhere (`keys/` + `*.pem` gitignored; only other copy is an unreadable Edge Function secret). L11 — `/home/user` holds the runbooks, the register, this tracker and all ten harnesses in a single unversioned copy | `deploy-signer.mjs` header + `.gitignore:3-8`; `grep -rc 'storage.from(' src/` = 0 files; no Storage buckets in `schema.sql` | — |
| 2026-11-13 | **Two audit corrections recorded.** (a) keep-warm *is* scheduled in `schema.sql` §8.5 (`opd-keep-warm`, `17 */6 * * *`) — the gap is verification, not implementation ⇒ **T2** rescoped. (b) Plan §10's data migration is unnecessary for the adopted topology ⇒ **T9** marked `MOOT`, **T8** opened to document why | `cron.schedule(...)` read at schema.sql §8.5; tenant overlay is additive/restrictive over live data | an earlier claim that keep-warm was "never scheduled" |
| 2026-11-13 | **T5 closed ⇒ P2 is DONE, Central is on schema v8 / app 3.2.0.** The §14 operator console (`#/directory`) lists the directory and performs deactivate / reactivate / rotate-key / revoke / member edits — every write row-count-verified before anything is reported, every action attributed in the new append-only `workspace_audit_log` | Central **`1dd0086`** (16 files, +1874/−13); `npm run verify` EXIT 0 **181/181**, contributing 27/27, admin-static clean, write-verify **16/16**, test:security EXIT 0; live PG17 `schema-tests.sql` **73 PASS** / 0 FAIL, `app_meta.schema_version = 8`; 5 mutations proved the gates bite and were reverted byte-exact. Two process traps found and recorded as §0 rules 8–9: the gates must run with the tree STAGED (an untracked file is invisible to `check-contributing`, which is how a `sb_secret_…` literal reached a commit), and a branch parented on an AMENDED sha must be rebuilt with `checkout -B`, not rebased | `EXPECT_CENTRAL` re-pinned, Central push bundle re-cut, `DRY_RUN=1` re-proved, `opd/` snapshot refreshed and the branch bundle re-cut. **The owner now applies schema v8 and expects 73 PASS — not v7/67.** The old T5 claim "needs no schema change" is corrected in §2 |
| 2026-11-13 | **T6 closed — the last offline item is DONE.** Ten browser harnesses moved into `myclinic/harness/`, made layout-agnostic (no `/tmp/pw`, no absolute `/home/user` path), Playwright 1.65.0 pinned, `npm run test:e2e` + a separate `e2e.yml` job also on `main`. Two real defects surfaced on the first clean-repo run: `spawnSync` froze the runner's own HTTP servers, and a P4 tenant fixture returning `[]` for every clinical table parked the harness on `/onboarding`. Corrected in place per §0 rule 5; the header's "all green, not in CI" claim was wrong for `p4-acceptance.cjs` | myClinic **`99c5ef7`** (20 files, +2378/−1, no `src/` change): `verify` **988/988**, contributing **29/29 · 0 warn**, `test:security` EXIT 0, `npm audit` 0 vulnerabilities, `test:e2e` **8/8 / 137 assertions**; `tests/e2e-wiring.test.mjs` 8 tests, 3 mutations bite and revert byte-exact; fresh clone of `myclinic-groundwork.bundle` ⇒ `npm ci` + `test:e2e` 8/8 + `verify` 988/988 + clean tree | **`EXPECT_MYCLINIC` re-pinned** `2f24930…` → `99c5ef7…`; both myClinic + both Central bundles re-cut; `opd/` snapshot refreshed; `DRY_RUN=1` EXIT 0 on both rails (myClinic 22 commits) |
| 2026-11-16 | **T10 closed — the delivered bundles would have failed CI on the declared Node versions.** A read-only matrix audit (npm-supplied `22.22.0` / `26.13.1`) found myClinic `npm test` **987/988** on Node 26 (native `sessionStorage`) and Central's Node 22 job aborting at **exit 9** (`bad option: --test-isolation=none`). Both repos pin `.nvmrc` to `26.13.0` and `pages.yml` uses it, so the push would have been red despite correct application code. Fixed **test-only** in myClinic `3f18863` (+17/−1) and Central `c3d3456` (+16/−7): pin the assumed global in a `try/finally`; feature-detect the flag instead of version arithmetic | myClinic 22 **988/988 + e2e 8/8**, 26 **988/988 + e2e 8/8**; Central 22 **181/181**, 26 **181/181**; both also green on sandbox 20.20.2; `test:security` + `npm audit` EXIT 0. Two mutations fail exactly (12/13 on Node 26; exit 9 on Node 22) and were reverted byte-exact vs `/tmp/t6node/` | **Both** `EXPECT_*` pins, **all four bundles**, the Central `opd/` branch tip (rebuilt from `main`), the `opd/` 19-file snapshot, and `DRY_RUN=1` — all repaired in this turn. §0 rule 11 added |
| 2026-11-16 | **Bundles re-cut and download-proved at `3f18863` / `c3d3456`.** `DRY_RUN=1 ./push-groundwork.sh` EXIT 0 on both rails (myClinic `b1e174e → 3f18863`, **23 commits**; Central `da36c7b → c3d3456`, **15 commits**). Real remotes still at baseline — nothing pushed. Owner chose `hold_push`; these two commits are the one deliberate exception, made because the handed-over bundles would otherwise produce red Pages/CI runs | `git bundle list-heads` on all four; fresh-clone `npm run verify` + `npm run test:e2e` at both new tips; `git ls-remote` unchanged | None — `present_file` re-delivered `push-groundwork.sh` and the branch bundle |
