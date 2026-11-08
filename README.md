<div align="center">
  <img src="public/icon.svg" width="84" height="84" alt="myClinicLicenseAuthority" />
  <h1><a href="https://github.com/rajeshlande/myClinicLicenseAuthority">myClinicLicenseAuthority</a></h1>
  <p><strong>Centralized Manual Subscription Management &amp; Asymmetric RS256 License Authority for <a href="https://github.com/rajeshlande/myClinic">myClinic</a></strong></p>
  <p>Issue 32-character clinic license keys, record manual UPI / NEFT / PO payments, cap hardware &amp; web seats, and enforce offline-resilient 7-day RS256 capability tokens — with zero payment-gateway lock-in.</p>

  <p>
    <a href="https://github.com/rajeshlande/myClinicLicenseAuthority/actions/workflows/ci.yml"><img src="https://github.com/rajeshlande/myClinicLicenseAuthority/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
    <a href="https://github.com/rajeshlande/myClinicLicenseAuthority/actions/workflows/pages.yml"><img src="https://github.com/rajeshlande/myClinicLicenseAuthority/actions/workflows/pages.yml/badge.svg" alt="Deploy to GitHub Pages" /></a>
    <img src="https://img.shields.io/badge/schema-1-10b981.svg" alt="schema 1" />
    <img src="https://img.shields.io/badge/JWT-RS256%202048--bit-3b82f6.svg" alt="RS256" />
    <img src="https://img.shields.io/badge/node-%3E%3D22.22-339933.svg" alt="node >= 22.22" />
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT" /></a>
  </p>

  <p>
    <a href="https://rajeshlande.github.io/myClinicLicenseAuthority/"><strong>Live Console</strong></a> ·
    <a href="#easy-step-by-step-guide"><strong>Step-by-Step Guide</strong></a> ·
    <a href="#error-handling--troubleshooting"><strong>Troubleshooting</strong></a> ·
    <a href="https://github.com/rajeshlande/myClinic"><strong>myClinic App</strong></a> ·
    <a href="CHANGELOG.md">Changelog</a> ·
    <a href="SECURITY.md">Security</a>
  </p>
</div>

---

![myClinicLicenseAuthority Architecture](docs/architecture-overview.svg)

## Table of Contents

- [How It Works](#how-it-works)
- [Quick Start (Local Dev)](#quick-start-local-dev)
- [Easy Step-by-Step Guide](#easy-step-by-step-guide)
  - [Step 1 — Create Authority Database & Admin Account](#step-1--create-authority-database--admin-account)
  - [Step 2 — Generate RS256 Keys & Deploy `verify-license`](#step-2--generate-rs256-keys--deploy-verify-license)
  - [Step 3 — Deploy Console to GitHub Pages (or Run Locally)](#step-3--deploy-console-to-github-pages-or-run-locally)
  - [Step 4 — Issue a Clinic License Key](#step-4--issue-a-clinic-license-key)
  - [Step 5 — Connect `myClinic` (Cloud / Pages or Docker)](#step-5--connect-myclinic-cloud--pages-or-docker)
- [Plan & Seat Mapping with `myClinic`](#plan--seat-mapping-with-myclinic)
- [Error Handling & Troubleshooting](#error-handling--troubleshooting)
- [Commands & Verification Gate](#commands--verification-gate)
- [Project Structure](#project-structure)
- [Security & Contributing](#security--contributing)
- [License](#license)

---

## How It Works

**[myClinicLicenseAuthority](https://github.com/rajeshlande/myClinicLicenseAuthority)** separates **signing** from **verification** so clinic installations can work offline for up to 7 days without ever holding a secret key that could forge a subscription:

1. **Vendor Control Room (`#/dashboard` & `#/guide`):** Protected by Supabase Auth PKCE + immutable PostgreSQL RLS requiring `app_metadata.role = "admin"`. Operators record offline payments (UPI / NEFT / PO), issue 32-character hex keys, inspect bound nodes, extend expiry dates, or flip an instant **Kill-Switch**.
2. **Cloud Token Signer (`supabase/functions/verify-license`):** Holds the 2048-bit RSA **private key** (`LICENSE_PRIVATE_KEY`, `PKCS#8`), checks subscription standing and row-locked hardware/origin seat limits (`enforce_max_machines_limit()`), and returns a signed **7-day RS256 capability JWT**.
3. **Clinic Verifier ([`myClinic`](https://github.com/rajeshlande/myClinic) or Docker Gateway):** Holds only the **public key** (`VITE_LICENSE_PUBLIC_KEY` / `LICENSE_PUBLIC_KEY`, `SPKI`). Verifies signature, expiry, `machine_fingerprint`, and `allowed_origin` locally in `< 1 ms`, falling back to Read-Only / `HTTP 402 Payment Required` when expired or revoked.

> **Built-in Interactive Guide:** Once signed in to the console, click **Step-by-Step Guide (`#/guide`)** in the left sidebar for a 5-step interactive checklist with one-click SQL copy, in-browser RS256 key generation, live database checks, and Edge Function ping probes.

---

## Quick Start (Local Dev)

**Prerequisites:** **Node.js `>= 22.22.0`** (Node 26 LTS recommended), **npm**, and **Git**.

```bash
git clone https://github.com/rajeshlande/myClinicLicenseAuthority.git
cd myClinicLicenseAuthority
npm ci
cp .env.example .env.local   # Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev                  # Opens http://localhost:5173
```

---

## Easy Step-by-Step Guide

You need **two separate Supabase projects** (Free tier works for both):
- **Project A — Authority Supabase Project:** Owned by you (the vendor) for **[myClinicLicenseAuthority](https://github.com/rajeshlande/myClinicLicenseAuthority)**.
- **Project B — Clinic Supabase Project:** Owned by the clinic for **[myClinic](https://github.com/rajeshlande/myClinic)** patient/OPD data.

---

### Step 1 — Create Authority Database & Admin Account

1. Create **Project A** at [supabase.com](https://supabase.com).
2. Open **SQL Editor → New query**, paste the entire file [`supabase/schema.sql`](supabase/schema.sql), and click **Run**.
   *(Safe to re-run anytime — wraps tables, RLS policies, views, and triggers in one idempotent transaction.)*
3. Go to **Authentication → Providers → Email** and turn **OFF** *"Allow new users to sign up"* so strangers cannot self-register.
4. Go to **Authentication → Users → Add user → Create new user**, enter your operator email (e.g., `ops@yourdomain.com`) and a `12+` character password, and check **Auto Confirm User**.
5. In **SQL Editor**, grant that user immutable `admin` standing:

```sql
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
where email = 'ops@yourdomain.com';
```

---

### Step 2 — Generate RS256 Keys & Deploy `verify-license`

1. In your terminal inside `myClinicLicenseAuthority`, generate a 2048-bit RSA keypair:

```bash
npm run keygen
```

This prints two single-line `\n`-escaped values:
- **`LICENSE_PRIVATE_KEY`** (`PKCS#8`) — **keep secret**; goes **only** into your Authority Edge Function below.
- **`LICENSE_PUBLIC_KEY`** (`SPKI`) — safe to embed in `myClinic` so clinics can verify tokens offline.

2. Link the Supabase CLI to **Project A** and deploy the `verify-license` signer:

```bash
npx supabase login
npx supabase link --project-ref YOUR_AUTHORITY_PROJECT_REF
npx supabase secrets set LICENSE_PRIVATE_KEY="<PASTE_LICENSE_PRIVATE_KEY_FROM_KEYGEN>"
npx supabase functions deploy verify-license --no-verify-jwt
```

---

### Step 3 — Deploy Console to GitHub Pages (or Run Locally)

#### Option A — GitHub Pages (Automated CI/CD)
1. In your GitHub repo (`Settings → Pages`), set **Build and deployment → Source** to **GitHub Actions**.
2. In `Settings → Secrets and variables → Actions → Secrets`, add:
   - `VITE_SUPABASE_URL` = `https://YOUR_AUTHORITY_PROJECT_REF.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = your Authority **anon / publishable** key *(never `service_role` or `sb_secret_`)*
3. Push to `main` — [`.github/workflows/pages.yml`](.github/workflows/pages.yml) runs tests, builds `dist/`, and publishes to `https://<your-username>.github.io/myClinicLicenseAuthority/`.

#### Option B — Run Locally
1. Put `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env.local`.
2. Run `npm run dev` and open `http://localhost:5173`.
3. Sign in with `ops@yourdomain.com`, then open **Step-by-Step Guide (`#/guide`)** or **Settings (`#/setup`) → Run 3-point health check** to confirm Auth + DB + Edge Function are all green.

---

### Step 4 — Issue a Clinic License Key

1. In the console, click **Issue License** (top-left button on `#/dashboard`).
2. Fill in:
   - **Customer Email:** e.g. `owner@sunriseclinic.in`
   - **Plan Tier:** `solo`, `growth`, or `chain`
   - **Max Hardware / Web Nodes:** e.g. `2`
   - **Expiration Date:** e.g. `+1 year`
   - **Billing / PO Notes:** e.g. `UPI UTR 412988310021 · Paid ₹23,990`
3. Click **Provision Subscription & Key**, then copy the **32-character hex `LICENSE_KEY`** (or click **Deploy** on the row to open `#/node-agent` pre-filled with that key).

---

### Step 5 — Connect `myClinic` (Cloud / Pages or Docker)

Open **Deployment (`#/node-agent`)** in the console, paste your `LICENSE_PUBLIC_KEY`, choose your deployment mode, and copy the generated snippets:

#### Mode A — `myClinic` on Supabase + GitHub Pages (Recommended)
1. **In `myClinic` (`.env.local` or GitHub Actions Repository Variables):**
   ```dotenv
   VITE_LICENSE_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
   ```
2. **In the `myClinic` repo terminal (pointed at Project B — the clinic's Supabase project):**
   ```bash
   npx supabase secrets set \
     AUTHORITY_VERIFY_URL="https://YOUR_AUTHORITY_PROJECT_REF.supabase.co/functions/v1/verify-license" \
     CLINIC_LICENSE_KEY="PASTE_32_CHAR_HEX_LICENSE_KEY" \
     CLINIC_ORIGIN="https://clinic-domain.example.com" \
     --project-ref YOUR_CLINIC_PROJECT_REF

   npx supabase functions deploy sync-clinic-license --project-ref YOUR_CLINIC_PROJECT_REF
   ```
3. Open `myClinic` as the clinic owner → **Settings → Subscription** → click **"Check the licence now"**. `myClinic` fetches, verifies, and stores the 7-day RS256 capability token!

#### Mode B — Self-Hosted Docker Gateway (`server/node-host.mjs`)
1. Switch `#/node-agent` to **Docker Gateway**, copy the generated `docker-compose.yml`, and run:
   ```bash
   docker compose up -d
   ```
2. Check status anytime at `http://localhost:8080/api/license/status` or `http://localhost:8080/healthz`.

---

## Plan & Seat Mapping with `myClinic`

| Authority Tier | `myClinic` Plan | Doctors | Front Desk | Branches |
| --- | --- | :---: | :---: | :---: |
| `solo` | `solo` | `1` | `1` | `1` |
| `growth` *(or legacy `standard`)* | `growth` | `5` | `3` | `1` |
| `chain` *(or legacy `pro` / `enterprise`)* | `chain` | Unlimited | Unlimited | Unlimited |

---

## Error Handling & Troubleshooting

**[myClinicLicenseAuthority](https://github.com/rajeshlande/myClinicLicenseAuthority)** includes multi-layer error handling (`src/lib/errors.mjs`, `ErrorBoundary.jsx`, `ErrorAlert.jsx`, and `Settings → Diagnostics`):

- **Plain-English Remediation:** PostgREST, PostgreSQL, Supabase Auth, WebCrypto, network timeout (`12s`), and Edge Function errors are automatically translated into actionable **"How to fix"** banners with a **Try again** button and expandable technical details.
- **Private-Key Leak Prevention:** Pasting a `PRIVATE KEY` into a client `PUBLIC KEY` field or a `service_role` / `sb_secret_` key into browser config is blocked immediately before saving or copying.
- **Crash & Chunk-Update Recovery:** `ErrorBoundary` catches render crashes and stale lazy-chunk fetches after GitHub Pages deployments, offering one-click reload and **secret-redacted diagnostic copy** (`[REDACTED_JWT]`, `[REDACTED_PEM_KEY]`, `[REDACTED_LICENSE_KEY]`).

| Error / Symptom | Cause | Exact Fix |
| --- | --- | --- |
| **`Admin role required`** after signing in | User exists in `auth.users`, but `raw_app_meta_data` lacks `{"role":"admin"}`. | Copy the SQL shown right on the Sign-In screen into Supabase **SQL Editor**, click **Run**, then click **Check again**. |
| **`PGRST204` / `admin_license_view does not exist`** | `supabase/schema.sql` has not been applied yet. | Paste [`supabase/schema.sql`](supabase/schema.sql) into Authority Supabase **SQL Editor** and click **Run**. |
| **`HTTP 403 MAX_MACHINES_EXCEEDED` (`53400`)** | All `max_machines` seats for this license are occupied. | Open **Licenses (`#/dashboard`) → Inspect** on that clinic and click **Release** on an old node (or raise `max_machines`). |
| **`HTTP 402 SUBSCRIPTION_INACTIVE` / `KEY_KILLED`** | License expired or remote Kill-Switch is active. | Open **Licenses (`#/dashboard`)**, click **Enable**, or **Inspect → Save Term** with a future expiry date. |
| **`HTTP 404 / 502` on `verify-license`** | Edge Function not deployed or `LICENSE_PRIVATE_KEY` missing. | Run `npx supabase secrets set LICENSE_PRIVATE_KEY="..."` and `npx supabase functions deploy verify-license --no-verify-jwt`. |
| **`ORIGIN_MISMATCH` / `FINGERPRINT_MISMATCH`** | Token was minted for a different `web:<origin>` or host ID. | Match `CLINIC_ORIGIN` to the exact `https://...` origin (no trailing slash) and re-sync. |

---

## Commands & Verification Gate

Works identically on **Windows, macOS, and Linux**:

| Command | Description |
| --- | --- |
| `npm run dev` | Start Vite dev server on `0.0.0.0:5173` |
| `npm run keygen` | Generate 2048-bit RSA `PKCS#8` + `SPKI` keypair locally |
| `npm run start:node` | Run Express 5 local RS256 validator gateway (`server/node-host.mjs`) |
| `npm test` | Run all Node unit, crypto, compatibility, error-handling & audit tests |
| `npm run build` | Build production static bundle into `dist/` |
| `npm run check:pages` | Verify relative asset URLs, PWA manifest, icons & service worker |
| `npm run check:contributing` | Run all 26 `CONTRIBUTING.md` security, style & coverage checks |
| `npm run verify` | Full CI gate: `test` + `build` + `check:pages` + `check:contributing` |

---

## Project Structure

```text
myClinicLicenseAuthority/
├── .claude/skills/security-audit/   # Vendored Cloudflare security-audit skill + validators
├── .github/workflows/               # CI matrix (ci.yml) + GitHub Pages deploy (pages.yml)
├── docs/                            # Architecture SVG & deeper security docs
├── public/                          # PWA manifest, icons, relative service worker (sw.js)
├── scripts/                         # keygen, cross-platform test runner, Pages & CONTRIBUTING gates
├── server/                          # Express 5 offline RS256 gateway & 6h sync scheduler
├── src/
│   ├── components/                  # AppShell, ErrorBoundary, ErrorAlert, RichNotes, SlideOverDrawer
│   ├── lib/                         # Pure ESM logic: auth, clipboard, crypto-rs256, entitlements, errors, health, notes, theme
│   └── pages/                       # LoginPage, EntitlementsPage, GuidePage, NodeAgentPage, ValidatorLabPage, SetupPage
├── supabase/
│   ├── functions/verify-license/    # Deno RS256 7-day capability JWT signer Edge Function
│   ├── schema.sql                   # Single idempotent PostgreSQL + RLS + RPC schema (v1)
│   └── schema-tests.sql             # Transactional SQL security & concurrency test suite
└── tests/                           # 14 automated test suites
```

---

## Security & Contributing

- Please read [`SECURITY.md`](SECURITY.md) for vulnerability reporting and zero-trust invariants.
- Please read [`CONTRIBUTING.md`](CONTRIBUTING.md) before opening pull requests (`npm run verify` must pass `26/26` checks with `0` warnings).

## License

Released under the [MIT License](LICENSE).
