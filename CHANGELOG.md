# Changelog

All notable changes to `myClinicLicenseAuthority` are documented in this file.

## [1.5.1] - 2026-11-06

### Added
- **Zero-Terminal Supabase Dashboard Script Option on Step 2 (`src/pages/GuidePage.jsx`, `supabase/functions/verify-license/index.ts`):**
  - Replaced external `djwt` URL import in `verify-license/index.ts` with built-in WebCrypto `RSASSA-PKCS1-v1_5` JWT signing (`signRs256Jwt`), making `verify-license/index.ts` a 100% self-contained single-file script that pastes and deploys directly inside **Supabase Dashboard → Edge Functions → Deploy a new function → Via Editor** with zero CLI required.
  - Added 3 deployment tabs to Step 2 in `#/guide`: **Option A — Supabase Dashboard Script (No Terminal)** with one-click copy buttons for `LICENSE_PRIVATE_KEY`, `verify-license` (`index.ts`), and `LICENSE_PUBLIC_KEY`; **Option B — One-Command Automated Script (`npm run deploy:signer` / `scripts/deploy-signer.mjs`)**; and **Option C — Manual Supabase CLI**.

## [1.5.0] - 2026-11-06

### Added
- **Interactive 5-Step Setup & Onboarding Guide (`src/pages/GuidePage.jsx` at `#/guide`):** Step-by-step checklist with persisted progress, one-click Admin Role SQL generator, live database + RLS verification, in-browser RS256 keypair generator, `verify-license` Edge Function ping probe, and built-in troubleshooting reference.
- **Multi-Layer Error Handling & Sanitized Diagnostics (`src/lib/errors.mjs`, `src/lib/clipboard.mjs`, `src/components/ErrorBoundary.jsx`, `src/components/ErrorAlert.jsx`, `tests/errors.test.mjs`):**
  - Actionable error classification (`explainError`) mapping schema mismatches, non-admin RLS refusals, expired sessions, hardware seat limits (`53400`), kill-switches, network timeouts (`fetchWithTimeout`), and Edge Function deployment issues to step-by-step fix instructions.
  - Global & per-route React `ErrorBoundary` catching render crashes and stale lazy-chunk loads after deployments, plus secret-redacted session error logs under **Settings → Diagnostics & Recent Errors** (`#/setup`).
  - Proactive private-key leak guard (`validatePublicKeyPemInput`) blocking accidental `PRIVATE KEY` pastes into client `PUBLIC KEY` fields, Express 5 malformed-JSON/runtime error handler in `server/node-host.mjs`, and Windows `pathToFileURL` entrypoint detection in `scripts/check-contributing.mjs`.
- **Streamlined `myClinicLicenseAuthority` Documentation (`README.md`):** Rebuilt with direct [`rajeshlande/myClinicLicenseAuthority`](https://github.com/rajeshlande/myClinicLicenseAuthority) links, clear 5-step setup guide, and troubleshooting matrix.

## [1.4.1] - 2026-11-06

### Fixed
- **Windows `npm test` / `npm run verify` Compatibility (`tests/audit-skill.test.mjs`):** Fixed `audit-skill.test.mjs` failing on Windows (`OS no-follow and nonblocking input protection is unavailable`) because upstream `validate-findings.cjs` CLI file descriptor opening requires POSIX `O_NOFOLLOW | O_NONBLOCK`. The test suite now validates `validateDocument()` + `canonicalCoverageId()` cross-platform on Windows, macOS, and Linux, runs the POSIX CLI test suites when `O_NOFOLLOW | O_NONBLOCK` are present, and verifies the fail-closed guard on Windows.

## [1.4.0] - 2026-11-06

### Changed (`rajeshlande/myClinic` v1.20+ Schema 18 Alignment)
- **`verify-license` Web Origin Normalization & `allowed_origin` Claim (`supabase/functions/verify-license/index.ts`):** Normalized `web:<origin>` fingerprints (lowercase, stripped trailing `/`) so casing or slash variations cannot consume duplicate seats, and populated `allowed_origin` inside the signed RS256 JWT even on server-to-server `sync-clinic-license` calls from `myClinic` (where no browser `Origin` header is present) so `myClinic`'s `authorityView().origin` renders accurately.
- **First-Class `myClinic` (`sync-clinic-license`) Deployment Kit (`src/lib/entitlements.mjs`, `src/pages/NodeAgentPage.jsx`):** Replaced legacy browser-bundle `VITE_LICENSE_KEY` snippets with `buildMyClinicCloudSetup()`, generating the exact two-step `myClinic v1.20+` configuration: (1) `VITE_LICENSE_PUBLIC_KEY` build variable (`LICENSE_KEY` never enters the browser bundle) and (2) `npx supabase secrets set AUTHORITY_VERIFY_URL LICENSE_KEY LICENSE_PUBLIC_KEY MYCLINIC_ORIGINS` + `npx supabase functions deploy sync-clinic-license`.

### Security
- **Scanned `tests/` for Credential-Shaped Literals (`scripts/check-contributing.mjs`, `tests/contributing.test.mjs`):** Removed `'tests/'` from `SECRET_SCAN_SKIP` (matching `myClinic v1.20.2`) and assembled all secret-scanner fixtures from runtime fragments so GitHub Secret Scanning never raises alerts on test files.
- **Added Browser `Content-Security-Policy` (`index.html`):** Added strict CSP `<meta>` defense-in-depth for static GitHub Pages deployments and added `tests/myclinic-compat.test.mjs` verifying end-to-end RS256 claim and tier parity with `rajeshlande/myClinic`.

## [1.3.0] - 2026-11-06

### Security (Cloudflare `security-audit-skill` Remediation)
- **Redacted Secret `LICENSE_KEY` from `/api/clinic/entitlements` (`server/node-host.mjs`):** Removed plaintext `req.license.license_key` from the clinic-facing gateway status response so unprivileged front-desk browsers and LAN peers cannot harvest the bearer subscription key to exhaust `max_machines` seats.
- **Hardened `POST /api/license/refresh` & Atomic Cache Writes (`server/node-host.mjs`, `server/license-middleware.mjs`):** Restricted manual license refresh to loopback callers (`127.0.0.1` / `::1`) or timing-safe `Bearer <LICENSE_REFRESH_TOKEN>`, added single-flight promise coalescing + manual refresh cooldown in `startLicenseSyncScheduler`, and appended per-write CSPRNG entropy to `.license_cache.<pid>.<nonce>.tmp`.
- **Sanitized Public Edge Function `HTTP 500` Responses (`supabase/functions/verify-license/index.ts`):** Stopped echoing raw internal `Error.message` diagnostics to unauthenticated callers on unhandled exceptions.
- **Removed Pre-Auth Internal Schema/SQL/Endpoint Disclosures & Added CSV Formula Neutralization (`src/pages/LoginPage.jsx`, `src/lib/entitlements.mjs`):** Removed `auth.users` SQL snippets, claim paths, environment variable names, and endpoint telemetry from pre-admin screens, and added `sanitizeCsvCell()` to neutralize leading spreadsheet formula triggers (`=`, `+`, `-`, `@`, `\t`, `\r`) during CSV export.

### Changed
- **Minimal Sign-In & Decluttered In-App Console (`src/pages/LoginPage.jsx`, `src/components/AppShell.jsx`, `src/pages/SetupPage.jsx`, `src/pages/EntitlementsPage.jsx`, `src/pages/NodeAgentPage.jsx`, `src/pages/ValidatorLabPage.jsx`):** Streamlined the Sign-In screen and post-login navigation, Settings, Deployment, and Key Tools pages by removing redundant subheaders, verbose technical callouts, static CLI walls, and pre-filled placeholder strings.

## [1.2.0] - 2026-11-06

### Fixed
- **Cloud Supabase Auto-Connection Inspector (`src/lib/health.mjs`, `src/lib/supabase.js`):** Fixed `inspectSupabaseConfig()` to accept both `{ VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY }` (`import.meta.env`) and `{ url, anonKey }`, resolving the bug where valid Cloud Supabase credentials fell through to `"Running in offline/Pages demo mode with pre-seeded clinic contracts."`.

### Changed
- **Cloud-Only Internet Auto-Connect, Zero Local Accounts, Zero Demo Contracts:** Removed `src/lib/demo-store.mjs`, `tests/demo-store.test.mjs`, and all client-side local operator accounts. The web app now auto-connects over HTTPS to Cloud Supabase on boot via `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (matching `rajeshlande/myClinic` PKCE auth), monitors live `online`/`offline` network state to auto-resume token refresh, and enforces `app_metadata.role = "admin"` exclusively against Cloud Supabase.
- **Added Live Cloud Connection Self-Test (`src/pages/SetupPage.jsx`) & Cache Bust (`public/sw.js`):** Added REST API + `public.app_schema_version()` live verification inside `#/setup` and bumped the PWA shell cache (`myclinic-authority-shell-v2`).

## [1.1.0] - 2026-11-06

### Added
- **Zero-Trust Cloud Admin Authentication Gate (`src/pages/LoginPage.jsx`, `src/lib/auth.mjs`):** Hard-gates all Control Plane routes (`#/dashboard`, `#/node-agent`, `#/simulator`, `#/setup`) behind an authenticated Supabase operator session carrying `app_metadata.role = 'admin'`.
- **Operator Sign-In & Password Recovery Flows:** Email + password sign-in with visibility toggle, password recovery link dispatch (`resetPasswordForEmail`) compatible with GitHub Pages hash routing (`#/reset-password`), in-app password rotation (`updateUser`), and a `403 · Admin Role Claim Required` remediation screen with copyable `auth.users` SQL grant.

## [1.0.0] - 2026-11-06

### Added
- Unified single-repository web application (`src/`) and distributed Express 5 local validator (`server/`) for self-hosted `myClinic` deployments.
- Single source-of-truth idempotent PostgreSQL schema (`supabase/schema.sql`, Schema v1) with `subscriptions`, `licenses`, `activated_machines`, row-locked `enforce_max_machines_limit()` trigger, `security_invoker` `admin_license_view`, atomic `create_subscription_with_license()` RPC, and scratch regression suite (`supabase/schema-tests.sql`).
- Supabase Edge Function (`supabase/functions/verify-license/index.ts`) signing 7-day RS256 capability JWTs via PKCS#8 WebCrypto.
- GitHub Pages ready hash-routed Control Room (`EntitlementsPage`, `ValidatorLabPage`, `NodeAgentPage`, `SetupPage`) with zero-HTML rich notes AST rendering and in-browser RS256 Key Studio.
- Vendored Cloudflare `security-audit` skill (`.claude/skills/security-audit/`), `AGENTS.md`, `CLAUDE.md`, `SECURITY.md`, `CONTRIBUTING.md`, automated CI + Pages workflows, and full Node test suite (`tests/`).
