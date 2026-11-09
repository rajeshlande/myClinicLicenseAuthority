# myClinicLicenseAuthority (`v1.6.0` · Schema v2)

Central subscription management & **Keyless Auto-Sync** server for [`myClinic`](https://github.com/rajeshlande/myClinic) — manage every clinic's plan, seats, expiry, and pause/kill-switch from one Central Supabase dashboard with **zero Edge Functions, zero RSA keys, and zero manual license keys required**.

---

## Two-Side Setup (No Keys · No Edge Functions)

### Side 1 — Central Server (`myClinicLicenseAuthority` · Do Once)

1. **Paste `supabase/schema.sql` (v2) in Central Supabase → SQL Editor** and click **Run** *(safe & idempotent on both new and v1 projects)*.
2. **Grant your operator email Admin standing** (in SQL Editor):
   ```sql
   update auth.users
   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
   where email = 'ops@yourdomain.com';
   ```
   *(Recommended: turn OFF **"Allow new users to sign up"** under **Authentication → Providers → Email** after creating your admin user).*
3. **Add Clinics in Subscriptions (`#/dashboard`)** using **any of 3 matching modes**:
   - **Email + Clinic URL (`email+url` — Strongest):** e.g. `dr.sharma@gmail.com` + `https://sharmaclinic.github.io` *(both must match)*.
   - **Email Only (`email` / `email+tofu`):** e.g. `dr.sharma@gmail.com` *(optional checkbox auto-locks their first cloud URL on first sync)*.
   - **Clinic URL Only (`url`):** e.g. `https://sharmaclinic.github.io` *(unlocks every doctor & receptionist on that domain automatically)*.

---

### Side 2 — Client App (`myClinic` · Build Once, Ship Anywhere)

1. Add **only** your Central Supabase URL and **publishable `anon` key** to `myClinic/.env.production` *(never `service_role` / `sb_secret_`)*:
   ```dotenv
   VITE_CENTRAL_SUPABASE_URL="https://<YOUR_CENTRAL_REF>.supabase.co"
   VITE_CENTRAL_SUPABASE_ANON_KEY="sb_publishable_..."
   ```
2. Open **`#/guide`** inside `myClinicLicenseAuthority` and click **`Copy central-subscription.mjs`** + **`Copy Vite Obfuscator Plugin`** to drop auto-sync + 7-day offline grace + scoped JS obfuscation into `myClinic`.

Whenever you **Pause**, **Extend**, or **Change Tier** (`Solo` / `Growth` / `Chain`) on Central, every `myClinic` client updates automatically on next load, tab focus, or 30-minute background sync.

---

## Central Database Security Architecture (Schema v2)

| Threat Vector | Active Defense in `supabase/schema.sql` & `auto-sync-client.mjs` |
|---|---|
| Direct table/view read or write with `anon` key | `REVOKE ALL` on all tables/views from `public, anon` + `FORCE ROW LEVEL SECURITY`. `anon` can access **0 tables** and **1 RPC** (`sync_clinic_subscription`). |
| Rogue user signup on Central Auth | RLS checks immutable `auth.jwt() -> 'app_metadata' ->> 'role' = 'admin'` (ignores user-editable `user_metadata`). Non-admin sees `0` rows. |
| Another website spoofing a clinic's URL | `sync_clinic_subscription` cross-checks `p_origin` against PostgREST's unforgeable browser `Origin` HTTP header (`ORIGIN_MISMATCH`). |
| Brute-force customer email enumeration | SHA-256 IP rate limiter (`public.sync_rate_limits`) caps lookups at **60/min** and **15 misses/5min** per IP without storing raw IPs; returns zero PII. |
| Seat-exhaustion DoS via `curl` | Cloud deployments bind deterministically to `web:<origin>` so external callers cannot consume extra seats with fake device IDs. |
| Cross-Supabase JWT leakage | Client calls Central PostgREST via raw `fetch` with only Central's `anon` key — never forwards `myClinic`'s user session JWT across projects. |
| Accidental `service_role` paste in client | `assertPublishableAnonKey()` hard-blocks `sb_secret_` and `service_role` keys at startup. |

---

## Local Verification

```bash
npm ci
npm run verify          # 33/33 tests + Vite production build + Pages check + 26/26 CONTRIBUTING checks
npm run test:security   # Security boundary pre-flight
```
