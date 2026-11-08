<div align="center">
  <img src="public/icon.svg" width="84" height="84" alt="myClinicLicenseAuthority" />
  <h1><a href="https://github.com/rajeshlande/myClinicLicenseAuthority">myClinicLicenseAuthority</a></h1>
  <p><strong>Manual Subscription &amp; RS256 License Control Room for <a href="https://github.com/rajeshlande/myClinic">myClinic</a></strong></p>

  <p>
    <a href="https://github.com/rajeshlande/myClinicLicenseAuthority/actions/workflows/ci.yml"><img src="https://github.com/rajeshlande/myClinicLicenseAuthority/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
    <a href="https://github.com/rajeshlande/myClinicLicenseAuthority/actions/workflows/pages.yml"><img src="https://github.com/rajeshlande/myClinicLicenseAuthority/actions/workflows/pages.yml/badge.svg" alt="Deploy to GitHub Pages" /></a>
    <img src="https://img.shields.io/badge/schema-1-10b981.svg" alt="schema 1" />
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT" /></a>
  </p>

  <p>
    <a href="https://rajeshlande.github.io/myClinicLicenseAuthority/"><strong>Live Console</strong></a> ·
    <a href="#side-1--mycliniclicenseauthority-side-do-once"><strong>Authority Steps</strong></a> ·
    <a href="#side-2--myclinic-side-do-per-clinic"><strong>myClinic Steps</strong></a> ·
    <a href="#common-errors--fixes"><strong>Error Fixes</strong></a>
  </p>
</div>

---

## Big Picture (In 30 Seconds)

You use **2 separate free Supabase projects**:

| App | Who owns it | Supabase Project | Holds which key? |
| --- | --- | --- | --- |
| **[myClinicLicenseAuthority](https://github.com/rajeshlande/myClinicLicenseAuthority)** | **You (Vendor)** | **Project #1** (Authority DB) | **`LICENSE_PRIVATE_KEY`** *(signs 7-day tokens)* |
| **[myClinic](https://github.com/rajeshlande/myClinic)** | **Each Clinic** | **Project #2** (Clinic DB) | **`LICENSE_PUBLIC_KEY`** *(verifies tokens only — cannot forge)* |

Everything below takes **3 steps on your Authority side (done once)** and **3 steps on the `myClinic` side (done per clinic)** — **100% in the browser, zero terminal required**.

---

## Side 1 — `myClinicLicenseAuthority` Side *(Do Once)*

### Step 1 — Set Up Authority Database & Your Admin Login
1. Create **Supabase Project #1** (Authority).
2. Open **SQL Editor**, paste [`supabase/schema.sql`](supabase/schema.sql), and click **Run**.
3. Open **Authentication → Users → Add user**, create your email + password *(and turn OFF "Allow new users to sign up" under Authentication → Providers → Email)*.
4. In **SQL Editor**, make your email an admin:
   ```sql
   update auth.users
   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
   where email = 'your-email@example.com';
   ```
5. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (Project #1's URL and **anon/publishable** key) in your GitHub repo **Settings → Secrets and variables → Actions → Secrets** (or `.env.local` locally).

### Step 2 — Generate Keys & Paste `verify-license` in Supabase
1. Sign in to **[myClinicLicenseAuthority](https://rajeshlande.github.io/myClinicLicenseAuthority/)**, open **Step-by-Step Guide (`#/guide`)**, and click **Generate Keys**.
2. In **Project #1 → Edge Functions → Secrets**, add:
   - `LICENSE_PRIVATE_KEY` = *(click **1. Private Key** in `#/guide` to copy)*
3. In **Project #1 → Edge Functions → Deploy a new function → Via Editor**:
   - **Name:** `verify-license`
   - **Verify JWT:** turn **OFF**
   - **Code:** click **2. Function Script** in `#/guide` (or copy [`supabase/functions/verify-license/index.ts`](supabase/functions/verify-license/index.ts)) → click **Deploy**.
4. Click **3. Public Key** in `#/guide` and save it for Side 2.

### Step 3 — Issue a Clinic License Key
1. Click **+ Issue License** in the console (`#/dashboard`).
2. Enter the clinic's email, pick a plan (`solo`, `growth`, or `chain`), and click **Provision**.
3. Copy the **32-character `LICENSE_KEY`**.

---

## Side 2 — `myClinic` Side *(Do Per Clinic)*

### Step 1 — Add `VITE_LICENSE_PUBLIC_KEY` to `myClinic`
In the clinic's [`myClinic`](https://github.com/rajeshlande/myClinic) GitHub repo (**Settings → Secrets and variables → Actions → Variables**) — or in `myClinic/.env.local` — add:

```dotenv
VITE_LICENSE_PUBLIC_KEY="<Paste Public Key from Side 1 Step 2>"
```

### Step 2 — Add 3 Secrets & Deploy `sync-clinic-license` on Clinic Supabase
1. Make sure `myClinic/supabase/schema.sql` (schema 18) has been run in **Supabase Project #2** (the clinic's SQL Editor).
2. In **Project #2 → Edge Functions → Secrets**, add these **3 secrets**:

| Secret Name | Value |
| --- | --- |
| `AUTHORITY_VERIFY_URL` | `https://<YOUR-PROJECT-1-REF>.supabase.co/functions/v1/verify-license` |
| `LICENSE_KEY` | `<32-character key from Side 1 Step 3>` |
| `LICENSE_PUBLIC_KEY` | `<Public Key from Side 1 Step 2>` |

3. In **Project #2 → Edge Functions → Deploy a new function → Via Editor**:
   - **Name:** `sync-clinic-license`
   - **Verify JWT:** turn **OFF**
   - **Code:** paste `myClinic/supabase/functions/sync-clinic-license/index.ts` → click **Deploy**.

### Step 3 — Click "Check the licence now" in `myClinic`
Sign in to **`myClinic`** as the clinic **Owner** → open **Subscription** → click **"Check the licence now"**.
Done! `myClinic` now enforces your plan (`solo` = 1 doc, `growth` = 5 docs, `chain` = unlimited) and refreshes automatically every 6 hours with a 7-day offline grace token.

---

## Common Errors & Fixes

Every screen in `myClinicLicenseAuthority` translates database, auth, network, and Edge Function errors into plain-English **"How to fix"** banners (`src/lib/errors.mjs`, `ErrorBoundary.jsx`, and **Settings → Diagnostics**):

| Error | Why it happened | Fix |
| --- | --- | --- |
| **`Admin role required`** | Your user doesn't have `role: "admin"` yet | Copy the SQL shown right on the Sign-In card → run in Project #1 SQL Editor → click **Check again**. |
| **`PGRST204` / missing `admin_license_view`** | `supabase/schema.sql` wasn't run | Paste [`supabase/schema.sql`](supabase/schema.sql) into Project #1 SQL Editor → **Run**. |
| **`not-configured`** in `myClinic` | Missing secret on Clinic Supabase | Add `AUTHORITY_VERIFY_URL`, `LICENSE_KEY`, and `LICENSE_PUBLIC_KEY` in Project #2 → Edge Functions → Secrets. |
| **`Hardware seat limit reached` / `expired`** | Max origins reached or expiry passed | Open **Licenses (`#/dashboard`) → Inspect** to release an old node or extend the expiry date. |

---

## Local Dev & CI Commands

```bash
npm ci
npm run dev       # Start local console on http://localhost:5173
npm run verify    # Run all 29 tests + build + Pages check + 26 CONTRIBUTING checks
```

## License

[MIT](LICENSE) · Security policy in [`SECURITY.md`](SECURITY.md) · Standards in [`CONTRIBUTING.md`](CONTRIBUTING.md).
