# OPD multi-tenant — deployment runbook (P7)

Operator guide for publishing the two apps under the **separate-repo topology**
(owner decision `p7_topology = separate_repos`). Produced at P7; the CI guards it
describes are committed (myClinic `cbe5012`, Central `969e2e7`). Everything under
"Operator steps" requires a push plus GitHub / Supabase / DNS access — none of it
runs from the build sandbox, so it is the deploy-time checklist, not a gated test.

---

## 1. Topology and how it deviates from the brief

Two **independent** repositories, two **independent** GitHub Pages sites, two
**independent** domains:

| App | Repo | Publishes | Example domain |
|---|---|---|---|
| App 2 — clinic app | `myclinic` | the clinical app every clinic uses (directory mode resolves the tenant) | `app.yoursaas.com` (or the apex `yoursaas.com`) |
| App 1 — admin / directory authority | `myclinic-license-authority` (Central) | the operator admin portal + Master directory | `admin.yoursaas.com` |

This **deviates** from the spec, which assumed one repo and one deploy:

- **§13.1** "aggregate into `dist/` with `dist/admin/`" — **not done**. There is no
  aggregate step; each repo builds and deploys its own `dist/`. No cross-repo build
  coupling, no shared artifact handoff.
- **§12.3** "both apps load on `https://yoursaas.com`" — **replaced** by "clinic app
  on its domain, admin on its domain".
- **§13.3** `assert CNAME === 'yoursaas.com'` — **replaced** by a *format* assertion
  (one valid bare hostname, not a placeholder) in each repo, because two independent
  domains share no single literal. `yoursaas.com` itself is accepted.

There is **no runtime cross-domain coupling**: the clinic app talks to Central's
*Supabase project* (`VITE_CENTRAL_SUPABASE_URL`) to resolve tenants — never to
Central's Pages domain — and the admin portal never links to the clinic Pages
domain. The only place both domains must be listed together is Supabase Auth (§4).

---

## 2. What CI now enforces automatically (committed at P7)

Both repos' `pages.yml` (publish path) **and** `ci.yml` (PR / branch feedback):

- **myClinic** — `check:tenant-accessor` (§12.1 item 3: Master-client imports stay in
  the frozen §9.5 allowlist, no component makes its own client) and `check:tenant-secrets`
  (§12.1 item 2 · §13.2 · §13.3: no per-clinic `VITE_*TENANT*` / `CLINIC_*_SUPABASE` env
  beyond the frozen baseline; no tenant project host or `service_role`/`sb_secret` key in
  `dist/`). The secrets gate is passed `VITE_CENTRAL_SUPABASE_URL` as its `masterUrl` so
  the Central host the directory build bakes in is whitelisted — **without it the gate
  false-fails** (proved locally).
- **Central** — `check:admin-static` (§12.1 item 1 · §13.3: exactly one Master
  `createClient`, zero tenant-switch markers, zero clinical/PHI reads, directory-authority
  surface allowlisted, no tenant host or secret key in `dist/`). Passed `VITE_SUPABASE_URL`
  as `masterUrl` for the same reason (proved locally).
- **Both** — `Write CNAME` + `Assert CNAME` (§13.1 · §13.3 · §13.5).
- **Central, added after P7 (`969e2e7`)** — the `write-verify` ratchet runs inside
  `npm test`, so `ci.yml` covers it: all 9 privileged write chains across the 7
  admin-gated tables must read their rows back with `.select('id')` **and** count them,
  because `using (is_license_admin())` refuses a non-admin SILENTLY — the statement
  succeeds, raises nothing and changes 0 rows (`supabase/schema-tests.sql` §12f–§12i).
  A kill switch that reports "paused" for a clinic that is still live is the failure this
  prevents. §14's three operator actions (deactivate a clinic, rotate its publishable key,
  revoke a member) are still **SQL-only** — no admin UI exists — and the same trap applies
  in the Supabase SQL Editor, which Central's `force row level security` does not exempt:
  see `OPD-PILOT-MIGRATION-RUNBOOK.md` §8 for the session probe, the claim recipe and the
  row-count checks.

§13.2's "reject any new `VITE_*` name matching `TENANT|CLINIC_.*SUPABASE`" is enforced by
those two gates (`check:tenant-secrets`'s `forbiddenEnvPattern`, `check:admin-static`'s
`VITE_*TENANT*` marker rule), now running in CI rather than only in local `verify`.

---

## 3. Operator steps — per repo, before the first custom-domain deploy

Do this **once per repo** (`myclinic`, then `myclinic-license-authority`):

1. **Choose the domain** for that repo (e.g. `app.yoursaas.com` / `admin.yoursaas.com`).
2. **Provide the CNAME** — either:
   - set the repo variable **`PAGES_CNAME`** (Settings → Secrets and variables → Actions →
     Variables) to the bare domain, **or**
   - commit **`public/CNAME`** containing the bare domain on one line (Vite copies it into
     `dist/`). §13.5 prefers the committed form so a CI deploy can never drop it.
   The workflow writes `dist/CNAME` from whichever is present and asserts it is one valid
   hostname, not a placeholder. With neither, the deploy falls back to `*.github.io`
   (warning, not failure) — fine for a staging preview.
3. **GitHub Pages → Custom domain**: enter the domain; GitHub writes the DNS check.
4. **DNS**: add a `CNAME` record pointing the domain at `<org>.github.io` (apex domains
   need `A` records to GitHub's IPs instead — GitHub Pages does not apex-CNAME).
5. **Verify the domain** in GitHub (Settings → Pages → "Verified domains") to reduce
   takeover risk (§13.5).
6. **Enforce HTTPS** once the certificate provisions (§13.5).
7. **Set the Supabase build inputs** (Settings → Secrets and variables → Actions):
   - myClinic: secrets `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (the *single-project
     fallback*); variables `VITE_CENTRAL_SUPABASE_URL`, `VITE_CENTRAL_SUPABASE_ANON_KEY`
     (the Master directory — **publishable** key only); `VITE_WORKSPACE_DIRECTORY=true` to
     turn directory mode on; optional `VITE_BASE`.
   - Central: secrets `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (the Master project);
     optional `VITE_BASE`.
   Never put a `service_role` / `sb_secret_` key in any of these — the workflow rejects it
   and the app refuses such a build.

---

## 4. Supabase Auth + CORS (the one place both domains meet) — §13.4

Users sign in against the **Master (Central) Supabase project** from *both* apps, and the
clinic app then talks to each **tenant** project for clinical data. So:

- **Master project → Authentication → URL Configuration**
  - **Site URL**: the admin domain (e.g. `https://admin.yoursaas.com`).
  - **Redirect URLs (allowlist)**: add **both** apps' origins, with the hash fragments the
    apps use, e.g.
    `https://admin.yoursaas.com/**`, `https://app.yoursaas.com/**`, and any explicit
    callback paths. PKCE flow is preserved — do not switch to the implicit flow.
- **Each tenant project → API / Auth settings**: allow the **clinic app origin**
  (`https://app.yoursaas.com`) for REST, Auth and Realtime, since the mounted clinic app
  calls the tenant directly after resolution.
- Keep `service_role` / `sb_secret_` keys **server-side only** (Edge Functions); the
  browser bundle carries publishable/anon keys only.

---

## 5. Release pattern — §13.6

Unchanged from the established flow: **bundle → verify → `git merge --ff-only <tag>` →
push `main` + tags**, **never `--force`** on a release tag. Push via the repo's
`push-v3.0.0.sh` (`REPO=…`). Neither repo has been pushed yet; the `-groundwork.bundle`
files carry the full history for a one-shot push.

---

## 6. §12.3 go/no-go checklist — status after P7

| Box | Status |
|---|---|
| D1 signed off; Master token verified on a scratch tenant with `auth.uid()` correct | ⬜ **P8 pilot** (needs live projects) |
| `tenant_members` allowlist on every tenant, used by every clinical policy | ✅ RLS SQL (P1–P3), PG17-proven |
| No `service_role` / `sb_secret_` key in any client-readable row or `dist/` asset | ✅ `check:tenant-secrets` + `check:admin-static` bundle scans, in CI |
| `is_active` + licence verdict gate the mount | ✅ P4/P5 + harness |
| Cached slug revalidated every boot; cached credentials never trusted | ✅ workspace-gate / tenant-provider contract |
| `sessionStorage` active pointer; two-tab test green | ✅ `harness/p4-acceptance.cjs` |
| Logout wipes RAM, both storage scopes, outbox and demo snapshot | ✅ P5 sign-out purge |
| All three brief checklist items pass **and** fail on their injected mutations | ✅ P6 (§12.1 items 1/2/3 + §12.2 mutations) |
| `CNAME` present in published `dist/`; both apps load on their domains | 🟡 **mechanism committed (P7)**; goes green when the operator sets `PAGES_CNAME`/`public/CNAME` + DNS + domain-verify (§3, §13.5) — *this row's "both apps on `https://yoursaas.com`" wording is superseded by the separate-repo topology* |
| Rollback to `v1.43.0` rehearsed | ⬜ **P8 pilot** (single-project mode is preserved and flag-off-identical, so the <15-min rollback path exists; the rehearsal is a pilot action) |

✅ = closed now · 🟡 = code/CI ready, awaiting operator infra · ⬜ = P8 pilot (live projects).

---

## 7. Rollback (D5 = pilot-first)

Directory mode is **additive and flag-gated**: with `VITE_WORKSPACE_DIRECTORY` unset/false
the clinic app boots the single-project flow byte-identically (P5e proved flag-off
identity). The frozen baselines (`LEGACY_SINGLETON_IMPORTERS` = 2,
`LEGACY_PER_CLINIC_ENV_BASELINE` = 5) and `supabase.js` + the `VITE_SUPABASE_*` contract
**stay until P8**, so a pilot clinic can roll back to v1.43.0 single-project in < 15 min
by redeploying without the directory flag. The **terminal cutover** (delete `supabase.js`,
baselines → 0) is P8, behind a successful pilot — not P7.

---

## 8. Keep-warm — verify the schedule exists, do not assume it

Supabase **Free pauses a project after 7 days without activity**. Data survives, but the
clinic's app goes dark and no licence verdict explains why. Every clinic runs on the free
tier, so Central owns the mitigation, and the contract pins the cadence
(`keep_warm`: `pause_days` **7**, `target_days` **5**, `cron_schedule` **`17 */6 * * *`**,
`probe_path` **`/rest/v1/`**, `stamp_column` **`keep_warm_at`**).

**Two producers, one stamp.**

1. **pg_cron, inside the database** — `schema.sql` §8.5 schedules
   `cron.schedule('opd-keep-warm', '17 */6 * * *', 'select public.run_keep_warm_cycle(20);')`.
   Every 6 h against a 5-day due target leaves two days of margin. Runs whether or not
   anybody has the console open.
2. **The console's Settings & Health panel** (`SetupPage.jsx`) — admin-only
   (`app_metadata.role = 'admin'`, else a 42501 with the Admin Role hint), loads up to 20 due
   workspaces via `due_keep_warm_workspaces(p_limit => 20)`, probes each tenant's `/rest/v1/`
   and stamps `stamp_keep_warm(p_workspace, p_ok)`. A **failed** probe passes `p_ok = false`
   on purpose, so it moves only `updated_at` and a paused project never looks warm. This is
   also how a freshly restored project gets back on schedule.

**Producer 1 is conditional, and the condition can silently fail.** The schedule sits inside

```sql
if exists (select 1 from pg_extension where extname = 'pg_cron')
   and exists (select 1 from pg_extension where extname = 'pg_net') then ...
```

so if either extension is missing the job is **never created** and applying `schema.sql`
only raises `NOTICE: keep-warm: pg_cron/pg_net not enabled — Settings & Health probing only`.
A NOTICE is trivially missed in the SQL editor. **Verify positively after every schema apply:**

```sql
-- 1. both extensions the guard requires — expect 2 rows
select extname, extversion from pg_extension where extname in ('pg_cron','pg_net');
--    0 or 1 row ⇒ enable them (Dashboard → Database → Extensions), then re-apply
--    schema.sql: it is idempotent, and re-scheduling the same job name replaces it.

-- 2. the job exists, is active, and carries the shipped cadence
select jobid, jobname, schedule, command, active
  from cron.job where jobname = 'opd-keep-warm';
--    expect schedule '17 */6 * * *', command 'select public.run_keep_warm_cycle(20);', active = t

-- 3. it has actually fired and succeeded
select status, return_message, start_time, end_time
  from cron.job_run_details order by start_time desc limit 8;
--    expect 'succeeded'. On 'failed', read return_message: a net.http_get queue error
--    usually means pg_net is absent or a tenant URL is unreachable.

-- 4. the fleet is really being stamped
select clinic_name, slug, is_active, keep_warm_at
  from public.workspaces order by keep_warm_at desc nulls last;
--    active rows should carry a keep_warm_at within the last 5 days
```

**Nothing outside the database can run the cycle.** `run_keep_warm_cycle` is revoked from
`public`, `anon`, `authenticated` **and `service_role`**, so no browser, Edge Function or CI
job can trigger a fleet-wide outbound probe — pg_cron is the only scheduler that works without
a deliberate grant change. That is intentional (a console click must not fan out to every
clinic's project), which means *"we'll just call it from a GitHub Action"* is **not** an
available fallback. If pg_cron genuinely cannot be enabled, producer 2 is all that remains:
an admin must open Settings & Health and probe **at least every 5 days**. Treat that as
degraded, not equivalent — it depends on a human remembering.

**If a tenant does pause:** restore it in that clinic's own Supabase dashboard, re-probe it
from Settings & Health (which restamps it), then re-run §3's verification queries. The clinic
app renders a distinct "clinic database asleep" state rather than a generic failure
(decisions register, free-tier item 2).
