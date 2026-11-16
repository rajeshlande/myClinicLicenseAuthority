# OPD multi-tenant — backup & restore runbook

**Why this exists.** Supabase **Free** has *no automatic backups and no point-in-time
recovery*, 500 MB per project, and pauses a project after 7 days of inactivity. The owner
decisions register (free-tier item 3) records this as a P8 deliverable and says the data-loss
risk is "recorded, not hidden". This is the recording, and the drill that proves it.

Every clinic's database holds patient records. A dump is therefore **clinical data**: encrypt
it at rest, keep it off the machine that made it, never commit it, never paste it into an
issue, and delete it when retention expires.

---

## 1. What has to be backed up — inventory

| # | Asset | Where it lives | In a `pg_dump`? | Notes |
|---|---|---|---|---|
| 1 | **Each clinic's tenant project** — `patients`, `appointments`, `consultations`, `prescriptions`, `invoices`, `day_closes`, `reminders`, `clinics`, `staff`, `profiles`, `branches`, `staff_branches`, `tenant_meta`, `tenant_members`, `schema_migrations`, `app_meta` | the clinic's own Supabase project, `public` schema | **Yes — completely** | **There are no Storage buckets to export.** Verified: zero `storage.from(` call sites in `myclinic/src/`, and logos are deliberately stored as **data URLs on the clinic row** (`schema.sql`: "no storage bucket, no CORS, no second fetch"). So a database dump *is* a whole-clinic backup |
| 2 | **Central directory + billing** — `workspaces`, `workspace_members`, `licenses`, `subscriptions`, `invoices`, `activated_machines`, `clinic_activity_log`, `app_meta`, `schema_migrations` | the Central project, `public` schema | **Yes** | Small, but it is the authority for who may enter which clinic. Losing it loses the directory even if every tenant survives |
| 3 | **Central `auth.users`** — the only identity store (D6-A: invite-only staff in Central Auth; tenants have no local `auth.users`) | Central project, `auth` schema | **Yes, but recovery is different** | Dump it as a *record* (UUID ↔ email ↔ `app_metadata.role`), because tenant `tenant_members` rows reference those UUIDs. But do not plan to restore `auth.users` into a fresh project: with D6-A the supported recovery is **re-invite** (`auth.admin.inviteUserByEmail`) and re-stamp `app_metadata.role`. Keep the dump so the UUID→email mapping survives |
| 4 | **The RS256 signing key** (`license_private_pkcs8.pem` / `LICENSE_PRIVATE_KEY`) | **Neither the database nor git.** `scripts/deploy-signer.mjs` generates or reuses a keypair in a gitignored `keys/` directory and sets `LICENSE_PRIVATE_KEY` as an Edge Function secret on the Authority project; `.gitignore` excludes `keys/`, `.env`, `.env.*` and `*.pem` | **NO** | ⚠️ **The one asset a dump will not save you on.** A fresh clone does not contain it, and `supabase secrets list` shows names, not values. If the local `keys/` directory is lost, the only surviving copy is the deployed Edge Function secret. Losing the key invalidates every licence signature already issued and every tenant's third-party-auth trust (D1′). Escrow it — §7 |
| 5 | **Both repos' history** | `/home/user/myclinic-groundwork.bundle`, `/home/user/myclinic-license-authority-groundwork.bundle`, plus the GitHub remotes once pushed | n/a | Already redundant after the first push; keep the bundles until then |
| 6 | **The workspace docs** — `OPD-*.md`, `opd-multitenant-*.md`, `harness/*.cjs`, `push-groundwork.sh` | `/home/user` only | n/a | **Not a git repo and not in any bundle.** The runbooks, the decision register and all ten browser harnesses exist nowhere else — back this directory up too |

---

## 2. How — the dump recipes

Get the connection string from **Dashboard → Project Settings → Database → Connection
string**. Use **session mode (port 5432)**, not the transaction pooler on 6543: `pg_dump`
needs a session. The `postgres` role in that string bypasses RLS, which is exactly what a
backup needs — a dump taken with the anon key would silently contain almost nothing.

```bash
STAMP=$(date -u +%Y%m%dT%H%M%SZ)

# --- one clinic tenant (repeat per clinic, per slug) ---
pg_dump "$TENANT_DATABASE_URL" \
  --format=custom --compress=9 --no-owner \
  --schema=public \
  --file "tenant-<slug>-$STAMP.dump"

# a human-readable companion copy for spot checks and diffing (optional, larger)
pg_dump "$TENANT_DATABASE_URL" --no-owner --schema=public --inserts \
  | gzip > "tenant-<slug>-$STAMP.sql.gz"

# --- Central: directory + billing, and the auth record ---
pg_dump "$CENTRAL_DATABASE_URL" \
  --format=custom --compress=9 --no-owner \
  --schema=public --schema=auth \
  --file "central-$STAMP.dump"
```

`pg_dump` runs inside a single consistent snapshot, so cross-table consistency **is**
guaranteed — no quiet window is needed, and an invoice cannot be captured without the
appointment it belongs to.

**Verify every dump before you trust it** (a truncated file restores as nothing):

```bash
pg_restore --list "tenant-<slug>-$STAMP.dump" | tail -5   # must list TOC entries, not error
ls -l *-$STAMP.dump                                        # non-zero, and plausible vs 500 MB cap
```

---

## 3. Schedule and retention

| Cadence | Keep | What |
|---|---|---|
| Nightly | 7 | every active tenant + Central |
| Weekly (Sunday) | 4 | same |
| Monthly (1st) | 3 | same |

Two ways to run it; pick one and write down which:

- **Owner cron / machine** — simplest, and the dumps never touch a third-party CI log.
- **GitHub Actions, nightly, in each clinic's own repo** — `DATABASE_URL` as a repository
  secret, artifact uploaded to a *private* bucket or encrypted artifact store. Note the
  caveat: a dump is PHI, so an Actions artifact retention window becomes a clinical-data
  retention policy. If that is uncomfortable, use the owner cron.

**Prerequisite:** a paused project cannot be dumped. Keep-warm must be verified live first
(`OPD-DEPLOYMENT-RUNBOOK.md` §8) — otherwise the nightly job silently starts failing on the
clinics nobody signed into, which are precisely the ones with no other copy.

---

## 4. The restore drill — do this once, then quarterly

A backup nobody has restored is a rumour. Run the whole thing against a **scratch** project
(remember the free-tier cap of 2 active projects per organisation: Central + 1 scratch).

```bash
# 1. create/empty the scratch project, then restore
pg_restore --no-owner --role=postgres --dbname "$SCRATCH_DATABASE_URL" \
  --clean --if-exists "tenant-<slug>-$STAMP.dump"

# 2. re-apply the tenant overlay (idempotent; it is additive and never drops)
psql "$SCRATCH_DATABASE_URL" -v ON_ERROR_STOP=1 -f myclinic/supabase/tenant/tenant-schema.sql

# 3. prove the restored tenant still enforces its own rules — expect 41 PASS
psql "$SCRATCH_DATABASE_URL" -v ON_ERROR_STOP=1 -f myclinic/supabase/tenant/tenant-schema-tests.sql

# 4. compare counts against the source project (§5)
# 5. boot the clinic app against the scratch project with the directory flag on and walk
#    one patient record end to end
```

**Record in §8 below:** the date, the dump stamp, the elapsed time, the PASS count, and any
table whose count disagreed. If step 3 is not 41 PASS, the restore is **not** good — do not
file the drill as passed.

---

## 5. Count and checksum verification

Plan §10 requires validating "counts and checksums per table" before a cutover. The same
queries serve a restore. Run on **both** source and restored project and diff:

```sql
-- row counts for every table in the schema, one row each
select relname as table_name, n_live_tup as approx_rows
  from pg_stat_user_tables order by relname;

-- exact counts + a content checksum for the tables that matter most
select 'patients'      as t, count(*) as rows, md5(string_agg(id::text, ',' order by id))      as ids from public.patients
union all
select 'appointments',       count(*),          md5(string_agg(id::text, ',' order by id))            from public.appointments
union all
select 'consultations',      count(*),          md5(string_agg(id::text, ',' order by id))            from public.consultations
union all
select 'invoices',           count(*),          md5(string_agg(id::text, ',' order by id))            from public.invoices
union all
select 'day_closes',         count(*),          md5(string_agg(id::text, ',' order by id))            from public.day_closes;

-- identity and pinning survived (a restored tenant that is not pinned fails CLOSED)
select public.tenant_status();     -- pinned: true, the right slug and clinic_id
select public.app_schema_version(); -- 22
```

`pg_stat_user_tables.n_live_tup` is an estimate — use the exact `count(*)` form for anything
you intend to sign off. The `md5(string_agg(... order by id))` form detects a restore that
returned the right *number* of rows with the wrong *identities*.

---

## 6. What this does not protect you from

| Gap | Consequence | Mitigation |
|---|---|---|
| **No PITR on Free** | With a nightly schedule you can lose up to ~24 h of clinical work | Take a dump immediately before any risky operation (a schema apply, a cutover, a bulk edit). Pro tier per clinic adds PITR — the decisions register already recommends it once revenue allows |
| **The signing key is not in any dump** (§1 item 4) | Lost key ⇒ every issued licence unverifiable and every tenant's D1′ trust broken | Escrow per §7, and treat rotation as a planned event with a maintenance window (risk R13: JWKS material can be cached a long time by a trusting project) |
| **Documents still have a single unversioned home** | The runbooks and the decision register live in `/home/user`; the `opd/` snapshot on Central's `central_tenent_mangement` branch is a **copy**, so an edit to the live document is lost until the snapshot is refreshed | **T6 closed the harness half**: all ten harnesses now live in `myclinic/harness/` and run in CI from a fresh clone. For the documents, refresh `opd/` after every edit and re-cut the branch bundle (tracker §0 rules 7 and 9). A dump still does not cover either — back up `/home/user` separately |
| **A dump is only as good as its last restore** | Silent corruption or a wrong-role dump restores empty | The §4 drill, quarterly, with its result recorded |
| **Paused projects cannot be dumped** | The neglected clinics are the ones with no copy | Keep-warm verification (`OPD-DEPLOYMENT-RUNBOOK.md` §8) and alert on a failed nightly job |

---

## 7. Signing-key escrow (do this once, today)

```bash
cd myclinic-subscription-engine
ls -l keys/                                  # is the keypair even present on this machine?
```

- If `keys/license_private_pkcs8.pem` exists: copy it to your password manager or an
  encrypted offline store **now**, together with the public half. It is gitignored, so no
  commit, bundle or clone will ever carry it.
- If it does not exist, the only copy is the `LICENSE_PRIVATE_KEY` secret on the Authority
  project, which Supabase will not print back to you. In that case treat the key as
  **unrecoverable** and plan a rotation as a scheduled event: `npm run keygen`, then
  `npm run deploy:signer` (which sets the secret and redeploys `verify-license`), then
  re-publish the JWKS and re-verify third-party-auth trust on **every** tenant, holding new
  sign-ins during the window (R13).
- Never put the private key in a repo, a CI variable used by a build step, a browser bundle
  or a dump. `check:tenant-secrets` and `check:admin-static` both scan for key material
  reaching `dist/`; escrow is an offline act.

---

## 8. Drill log

| Date | Dump stamp | Project | Elapsed | `tenant-schema-tests` | Count/checksum diff | Verdict |
|---|---|---|---|---|---|---|
| — | — | — | — | — | — | **never run** |

Fill a row per drill. An empty table means no backup here has ever been proved to restore.

---

## 9. First-run checklist

- [ ] Connection strings collected for Central and every active tenant (session mode, 5432).
- [ ] One nightly mechanism chosen and documented (owner cron, or Actions in each clinic repo).
- [ ] First dump taken for Central **and** every tenant; each verified with `pg_restore --list`.
- [ ] §7 key escrow done, or the rotation plan written down.
- [ ] `/home/user` (docs + harnesses) backed up.
- [ ] Keep-warm verified live, so the nightly job cannot silently skip a paused clinic.
- [ ] One full §4 restore drill completed and logged in §8, with **41 PASS**.
