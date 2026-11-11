# Changelog

All notable changes to `myClinicLicenseAuthority` are documented in this file.

## [3.0.0] - 2026-11-11

### Added
- **Enrolliq adaptation — the whole console re-themed to the reference UI's visual language** (tokens sampled pixel-by-pixel from `uploads/image-1.png`): pastel page gradient (#faf4fe -> #fbe6e5 -> #b6d8f1), paper-white floating shell, cyan #c5f1fe nav-active pills, borderless soft status pills, maroon #5d1f24 + amber #eb8114 gauge fills, float shadow 0 24px 60px (slice 1); floating rounded-3xl sidebar with grouped nav + operator card, sticky topbar whose search pill is a REAL global search bound to the registry filter through a tiny pub/sub store (`src/lib/global-search.mjs`), rounded-r-3xl sheet drawer and a floating mobile tab bar (slice 2); registry pill tabs with live counts, toolbar pills, seat bars on border-subtle tracks and free-floating mobile cards (slice 3).
- **Schema v4 — additive migration `activity-log-and-invoices`.** `public.clinic_activity_log`: per-clinic operational timeline, 12 closed event kinds, **append-only by ACL** (authenticated gets SELECT + INSERT only; the Supabase ALTER DEFAULT PRIVILEGES hole is closed explicitly so tampering raises insufficient_privilege instead of silently filtering zero rows). `public.invoices`: closed status set (draft/issued/paid/void), jsonb line items, numeric(12,2) totals, GST-style tax_rate, issued/due/paid stamps. `admin_license_view` gains latest_invoice_number/status/total + open_invoice_count, appended last per the CREATE OR REPLACE VIEW rule. FORCE RLS + admin-only policies on both; anon's single grant (sync_clinic_subscription) unchanged.
- **Activity wiring + UI (slice 5):** `src/lib/activity.mjs` writer (vocabulary lockstepped with the SQL CHECK by test) appended from every mutating handler — onboarded, paused/resumed, tier_changed, renewed, routing_changed, invoice lifecycle — with actor + jsonb payload; Controls / Activity (n) tabs in the clinic dossier; Fleet Activity page (newest 100 events, identity-resolved).
- **Onboarding wizard (slice 6):** Identity -> Plan & Seats -> Term & Notes -> Review & Create -> Handoff checklist, with a cyan/green stepper. Create reuses the EXISTING provisioning RPC and validator (zero new wire shape) and mints the first invoice draft; draft storage degrades with a visible warning on schema-3 Centrals.
- **Invoices + zero-dependency PDF (slice 7):** `src/pages/InvoicesPage.jsx` (Billing nav group) with Issue / Mark paid / Void verbs — each appended to the activity log — and `src/lib/invoice-pdf.mjs`, a hand-rolled PDF 1.4 writer (byte-accurate xref, Helvetica/Helvetica-Bold WinAnsi, multi-page, brand-blue logo tile and total band). Amounts print "INR 14,160.00" because the rupee glyph is not in Latin-1. Seven structural tests parse every xref offset and stream /Length; Playwright captured a real 3,431-byte download.

### Changed
- `SCHEMA_VERSION` 3 -> 4 (version.js); the readiness probe and the auto-sync client's probe default follow the constant. **Tier contract v1 stays published against schema 3** — v4 is purely additive and the sync wire shape is untouched — so `tests/tier-contract.test.mjs` now asserts forward-compatibility (live >= published) instead of equality; the myClinic v1.43.0 byte-pin (`36c6af2b…`) is unaffected.
- Dark theme re-based from Hunter Forest to cool Slate Night with identical semantics; variable NAMES and the semantic class vocabulary (`badge-*`, `console-*`) were preserved so zero JSX colour edits were needed and the status-palette contract test passes by construction.
- Mobile bottom navigation is six columns (Billing group added); the v2 fixed top stripe and grid background are gone.

### Notes
- **The UI Component Mapping Guide is SUPERSEDED** by operator decision (2026-11-11): "remove existing colors and layout and adapt given images them" — the Enrolliq token set in `src/index.css` is now the single source of visual truth, everywhere.
- **schema.sql idempotency fix proven the hard way:** a re-run of the old §3 view statement aborted with "cannot drop columns from view" once §6 had appended invoice columns; §3 now creates the base view only when absent and §6 owns the extended definition. Blank apply AND re-apply verified on PostgreSQL 17.
- Gates: 76/76 unit tests, 26/26 contribution rules, clean build + check:pages, security-check 20/20; PG 17 harness 34/34 PASS (§1-§8 incl. new §8: anon denial, admin append + invoice lifecycle + view columns, append-only UPDATE/DELETE denial, non-admin invisibility + WITH CHECK refusal); zero horizontal overflow at 375x812 and 1440x900 on every route; wizard walkthrough and PDF download browser-verified.

## [2.4.0] - 2026-11-10

### Added
- **`contract/tier-contract.json` — one versioned source of the cross-repo vocabulary (Level 3 of the SOLID remediation plan).** Contract v1, published against schema 3, holds: the five tier ids with their myClinic plan, seat limits, label and hint; the fallback the SQL `case` falls through to; the validator's no-lease / local-mode defaults; and all ten refusal codes `sync_clinic_subscription()` can answer with, each with its operator label and fix hint. Generated verbatim from the shipped v2.3.1 maps and published with each release plus its sha256 (`36c6af2b…` for v1).
- **`src/lib/tier-contract.mjs`** derives `MYCLINIC_TIER_ENTITLEMENTS`, `TIER_CATALOG`, `VALID_TIERS`, `SYNC_REFUSAL_HINTS` and `VALIDATOR_DEFAULTS` from the contract as deep-frozen views; `entitlements.mjs` re-exports them so every import site is untouched. The dead Tailwind `badgeClass` field of the old catalog is gone.
- **`tests/tier-contract.test.mjs`** drifts in three directions: derived views deep-equal v2.3.1 mirrors; `supabase/schema.sql`'s `case v_sub.tier` is parsed branch-by-branch (explicit branches *and* the `else` fallback) and compared per tier against the contract; and a definition-site scan over `git ls-files` fails if a seat limit, tier→plan literal or refusal-code object reappears anywhere except the contract and the test mirrors.
- **Client companion** (workspace deliverables, not Central code): `myclinic-tier-contract-v1.json` + `.sha256`, and `CLIENT-CONTRACT-PATCH.md` — the agent-ready patch that vendors the contract into `rajeshlande/myClinic`, derives `CENTRAL_TIER_TO_PLAN` from it, and adds the client-side drift test.

### Changed
- **Two more duplicate definition sites found and collapsed.** The definition-site scan immediately caught what the original SOLID audit missed: five identical no-lease `{tier:'solo', plan:'solo'}` triplets in `src/lib/auto-sync-client.mjs` and two degraded-license `plan:'solo'` literals in `src/lib/pages-client-validator.mjs`. Both now read `VALIDATOR_DEFAULTS` from the contract.
- **`tests/myclinic-compat.test.mjs`** reads the contract and pins the myClinic **v1.35.6** wire mirrors (`plans.mjs:115`, `central-sync.mjs:96-120`): tier→plan and seats parity, code coverage, and the two gaps the companion patch closes — v1.35.6 can neither decode nor explain `SUBSCRIPTION_INACTIVE` (`CENTRAL_CODES` lacks the code entirely, not just its note).

### Notes
- No wire, schema, RPC or rendering change: the browser fingerprint at 375×812 and 1440×900 is identical to v2.3.1 (0 diffs), and the contract's values are byte-identical to the v2.3.1 maps by construction. `SCHEMA_VERSION` stays 3; `contract_version` is the new axis for vocabulary changes. Gates: 54/54 unit tests, 26/26 contribution rules, clean build + `check:pages`, PostgreSQL suite re-run.

## [2.3.1] - 2026-11-10

### Changed
- **The 2,026-line `EntitlementsPage.jsx` god component is split (Level 2 of the SOLID remediation plan).** 548 lines of render logic moved into five focused modules under a new `src/components/entitlements/` folder; the page keeps the record, the filters, the CSV export and the drawers, and is now 1,478 lines:
  - `SyncStateBadge.jsx` — the Client Sync pill, one source for both the 375px card and the 1440px row (`card` / `row` variants keep the exact shipped dot gaps).
  - `RefusalEvidenceCard.jsx` — the schema-v3 evidence: error card with the masked claim the client sent, the pinned values and the fix; neutral 24h well otherwise.
  - `FleetMetricTiles.jsx` — the 4-metric zone strip; the three filter tiles stay buttons, the sync gauge stays read-only, through one internal `MetricTile`.
  - `ClinicCardMobile.jsx` / `ClinicRowDesktop.jsx` — the two registry renderings; each derives its own standing / identity / sync verdict / seat spec from the pure lib layer and takes exactly three verbs (inspect, client SDK, kill-switch).
- **Palette policy left the page.** `src/lib/status-palette.mjs` now owns `buildSyncPillStyle()` / `buildStandingPillStyle()` behind a closed `STATUS_BADGE_CLASSES` vocabulary, so the UI Component Mapping Guide is written down once and a status can never invent a surface class.

### Added
- `tests/status-palette.test.mjs` (5 suites): exact tone→surface mapping, neutral fallback for any unrecognised tone, the closed-vocabulary fuzz, standing tones, and a contract test that every surface class and every `var(--token)` the palettes reference is actually declared in `src/index.css`.
- **A deterministic browser gate for refactors**: a scratch harness mounts the real page against a mock Supabase client (fixed-offset fixtures so every relative label is byte-stable) and a fingerprint of the painted DOM — tags, classes, inline styles, resolved computed colours, integer geometry, overflow — is captured before and after each slice at 375×812 and 1440×900, list and drawer. All four slices committed with **0 fingerprint diffs and pixel-identical screenshots**; the gate caught one real `tabular-nums` class drift during slice 3 and blocked the commit until fixed. Harness noise floor measured on identical code: ≤32 glyph-edge pixels.

### Notes
- Pure refactor: no behaviour, markup, palette, layout, schema, RPC or client-contract change. `SCHEMA_VERSION` stays 3. Proven by the fingerprint gate (0 diffs across all four slices), 49/49 unit tests (44 + 5 new), 26/26 contribution rules, clean build + `check:pages`.

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
