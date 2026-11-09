# Pushing `myClinicLicenseAuthority` (`v2.3.0`) to GitHub

Your full Git repository history (`main` branch + `v1.0.0` .. `v2.3.0` tags) is packaged into **`myclinic-license-authority-v2.3.0.bundle`**.

---

## Step 1 — Download the Versioned Bundle

Download **`myclinic-license-authority-v2.3.0.bundle`** from the workspace viewer (`/home/user/myclinic-license-authority-v2.3.0.bundle`).

Optional integrity check:

```bash
git bundle verify ./myclinic-license-authority-v2.3.0.bundle
```

---

## Step 2 — Fast-Forward & Push to `rajeshlande/myClinicLicenseAuthority`

Inside your existing local `myClinicLicenseAuthority` folder:

```bash
git fetch ./myclinic-license-authority-v2.3.0.bundle "refs/tags/*:refs/tags/*"
git merge --ff-only v2.3.0
npm ci && npm run verify && npm run test:security
git push origin main && git push origin v2.3.0
```

*(Or if cloning fresh into a new directory:)*

```bash
git clone myclinic-license-authority-v2.3.0.bundle myClinicLicenseAuthority
cd myClinicLicenseAuthority
git checkout main
git remote set-url origin https://github.com/rajeshlande/myClinicLicenseAuthority.git
git push -u origin main --tags
```

---

## Step 3 — Apply Schema v3 to Central Supabase (required for this release)

`v2.3.0` adds the refused-attempt audit. It is **purely additive** — no table, column or RPC
signature is dropped — so a live v2 project upgrades in place:

1. Open your **Central Supabase → SQL Editor**, paste the whole `supabase/schema.sql`, **Run**.
   It is one idempotent transaction and lands on `public.app_schema_version() = 3`.
2. Optional, on a **scratch** project only (never production): run `supabase/schema-tests.sql`
   to see all 25 database checks pass and roll back cleanly.
3. Reload the console (`#/dashboard`) and hard-refresh once so the new bundle is picked up.

---

## Step 4 — GitHub Pages Secrets, Variables & the Client Side

1. **`https://github.com/rajeshlande/myClinicLicenseAuthority` → Settings → Secrets and variables → Actions → Secrets**:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY` *(public anon/publishable key only — never `service_role`)*
2. **Settings → Pages**: **Source** = **GitHub Actions**.
3. **On the client repo (`rajeshlande/myClinic`)**, the two Central values belong on the
   **Variables** tab, not Secrets (`pages.yml` reads `vars.VITE_CENTRAL_SUPABASE_URL` /
   `vars.VITE_CENTRAL_SUPABASE_ANON_KEY`). Both are already baked into the live bundle at
   `https://rajeshlande.github.io/myClinic/`.

### What changes for you on the console

`○ Awaiting Connect · Client app not opened yet` now splits in two:

| Badge | Meaning | What you do |
|---|---|---|
| `○ Awaiting Connect` | No sync attempt has ever reached Central | Open the client app and sign in as the owner |
| `● Refused` (Blushed Brick) | The client **is** calling and Central is turning it away | Open **Manage Clinic** — the drawer prints the refusal `code`, what the client actually sent (`email o***@clinic.com · URL https://…`), what is pinned on Central, and the one action that clears it |

Because refusals are only recorded from this release onwards, a clinic that last tried before
you applied Schema v3 shows `Awaiting Connect` until its next attempt (the client retries on
page open, tab focus, reconnect, and every 30 minutes).
