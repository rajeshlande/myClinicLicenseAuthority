# Changelog

All notable changes to `myClinicLicenseAuthority` are documented in this file.

## [2.3.0] - 2026-11-09

### Added
- **Refused-Attempt Audit — Schema v3 (`supabase/schema.sql`, `supabase/schema-tests.sql`, `src/lib/entitlements.mjs`, `src/pages/EntitlementsPage.jsx`):**
  - **The problem this closes:** `sync_clinic_subscription()` writes an `activated_machines` seat row **only** on the fully-allowed path, so every refusal (`SUBSCRIPTION_NOT_FOUND`, `ORIGIN_MISMATCH`, `RATE_LIMITED`, `SEAT_LIMIT_REACHED`, `SUBSCRIPTION_PAUSED`, `SUBSCRIPTION_EXPIRED`, `SUBSCRIPTION_INACTIVE`, `INVALID_EMAIL`, `INVALID_ORIGIN`, `MISSING_IDENTITY`) left zero trace. A client calling every 30 minutes and being refused every time — because the pinned owner email or Clinic URL differs by one character — was indistinguishable on the console from a client that was never opened: both rendered `○ Awaiting Connect · Client app not opened yet`.
  - **`public.sync_attempts`** (additive, table 5): `code`, `status`, `match_mode`, `claimed_origin`, `browser_origin`, `origin_header_ok`, `subscription_id`, `license_id`, `attempted_at`, plus privacy-preserving identifiers — `ip_hash` (SHA-256 with the rate limiter's own `myclinic-sync-v2:` pepper, so `left(ip_hash, 40)` correlates with its `req:`/`miss:` buckets), `claimed_email_hash` (peppered SHA-256) and `claimed_email_hint` (`o***@clinic.com`). No raw IP, mailbox or device-id column exists. `claimed_origin` / `browser_origin` are stored **verbatim on purpose** — a clinic website address is public and already lives in `subscriptions.allowed_origin`, and normalising it away would hide the most common refusal of all.
  - **`public.record_sync_attempt()`**: `SECURITY DEFINER` with pinned `search_path`, zero dynamic SQL, **no grant to `public`, `anon` or `authenticated`** (only the auto-sync RPC can reach it), and best-effort by contract — every failure is swallowed (`WHEN OTHERS THEN NULL`) so an audit problem can never change or block a client verdict. Timestamps use `clock_timestamp()`, not `now()`, because `now()` is frozen for a whole transaction and would make "latest refusal" ambiguous.
  - **Near-miss attribution**: an unmatched call would otherwise have no `license_id` to hang the refusal on, so the `SUBSCRIPTION_NOT_FOUND` path now finds the subscription that *almost* matched (origin candidates preferred over email-only candidates) and records `match_mode = 'near-miss:email+url'` — or `'no-candidate'`. This is audit-only and never changes the verdict.
  - **Bounded growth**: 12 audit rows per hashed IP per 10 minutes (validation refusals happen *before* the RPC's own rate limiter, so an unauthenticated caller could otherwise grow the table at will), 30-day retention plus a hard 100,000-row ceiling, pruned at most once per 24h through the existing `sync_rate_limits` bucket table. Allowed syncs and the zero-side-effect `healthcheck` probe write nothing.
  - **`admin_license_view`** gains six columns, appended last so `CREATE OR REPLACE VIEW` upgrades live v1/v2 installs in place: `last_refusal_code`, `last_refusal_at`, `refusals_24h`, `last_refusal_email_hint`, `last_refusal_origin`, `last_refusal_browser_origin` — each "latest" subquery ordered `attempted_at desc, id desc` for a deterministic tiebreak.
  - **Read-only evidence**: `sync_attempts` is `ENABLE` + `FORCE ROW LEVEL SECURITY`, `REVOKE ALL` from `public, anon`, `GRANT SELECT` to `authenticated`, and exactly one policy (`sync_attempts_admin_read`, `is_license_admin()`). An admin token can read the evidence but cannot write or erase it; `anon` still holds `EXECUTE` on one function only.
- **`Refused` Client Sync State (`src/lib/entitlements.mjs`, `src/pages/EntitlementsPage.jsx`):**
  - New `SYNC_REFUSAL_HINTS` vocabulary mapping every code the RPC can emit to a short label and the one action that clears it, plus `describeRefusal()` (masked email, verbatim claimed URL, relative time, 24h count, `claim` sentence).
  - `describeClientSyncState()` returns `state: 'refused'`, `tone: 'error'`, badge `Refused`, detail `SUBSCRIPTION_NOT_FOUND · 4m ago` when no seat was ever granted but Central recorded an attempt — and `awaiting_connect` keeps its honest `Client app not opened yet` when nothing has arrived. A recorded refusal **never overrides a delivered verdict**: a paused clinic still reads `● Pause Synced`, with the refusal carried alongside for the inspector. Every state now returns the same shape (`hint`, `refusal`, `refusals24h`).
  - `computeFleetMetrics()` counts `refusedClinicsCount` and `awaitingClinicsCount`; the four sync states partition the fleet. The **Client Sync Live** tile now leads with `synced · N refused` in Blushed Brick (`#f2dadb` / `#73292b` / `#bc4749`) when anything is being turned away.
  - New `buildSyncPillStyle()` replaces three copies of the same inline tone ternary, so the `error` tone is defined once. The Manage Clinic drawer shows a refusal card (code, what the client sent, what is pinned here, and the fix) and, for a connected clinic, a muted `N refused attempts in the last 24h` line. CSV export gains `last_refusal_code` and `refusals_24h`.
- **Verification (`tests/sync-attempts.test.mjs`, `scripts/security-check.mjs`):**
  - 9 new tests: the hint map is cross-checked against the `'code', '…'` literals parsed out of the RPC body (a new refusal without a hint fails the build, and so does an invented one), refusal masking and ordering, the `Refused` vs `Awaiting Connect` split, refusal-never-overrides-a-verdict, uniform state shape, fleet partitioning, the audit's privacy/attribution/throttle/read-only invariants, view column ordering, and the `schema_version` fallback.
  - `supabase/schema-tests.sql` §7 proves the audit end to end on a real database: near-miss attribution with a masked mailbox, the TOFU and kill-switch refusals, `ORIGIN_MISMATCH` keeping claim vs browser Origin, hashed-only columns, no audit row for allowed verdicts, `anon` denied read, an admin token denied insert, and 30-day retention pruning an aged row while keeping the fresh one.
  - `npm run test:security` grew from 8 existence checks to 16 assertions that read the schema, and `SCHEMA_VERSION` is now read from `src/lib/version.js` instead of being hardcoded in the output.

### Changed
- **Schema version 2 → 3** in lockstep (`supabase/schema.sql` migration `refused-attempt-audit`, `src/lib/version.js`, the `healthcheck` probe answer, `scripts/security-check.mjs`, `README.md`, `SECURITY.md`, `src/pages/ValidatorLabPage.jsx` — now "all 7 Central tables" plus a refusal-audit security layer — and `SetupPage`'s status line, which no longer hardcodes `Schema v2`).
- **Client sync cadence copy corrected from 15m to 30m** in the Manage Clinic drawer and `entitlements.mjs`: `rajeshlande/myClinic` polls on page open, tab focus, reconnect and `CENTRAL_SYNC_INTERVAL_MS = 30 * 60 * 1000`.

### Notes
- Purely additive: no table, column or RPC signature is dropped, no client contract changes, and a v2 Central project upgrades by re-running `supabase/schema.sql`. Verified against PostgreSQL 17.11 on both a fresh install and an in-place re-run (25/25 database checks, 44/44 unit tests, 26/26 contribution rules).

## [2.2.1] - 2026-11-06

### Fixed
- **Windows Node 22/24 `node --test` Child-Process Crash Fix (`scripts/run-tests.mjs`, `src/lib/pages-client-validator.mjs`, `src/lib/auto-sync-client.mjs`, `package.json`):**
  - Updated `scripts/run-tests.mjs` to run suites in a single test runner process (`--test-isolation=none` on Node >= 22.8 and single-entrypoint dynamic import on Node 20), eliminating Windows V8 `CppgcMixin::~CppgcMixin()` / `ContextifyScript` child-worker teardown crashes (`0xC0000005`, `nodejs/node#65756`) on WebCrypto `CryptoKey` tests (`myclinic-compat.test.mjs`, `pages-client-validator.test.mjs`).
  - Guarded `defaultStorage()` against Node 22+'s experimental `globalThis.localStorage` getter when `window` is absent, and relaxed `package.json` `engines.node` to `>=22.0.0` so Node `v22.18.0` runs without `EBADENGINE` warnings.

## [2.2.0] - 2026-11-06

### Added
- **Real-Time Client Connection & Plan Delivery Telemetry (`supabase/schema.sql`, `src/lib/entitlements.mjs`, `src/pages/EntitlementsPage.jsx`, `src/lib/auto-sync-client.mjs`):**
  - Added additive client sync receipt columns (`last_synced_tier`, `last_synced_status`, `last_synced_expires_at`) on `public.activated_machines` and exposed them on `public.admin_license_view`, plus `trg_licenses_touch_subscription` so Pause/Resume toggles touch `subscriptions.updated_at`.
  - Updated `public.sync_clinic_subscription()` to bypass the 5-minute steady-state heartbeat throttle whenever Central's `tier`, `status`, `expires_at`, or `updated_at` changed since the client's last sync — recording instant delivery receipts for plan upgrades and pause/expiry locks.
  - Added `describeClientSyncState()` and `formatSyncTimestamp()` displaying live badges (`● Plan Synced`, `◐ Update Pending`, `◐ Pause Pending`, `● Pause Synced`, `○ Awaiting Connect`) across Desktop rows, Mobile cards, and the Manage Clinic drawer, paired with a **Live 15s** auto-poll toggle.
  - Enhanced `buildMyClinicAutoSyncKit()` (`src/lib/central-subscription.mjs`) with `synced_at` + `source` metadata and `startMyClinicAutoSync()` (auto-sync on load, tab focus, reconnect, and 15-minute heartbeat).

## [2.1.0] - 2026-11-06

### Changed
- **Hunter Green + Vanilla Cream Editorial Design System (`src/index.css`, `src/lib/theme.mjs`, `src/components/*`, `src/pages/*`):**
  - Implemented the bespoke brand palette & UI Component Mapping Guide:
    - **App Background:** `neutral.100` (`#f7f1e2` Vanilla Cream canvas to reduce eye strain) as default light theme, paired with a harmonious **Hunter Forest Dark Mode** (`brand.800` `#0b140d` / `brand.700` `#16291a`).
    - **Cards & Panels:** `neutral.white` (`#fcfaf5`) with `neutral.300` (`#f2e8cf`) wells/tabs, `neutral.200` (`#f4edd9`) hover states, and `neutral.600`/`700` (`#dfc688` / `#cba442`) dividers & borders.
    - **Primary Buttons & Brand Headers:** `brand.400` (`#386641` Hunter Green) with `#fcfaf5` text and `accent` (`#a7c957` Yellow-Green / `#6a994e` Sage Green) secondary badges, charts, and indicators.
    - **Typography:** `neutral.900` (`#463813`) high-contrast headings and `neutral.800` (`#8d7027`) warm editorial body copy.
    - **System State Palettes:** `success` (`#e1ecda` bg / `#2a3d1f` text / `#6a994e` icon), `error` Blushed Brick (`#f2dadb` bg / `#73292b` text / `#bc4749` destructive accent), `warning` (`#fef3c7` / `#78350f` / `#d97706`), and `info` (`#dbeafe` / `#1e3a8a` / `#2563eb`).

## [2.0.0] - 2026-11-06

### Changed
- **Cloudflare-Inspired Control Plane UI/UX Redesign (`src/index.css`, `src/components/AppShell.jsx`, `src/pages/*`):**
  - Rebuilt the entire design system in Light (`#f6f7f9` / `#ffffff`) and Dark (`#0b0d10` / `#151921`) themes modeled after `cloudflare.com` and `dash.cloudflare.com`, featuring Cloudflare Orange (`#F6821F`), Cobalt Blue (`#0051C3` / `#58A6FF`), architectural hairline grid backgrounds, top orange status stripes, and crisp 1px card geometry.
  - Redesigned navigation (`AppShell.jsx`) with a desktop Cloudflare Zone left rail (`Clinics & Plans`, `Quickstart Guide`, `Client SDK & Obfuscator`, `Sync & Security Lab`, `Settings & Health`), sticky breadcrumb header, mobile slide-over menu, and a fixed 5-tab Mobile Bottom Navigation Bar (`< 1024px`).
  - Redesigned `LoginPage.jsx` with a responsive split architectural showcase + quick Central Supabase setup (`Copy schema.sql (v2)`).
  - Redesigned `EntitlementsPage.jsx` (`#/dashboard`) around Keyless Email & URL Auto-Sync with 4 Cloudflare telemetry cards, scrollable mobile filter chips, zero-horizontal-scroll Mobile Clinic Cards (`< 1024px`), a high-density Desktop Zone Table (`>= 1024px`), and full-screen mobile / slide-over desktop Add Clinic & Live Inspector drawers.
  - Redesigned `NodeAgentPage.jsx` (`#/node-agent`) into a 4-tab **myClinic Client SDK & Scoped Vite Obfuscator** workbench (`.env.production`, `central-subscription.mjs`, `vite.config.js`, and GitHub Pages CI) and `ValidatorLabPage.jsx` (`#/simulator`) into an interactive **Live Sync & Security Lab** for `sync_clinic_subscription` + Central firewall inspection.

## [1.6.0] - 2026-11-06

### Added
- **Keyless Central-to-Client Auto-Sync (`supabase/schema.sql` Schema v2, `src/lib/auto-sync-client.mjs`):**
  - Eliminated the requirement for `LICENSE_KEY`, `LICENSE_PRIVATE_KEY`, `LICENSE_PUBLIC_KEY`, and both Edge Functions (`verify-license` + `sync-clinic-license`).
  - Added dual-identity routing on `public.subscriptions` (`customer_email`, `allowed_origin`, and `lock_first_origin` TOFU pinning) supporting **Email-only**, **Clinic-URL-only**, and **Email + URL** matching, plus `public.update_subscription_routing()` for live editing in the Inspector drawer.
  - Added hardened `public.sync_clinic_subscription(p_email, p_origin, p_device_id)` RPC (`SECURITY DEFINER`, pinned `search_path`, zero dynamic SQL) with PostgREST HTTP `Origin` header spoofing protection (`ORIGIN_MISMATCH`), SHA-256 per-IP rate limiting (`public.sync_rate_limits`: 60 req/min, 15 misses/5min), deterministic `web:<origin>` cloud seat locking, 5-minute heartbeat write throttling, and zero-PII responses.
  - Enabled `FORCE ROW LEVEL SECURITY` across all 6 tables and verified `anon` holds `EXECUTE` on `sync_clinic_subscription` only (0 table/view grants).
  - Updated `#/guide` (`src/pages/GuidePage.jsx`) and `#/dashboard` (`src/pages/EntitlementsPage.jsx`) with 1-click `schema.sql` v2 copy, live Auto-Sync simulator, live Tier/Email/URL editing, and ready-to-paste `myClinic` auto-sync + scoped Vite obfuscator snippets.

## [1.5.3] - 2026-11-06

### Fixed
- **Accurate `Test Step 2` (`verify-license`) Browser Probe (`src/lib/errors.mjs`, `src/pages/GuidePage.jsx`, `supabase/functions/verify-license/index.ts`):**
  - Replaced the `OPTIONS` fetch in **Test Step 2** (which browsers reject with a generic `Failed to fetch` when Supabase's Edge Gateway returns a non-CORS `401` or `404`) with a two-stage `POST` probe (`probeVerifyLicenseEndpoint`) and a safe `{ "healthcheck": true }` branch in `verify-license/index.ts`.
  - **Test Step 2** now pinpoints the exact issue: **(1)** `verify-license` not deployed yet (`EDGE_NOT_DEPLOYED`), **(2)** `"Verify JWT"` accidentally left ON in Supabase Dashboard (`EDGE_JWT_ENABLED`), or **(3)** `LICENSE_PRIVATE_KEY` secret not added yet (`SIGNER_SECRET_MISSING`).

## [1.5.2] - 2026-11-06

### Changed
- **Simplified 2-Side Setup Guide (`src/pages/GuidePage.jsx`, `README.md`):** Replaced the long 5-step multi-tab wall with a calm, side-by-side **Side 1 (`myClinicLicenseAuthority` — 3 steps, done once)** and **Side 2 (`myClinic` — 3 steps, done per clinic)** browser-only workflow with collapsible troubleshooting.

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
