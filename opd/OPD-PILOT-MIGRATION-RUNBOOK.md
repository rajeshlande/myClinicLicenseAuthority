# OPD multi-tenant — pilot migration & rollback rehearsal (P8 prep)

Operator guide for the **D5 pilot-first** migration: move ONE real clinic onto the
multi-clinic directory, prove it, and be able to roll back in < 15 minutes. Produced
at P8 prep (owner decision `p8_prep_offline`). The provisioning tool it drives is
committed (`provision-tenant`, myClinic `5d91ae8`) and live-proven on PostgreSQL 17
(`harness/p8-provision.cjs`, 28/0). Deployment/domain steps are in
`OPD-DEPLOYMENT-RUNBOOK.md`; this file is the pilot itself.

**Nothing here performs the terminal cutover.** Deleting `supabase.js`, stripping the
`VITE_SUPABASE_*` contract and emptying the frozen baselines happen only *after* the
pilot passes (§6).

---

## 0. Why rollback is already cheap (the rehearsal's basis)

Directory mode is **additive and flag-gated**, and the flag is **never passed in CI**
(`grep -c VITE_WORKSPACE_DIRECTORY .github/workflows/pages.yml` → `0`), so a normal
deploy is single-project. Two verified facts make the rollback real, not hoped-for:

- **`src/` is byte-for-byte unchanged since `b819f49`** (`git diff --name-only b819f49 HEAD -- src/`
  → empty): the only changes since are CI YAML, `package.json`, and the new
  `scripts/`+`tests/`. So the P5e browser proof of flag-off identity
  (`harness/p5e-setup.cjs`, **19/19, zero page errors** — "Demo mode" badge, Environment
  tab default, pointer-free) still holds verbatim on current `main`.
- **`v1.43.0` (`b1e174e`) predates the directory entirely** (`workspace-gate.mjs` is
  absent at that tag; it is an ancestor of HEAD, 20 commits back). It is the clean
  single-project anchor.

---

## 1. Preconditions (check before touching the pilot clinic)

- [ ] Central directory project is on **contract v5 / schema v8** and reachable; its
      `workspaces` registry, `my_workspaces()` and `public_workspace_by_slug()` are live.
- [ ] The pilot clinic already runs single-project myClinic with **its own Supabase
      project and real data** (the pilot migrates an existing clinic; it does not create
      an empty one).
- [ ] The clinic app is deployable in **directory mode** (`OPD-DEPLOYMENT-RUNBOOK.md` §3):
      `VITE_CENTRAL_SUPABASE_URL`/`_ANON_KEY` set (publishable key only), domain + CNAME done.
- [ ] You have the pilot project's **`DATABASE_URL`** and Central's, and `psql` (or the
      Supabase SQL editor) for each.
- [ ] **D1 sign-off** (§12.3 box): a Central-minted Master capability token verifies on a
      *scratch* tenant with `auth.uid()` correct and the third-party JWKS trusted. Do this
      on a throwaway project first — it is the one assumption the whole token model rests on.
- [ ] **Keep-warm is actually scheduled on Central** — `cron.job` shows `opd-keep-warm` at
      `17 */6 * * *`, active, with succeeded runs in `cron.job_run_details`. The schedule in
      `schema.sql` §8.5 is guarded on pg_cron **and** pg_net, so a project missing either
      extension silently has no job and a pilot clinic can pause mid-pilot. Queries and the
      degraded fallback: `OPD-DEPLOYMENT-RUNBOOK.md` §8.
- [ ] **A backup of the pilot project exists and has been restored once** — the free tier has
      no automatic backups and no PITR. Recipe and the restore drill: `OPD-BACKUP-RUNBOOK.md`.

---

## 2. Migrate the pilot clinic

### Why there is no row-copy step

Plan §10 specifies a full data migration — export per-clinic rows, remap or drop `clinic_id`,
preserve Master Auth UUIDs, seed `tenant_members`, re-point booking slugs, replay outboxes,
validate counts and checksums. **For a clinic that already owns its Supabase project, none of
that applies, and no tooling for it exists.** The tenant overlay is *additive over live data*:

- `supabase/tenant/README.md`: "Everything here is **additive**. No existing table, column,
  function or policy is dropped."
- Tenant isolation is a **restrictive** `<table>_tenant_gate` policy layered on the existing
  permissive staff/role rules — 46 policies, none targeting `anon`. Existing rows become
  visible only to admitted members of the pinned slug; they are not moved or rewritten.
- `clinic_id` is **retained**, not removed, and pinned to one value through
  `tenant_meta` / `tenant_clinic_id()`. An unpinned project fails **closed**.
- Master Auth UUIDs are untouched, so `auth.uid()` stays stable and `tenant_admit_member`
  takes the UUIDs the clinic already has.

So `provision-tenant --apply --database-url <the clinic's OWN project>` wraps the existing
data in place. This follows from the free-tier topology decision (decisions register,
free-tier item 1): every clinic owns its own project and hands over its URL + publishable
key, so there is no shared database to carve up.

**The residual case, and it must be escalated rather than improvised:** if a pilot candidate's
rows live in a **shared** project alongside other clinics, the overlay is not sufficient —
that clinic needs the export/remap/checksum migration §10 describes, which is **not built**.
Stop and decide before provisioning; do not apply the overlay to a shared project.

### Provision

Run from the myClinic repo. The tool mirrors `supabase/tenant/README.md` §1–§3 and the
Central registration; `--apply` runs it, or drop `--apply` to emit SQL for the SQL editor.

```bash
# dry-run: validate the inputs against the contract, change nothing
node scripts/provision-tenant.mjs --check \
  --slug <pilot-slug> --clinic-name "<Pilot Clinic>" \
  --supabase-url https://<pilot-ref>.supabase.co --supabase-anon-key <publishable-key>

# provision for real: schema → overlay (v22) → register in Central → pin → admit owner
node scripts/provision-tenant.mjs --apply \
  --database-url "$PILOT_DATABASE_URL" \
  --central-database-url "$CENTRAL_DATABASE_URL" \
  --slug <pilot-slug> --clinic-name "<Pilot Clinic>" \
  --supabase-url https://<pilot-ref>.supabase.co --supabase-anon-key <publishable-key> \
  --member <owner-master-auth-uuid>:admin --active
```

Then admit the rest of the staff (each person's **Master auth UUID** + role; roles map
admin→owner, doctor→doctor, staff→frontdesk). Re-run `--apply` with more `--member`
flags, or call `tenant_admit_member('<uuid>','doctor')` directly — it is an upsert.

**Order matters and the tool enforces it:** register in Central first (it mints
`workspaces.id`), then `tenant_pin_slug` with that id, then admit. A project that is not
pinned **fails closed** — it refuses every capability token — so pin before anyone signs in.

---

## 3. Verify the provisioned tenant

```sql
-- on the pilot project: pinned, on v22, gate live
select public.tenant_status();
-- {"slug":"<pilot-slug>","pinned":true,"clinic_id":"…","schema_version":22, …}
select public.app_schema_version();        -- 22

-- on Central: the directory resolves it for its members, and for booking
select slug, is_active, tenant_schema_version from public.workspaces where slug = '<pilot-slug>';
```

- [ ] `tenant_status()` → `pinned: true`, `schema_version: 22`, the right `clinic_id`.
- [ ] Each admitted member's `my_workspaces()` (signed in to the Master) returns the pilot
      clinic — and only clinics they belong to.
- [ ] `public_workspace_by_slug('<pilot-slug>')` (anon) returns the connection fields for
      booking; an unknown/deactivated slug returns no rows (fail closed).
- [ ] If you may need §14's operator actions during the pilot (deactivate a clinic,
      rotate its key, revoke a member), read **§8** first — a privileged write can
      silently change nothing, and the SQL Editor is not automatically exempt.

---

## 4. Flip the pilot deploy to directory mode

For the pilot clinic's users, deploy the clinic app **with** the directory on (this is the
only place the flag is set — production for everyone else stays single-project):

- Set `VITE_WORKSPACE_DIRECTORY=true` (+ the `VITE_CENTRAL_*` variables) for the pilot
  deploy, per `OPD-DEPLOYMENT-RUNBOOK.md` §3–§4. Confirm the Master Auth redirect
  allowlist covers the clinic domain (§13.4) and each tenant project allows the origin.

---

## 5. Pilot acceptance (run against the live pilot deploy)

- [ ] Staff sign in through the **Master**; the chooser lists the pilot clinic by name/slug/role.
- [ ] Picking it mounts and lands in the app; clinical reads/writes work against the tenant.
- [ ] The active pointer is **per-tab `sessionStorage`**; a second tab on another clinic does
      not disturb the first (two-tab isolation — `harness/p4-acceptance.cjs`).
- [ ] Public booking at `/#/book/<pilot-slug>` resolves the tenant via Central and books.
- [ ] The **C9 schema guard**: a tenant left on an older schema shows the "needs an update"
      screen and fails closed (`harness/p5e-schema-guard.cjs`, 16/16).
- [ ] **Sign-out purge**: RAM, both storage scopes, the outbox and the demo snapshot are
      wiped; only the frozen keep-list survives; the other tab is dropped via the broadcast.
- [ ] Licence/entitlement verdict comes from Central (Auto-Sync), not a local key.

---

## 6. Rollback rehearsal (< 15 min) — and what stays gated

Rehearse BOTH levels before the pilot goes live, and time level 1.

**Level 1 — flag-off redeploy (the <15-min path).** Remove `VITE_WORKSPACE_DIRECTORY`
(and optionally the `VITE_CENTRAL_*` variables) for the clinic deploy and redeploy `main`.
Because `src/` is unchanged since the flag-off proof (§0), the app boots the single-project
flow byte-identically — "Demo mode", Environment tab default, no directory pointer. The
pilot's data is untouched in its own project; only the *boot path* reverts. Verify:

```bash
git diff --name-only b819f49 HEAD -- src/ | wc -l   # 0 → flag-off proof still holds
grep -c VITE_WORKSPACE_DIRECTORY .github/workflows/pages.yml   # 0 → CI never activates it
cd myclinic && npm run test:e2e   # T6: 8 suites / 137 assertions, builds + serves + cleans itself
```

**Level 2 — full rollback to the tagged release.** If the groundwork itself is suspect,
deploy the pre-directory release: `git checkout v1.43.0` (`b1e174e`) and redeploy. That tag
has no `workspace-gate.mjs`, no tenant client, no directory code at all — the exact app the
clinic ran before the pilot. Re-cut/redeploy via the §13.6 flow (`bundle → verify →
git merge --ff-only <tag> → push`, never `--force`).

**Gated until the pilot passes (do NOT do during the pilot):** the terminal cutover —
delete `supabase.js` + the singleton, strip `VITE_SUPABASE_*` from the 5 per-clinic env
files, migrate `auth-context.jsx`/`Setup.jsx`/`public-booking.mjs` off the singleton, and
empty the frozen baselines (`LEGACY_SINGLETON_IMPORTERS` 2 → 0,
`LEGACY_PER_CLINIC_ENV_BASELINE` 5 → 0). Those baselines are the rollback's guarantee: while
they are non-zero, level 1 always works. Emptying them is the point of no return, and the
spec puts it at P8 *after* "1 pilot clinic migrated … rollback rehearsal … rollback to
v1.43.0 restores the old flow in < 15 min" (D5 = pilot-first).

---

## 7. §12.3 boxes this pilot closes

| Box | Closed by |
|---|---|
| D1 signed off; Master token verified on a scratch tenant, `auth.uid()` correct | §1 precondition |
| `CNAME` in published `dist/`; both apps load on their domains | `OPD-DEPLOYMENT-RUNBOOK.md` §3 |
| Rollback to `v1.43.0` rehearsed | §6 (both levels, timed) |

The remaining §12.3 boxes are already ✅ (see `OPD-DEPLOYMENT-RUNBOOK.md` §6).

---

## 8. §14 operator actions by hand — deactivate · rotate key · revoke member

§14's three operator actions need **no schema change**: `workspaces_admin_write` and
`workspace_members_admin_write` already permit all of them to a Central admin, and
`my_workspaces()`, `public_workspace_by_slug()` and both keep-warm surfaces already
filter on `is_active`, so a deactivation bites everywhere at once. There is no admin UI
for them yet — this is the SQL path. It is also the path with the sharpest trap in the
whole system.

### 8.1 The trap: a refused write is SILENT

Every privileged Central table is guarded by `using (is_license_admin())`. A USING
clause is a **row filter, not a permission check**: when the session is not an admin,
PostgreSQL executes the UPDATE or DELETE against an empty row set. It succeeds, raises
nothing, and reports `UPDATE 0`. Proven on PostgreSQL 17 in
`myclinic-subscription-engine/supabase/schema-tests.sql` §12f–§12i: the admin's
`update … returning` yields 1 row, the non-admin's yields 0 rows with no exception, and
a re-read shows the row untouched. (INSERT is the opposite — a WITH CHECK policy refuses
loudly with `42501` — so this is specifically about UPDATE and DELETE.)

**So `UPDATE 0` / `DELETE 0` is the failure signal, and it is easy to miss.** Read the
command tag after every operator write. This is the same bug the console had: seven call
sites treated "no error" as "done", including the Pause/Resume kill switch, which toasted
*"Subscription paused"* for a clinic that was still fully live. That is fixed in Central
`969e2e7` (`src/lib/write-verify.mjs` + the `check-write-verify` ratchet); the SQL path
has no such guard, so the check is yours.

### 8.2 The SQL Editor wrinkle — probe your session first

The Supabase SQL Editor runs as `postgres`, the **table owner**. Owners normally bypass
RLS, but Central sets `alter table … force row level security` on `workspaces` and
`workspace_members`, which removes exactly that owner bypass. Whether your editor session
is subject to the policies therefore depends on the role's attributes — so probe it,
side-effect free:

```sql
begin;
  select current_user, rolsuper, rolbypassrls,
         (select relforcerowsecurity
            from pg_class where oid = 'public.workspaces'::regclass) as forced;
  -- A no-op write that still reports how many rows your session can see:
  update public.workspaces set is_active = is_active where slug = '<pilot-slug>';
  -- UPDATE 1 => your session passes the policy. UPDATE 0 => it does NOT: use 8.3.
rollback;
```

### 8.3 The recipe that works either way

Set the claim the policy reads, then write, then **confirm the row count**:

```sql
begin;
select set_config('request.jwt.claims',
  '{"sub":"<your-admin-uuid>","role":"authenticated","app_metadata":{"role":"admin"}}', true);
set local role authenticated;

-- (a) DEACTIVATE a clinic: leaves my_workspaces() and darkens the booking link at once
update public.workspaces set is_active = false where slug = '<clinic-slug>';      -- must say UPDATE 1

-- (b) ROTATE its publishable key (the column stores the clinic's *publishable* key;
--     the CHECK constraint refuses an sb_secret/service_role value even for an admin)
update public.workspaces
   set supabase_anon_key = '<new sb_publishable_ key>'
 where slug = '<clinic-slug>';                                                   -- must say UPDATE 1

-- (c) REVOKE a member
delete from public.workspace_members
 where workspace_id = (select id from public.workspaces where slug = '<clinic-slug>')
   and user_id = '<member-uuid>';                                                -- must say DELETE 1

commit;   -- only after the counts are right; otherwise rollback and re-read 8.2
```

### 8.4 Confirm it took effect (never trust the command tag alone)

- [ ] `select slug, is_active, supabase_anon_key from public.workspaces where slug = '<clinic-slug>';`
      shows the new state.
- [ ] Deactivated: `select * from public.public_workspace_by_slug('<clinic-slug>');` returns
      **no rows** (the anonymous booking link is dark), and the member's `my_workspaces()`
      no longer lists the clinic.
- [ ] Rotated: the same RPC returns the **new** key, so booking clients pick it up at once.
- [ ] Revoked: `select count(*) from public.workspace_members where workspace_id = … and user_id = …;` → 0.
- [ ] Client-side timing: an already-mounted clinic tab keeps working until its next
      revalidation (boot, token refresh, or the tab becoming visible again) — the cached
      slug then fails and the gate re-resolves. **Where it lands depends on what is left**
      (corrected by the rehearsal below): 2+ clinics → the `/select` chooser, exactly 1 →
      the gate AUTO-SELECTS it and never shows a chooser, 0 → `/no-clinic`. Capability
      tokens live at most `TENANT_TOKEN_TTL_SECONDS` (900 s), so nothing outlives 15
      minutes. Rotating a key does **not** invalidate an already-issued token before then.

---

### 8.5 What the client-side rehearsal actually proved (executed, not assumed)

§8.4's items are database facts. `harness/p8-s14-rehearsal.cjs` (**28 PASS / 0 FAIL**,
zero page errors, stable across four runs) executes them against a real browser on the
flag-on build (`dist-gate`, served :5215 — a port no other harness uses) with a mocked
Central and three mocked tenant projects, mutating the operator state mid-session:

| Operator action | Proven in the running app |
|---|---|
| Deactivate | A tab-visibility regain (no reload) re-reads the directory, the clinic stops holding the session, **its project receives no further clinical reads** (the mount is disposed), and the public booking link goes dark firing **zero** tenant RPCs — while the other clinic's link still resolves, so deactivation is per clinic |
| Reactivate | Both surfaces come back; an already-open booking tab recovers on a plain hash navigation, so **no reload is needed** |
| Rotate key | Anonymous booking resolves the NEW project at once and the write lands there, never the old one — and the captured `apikey` header is the **new publishable key**, so it is not just a new host. A signed-in remount reads clinical data from the new project while the old one serves nothing: `directory-reads.mjs` never lets a stored URL or key reach `createClient` (F2), only the slug is cached |
| Revoke | The member is ejected and their cached slug fails revalidation, **but the public booking link still books** — revoke ≠ deactivate; the clinic is live for everyone else |
| Revoke all | An empty directory routes to `/no-clinic`, the screen is honest, and a cached slug cannot resurrect the session |

Two things the rehearsal caught that the checklist had wrong or missing:

1. **`/select` is not the fallback for one remaining clinic.** With exactly one mountable
   row the gate auto-selects it (§8.4 corrected above). Expect a revoked/deactivated
   member to land *inside* their other clinic, not on a chooser.
2. **Never provision a real clinic with the slug `sunrise-opd`** — and if one already
   exists it is now safe, merely confusing. That slug belongs to the demo clinic
   (`BOOKING_SLUG_FALLBACK`, `demo-data.js`) and `demoProfile(slug)` answers only for it,
   so while the rehearsal used it as a fixture nobody could tell a real clinic from the
   sample one. The fail-open that hid behind is **fixed (P8e)**: a live/directory build
   whose slug resolves to no client now refuses instead of falling through — the pure
   `unresolvedSlugFallback({mode, slug})` answers `REFUSE`, `bookingApi` throws
   `BOOKING_WORKSPACE_UNRESOLVED`, and the page renders "Booking is not available" having
   made zero tenant calls. Only a *demo* build serves the sample clinic, and a link with
   no slug at all (`/booking/:ref`) keeps its honest local "No appointment found". Proved
   twice: `harness/p5d-booking.cjs` scenario 7 (**24/24** — deactivate the colliding slug
   and the stranger gets the refusal, never "Sunrise Multispecialty OPD"; mutation-proved
   by restoring the old behaviour and watching exactly those three render checks fail
   while the RPC counters stayed silent, which is how the bug hid) and this harness's
   fixture guard. `provision-tenant` still does not reject the slug — the owner chose to
   fix the class rather than add a guard (decision `demo_slug_fix = fix_booking_live`), so
   check by hand at provisioning.

Reproduce both proofs **from a fresh clone**, with no hand-built `dist-gate` and no
`/tmp/pw` (T6). The runner builds both variants, serves `:5211`–`:5214`, runs the eight
asserting suites sequentially, and removes both build outputs even on failure:

```bash
cd myclinic && npm ci && npx playwright install chromium
npm run test:e2e                         # p5d-booking 24/24 · p8-s14-rehearsal 28/0 · 8/8 total
```

For the mutation proof below you still need a manual `dist-gate` build (recipe in §4)
and one harness on its own, because that check deliberately puts the old behaviour
back into `src/`. `dist-gate/` is gitignored as of T6, but delete it afterwards anyway;
`:5213` is shared with p5e-setup / p5e-schema-guard, so never run two at once.

To re-prove the P8e checks actually bite, put the old behaviour back in
`src/lib/public-booking.mjs` (`if (true) return BOOKING_FALLBACK.DEMO;` as the first line
of `unresolvedSlugFallback`), rebuild `dist-gate`, and re-run `p5d-booking.cjs`: exactly
the three render checks fail, the body text names the sample clinic, and the per-host RPC
counters do not move — which is the whole reason this needed a rendering assertion. Revert
byte-exact and it is 24/24 again.
