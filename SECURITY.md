# Security policy

`myclinic-license-authority` governs subscription entitlements, cryptographic RS256 capability signing, and hardware seat locks for distributed [`myClinic`](https://github.com/rajeshlande/myClinic.git) installations. Treat every security report as sensitive.

## Reporting a vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Use GitHub's private **Report a vulnerability** workflow under the repository's **Security** tab, and include:

- the affected version (`src/lib/version.js`) and commit SHA;
- whether the issue affects the Supabase SQL/RLS layer, the `verify-license` Edge Function, the React Control Room, or the distributed Express validator;
- a minimal reproduction against a **scratch** Supabase project and test RSA keypair.

We aim to acknowledge reports within 3 working days.

## Cryptographic & Trust Boundaries

Full architectural controls and audit notes are documented in [docs/SECURITY.md](docs/SECURITY.md):

1. **Asymmetric RS256 Key Split**: `LICENSE_PRIVATE_KEY` (PKCS#8) resides exclusively in Supabase Edge Function secrets. Customer-hosted containers hold only `LICENSE_PUBLIC_KEY` (SPKI) and cannot forge or extend capability tokens even with root container access.
2. **Algorithm Pinning & Anti-Cloning**: Both `server/license-middleware.mjs` and `src/lib/crypto-rs256.mjs` strictly enforce `RS256`, `iss = 'myclinic-license-authority'`, `license_key`, and `machine_fingerprint` to defeat `alg: none`, `HS256` public-key confusion, and cross-machine `.license_cache` copying.
3. **Concurrency-Safe Hardware Seat Lock**: `public.enforce_max_machines_limit()` in `supabase/schema.sql` acquires `FOR UPDATE OF l` on the parent `licenses` row before counting `activated_machines`, eliminating TOCTOU race conditions.
4. **Immutable Admin Standing**: Row-Level Security checks `(auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'` and revokes all table/view privileges from `anon`.
5. **Hardened Keyless Auto-Sync Boundary (`Schema v3` — `sync_clinic_subscription`)**:
   - **Zero `anon` Table Surface**: `ENABLE` + `FORCE ROW LEVEL SECURITY` on all 7 tables (`subscriptions`, `licenses`, `activated_machines`, `sync_rate_limits`, `sync_attempts`, `app_meta`, `schema_migrations`) and `REVOKE ALL` from `public, anon`. `anon` holds `EXECUTE` on **1 function only**: `public.sync_clinic_subscription(text, text, text)`.
   - **Browser `Origin` Header Enforcement**: Cross-checks `p_origin` against PostgREST `current_setting('request.headers', true)::jsonb ->> 'origin'` (`ORIGIN_MISMATCH`), preventing unauthorized websites from spoofing a clinic's domain.
   - **Privacy-Preserving Rate Limiting**: Hashes caller IPs with SHA-256 into `public.sync_rate_limits` (60 requests/min and 15 unmatched attempts/5min) without storing raw visitor IP addresses.
   - **Cross-Supabase Credential Isolation**: `src/lib/auto-sync-client.mjs` blocks `sb_secret_` / `service_role` keys at startup and calls Central PostgREST via raw `fetch` with only Central's publishable `anon` key — never forwarding client Supabase Auth JWTs across projects.
6. **Read-Only, Privacy-Preserving Refusal Audit (`Schema v3` — `public.sync_attempts`)**:
   - **Evidence without surveillance**: the caller IP is stored only as `encode(digest('myclinic-sync-v2:' || ip, 'sha256'), 'hex')` (the rate limiter's own pepper, so `left(ip_hash, 40)` correlates with its buckets), and the owner email only as a peppered digest plus a mask (`o***@clinic.com`). No raw IP, mailbox or device id column exists — `tests/sync-attempts.test.mjs` and `npm run test:security` both assert the column list.
   - **Claimed URLs are stored verbatim on purpose**: a clinic website address is public and already lives in `subscriptions.allowed_origin`; normalising it away would hide the single most common refusal (a client sending a path, a trailing slash or the wrong host).
   - **Nobody can forge or erase it**: the table has a single `SELECT` policy for `is_license_admin()`, no `INSERT`/`UPDATE`/`DELETE` policy, and its only writer is the `SECURITY DEFINER` RPC — an admin token that can read the evidence cannot rewrite it.
   - **Bounded growth**: 12 audit rows per hashed IP per 10 minutes, 30-day retention, and a hard 100,000-row ceiling, all pruned at most once per 24 hours through the existing rate-limit bucket table.
   - **Never a verdict**: `record_sync_attempt()` swallows every error (`WHEN OTHERS THEN NULL`), the zero-side-effect `healthcheck` probe writes nothing, and allowed syncs are not audited at all — so a healthy fleet does not grow the table.

## Auditing with a coding agent

The [Cloudflare `security-audit` skill](https://github.com/cloudflare/security-audit-skill) is vendored verbatim at `.claude/skills/security-audit/` (MIT). Ask an agent for a *"security audit of this codebase"* to run the six-phase source-first audit workflow.

Verify the vendored skill and repository security gates anytime:

```bash
npm run check:contributing -- --only skill,secrets
npm run test:security
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/schema-tests.sql
```

## Scope

- **In scope**: All SQL, Edge Function, Control Room UI, Express middleware, and GitHub Actions workflows in this repository.
- **Out of scope**: Compromised operator workstations, leaked `SUPABASE_SERVICE_ROLE_KEY` or `LICENSE_PRIVATE_KEY` caused by operator misconfiguration, or volumetric network DoS.
