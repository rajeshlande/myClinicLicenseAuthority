# Security Architecture & Audit Ledger

Summary of trust boundaries and mitigated attack classes verified against `.claude/skills/security-audit/`.

## 1. Trust Boundaries

1. **Public Static Hosting (GitHub Pages / Browser Bundle)**
   - Contains zero secrets. When `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are absent, runs entirely in deterministic client-side Demo Mode.
   - `src/lib/health.mjs` and `.github/workflows/pages.yml` inspect configured keys and refuse `service_role` or `sb_secret_` tokens.
   - `public/sw.js` caches only static shell assets on the same origin and explicitly bypasses `/rest/v1/`, `/auth/v1/`, and `/functions/v1/`.

2. **Central PostgreSQL Authority (`supabase/schema.sql`)**
   - `anon` has `REVOKE ALL` across every table, view, and provisioning RPC.
   - `admin_license_view` is declared `WITH (security_invoker = true)` so PostgreSQL evaluates caller RLS on `subscriptions`, `licenses`, and `activated_machines`.
   - Admin RLS checks `auth.jwt() -> 'app_metadata' ->> 'role' = 'admin'` (server-controlled claim) rather than `user_metadata` (user-writable).

3. **Central Edge Signer (`supabase/functions/verify-license/index.ts`)**
   - Uses `SUPABASE_SERVICE_ROLE_KEY` internally with `persistSession: false`.
   - Enforces `is_active = true`, `status = 'active'`, `now < expires_at`, and `registered_machines < max_machines` backed by PostgreSQL's `FOR UPDATE` trigger `enforce_max_machines_limit()`.
   - Signs short-lived 7-day RS256 capability tokens via WebCrypto (`RSASSA-PKCS1-v1_5` SHA-256).

4. **Distributed On-Premises Node (`server/license-middleware.mjs`)**
   - Verifies cloud responses against `LICENSE_PUBLIC_KEY` *before* writing `.license_cache` via atomic `.tmp` + `renameSync` (`0o600`).
   - Pins `algorithms: ['RS256']` and `issuer: 'myclinic-license-authority'` to block `HS256` key-confusion and `alg: none` bypasses.
   - Verifies `decoded.machine_fingerprint === localMachineFingerprint` on every request so `.license_cache` copied from another machine returns `402 Payment Required` (`HARDWARE_FINGERPRINT_MISMATCH`).

## 2. Mitigated Findings Checklist

| Class | Control | Verification |
| --- | --- | --- |
| XSS via billing/PO rich notes | Pure AST parser (`src/lib/notes.mjs`) + React element renderer (`RichNotesView.jsx`); zero `dangerouslySetInnerHTML` | `tests/notes.test.mjs`, `check-contributing.mjs` (`xss`) |
| JWT algorithm confusion (`HS256` / `none`) | Explicit `algorithms: ['RS256']` in `jsonwebtoken` & WebCrypto header check | `tests/middleware.test.mjs`, `tests/crypto-rs256.test.mjs` |
| Hardware lock TOCTOU race condition | `SELECT ... FOR UPDATE OF l` inside `enforce_max_machines_limit()` trigger | `supabase/schema-tests.sql`, `tests/schema.test.mjs` |
| Cross-host `.license_cache` cloning | `machine_fingerprint` signed into JWT and checked offline per HTTP request | `tests/middleware.test.mjs` |
| View RLS bypass | `CREATE OR REPLACE VIEW public.admin_license_view WITH (security_invoker = true)` | `supabase/schema-tests.sql`, `tests/schema.test.mjs` |
| Privilege escalation via `user_metadata` | `is_license_admin()` inspects `app_metadata.role` only | `supabase/schema-tests.sql`, `tests/schema.test.mjs` |
