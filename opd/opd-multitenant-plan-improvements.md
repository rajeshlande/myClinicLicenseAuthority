# Multi-Tenant OPD SaaS — Plan Improvements (post-repo-scan, Revision 2)

Companion to `opd-multitenant-implementation-plan.md` (Revision 1).
Scan targets: rajeshlande/myClinic and rajeshlande/myClinicLicenseAuthority.
Goal of these improvements: make the plan more secure, faster, and easier to connect / set up by reusing what both repos already ship instead of building it again.

No repository was modified. Clones were made under /tmp for reading only; myclinic remains clean at b1e174e. This is a planning document, not an implementation.

## 1. What the scan found

### 1.1 Remote state (observed via git ls-remote + GitHub API)

| Repo | main HEAD | Latest tags | pushed_at |
|---|---|---|---|
| myClinic | b1e174ee00abc6b533e364fa578b5b017802c2d2 | v1.43.0 → b1e174ee0, v1.42.0 → ff61d5c05 | 2026-11-11T11:06:50Z |
| myClinicLicenseAuthority | da36c7be4938acee46a6ff63ec81ac5ee63d0af2 | v3.1.0, v3.0.0, v2.4.0 → 46d90cf76 | 2026-11-11T18:00:24Z |

Two facts that invalidate assumptions in Revision 1:

- **myClinic v1.43.0 is now pushed and tagged on main.** The Revision 1 note "no push occurred" is stale; the live baseline is `b1e174e`.
- Central has advanced from v2.4.0 to v3.1.0. Revision 1 was written against v2.4.0. Between them, v3.0.0 ("Enrolliq adaptation complete", schema v4) and v3.1.0 (mobile nav, operator profile, fetch coalescing, cache-first assets) added 35 changed files / +4,108 −900. Central is no longer just a licence RPC — it is now a full React admin console.

### 1.2 myClinic (v1.43.0, local + remote)

285 tracked files · 119 src/ files · 46 test files / 743 tests · SCHEMA_VERSION=21 · React 19 / Vite 8 / HashRouter / react-router 8 / @supabase/supabase-js ^2.118.0.

| Area | What already exists and should be reused |
|---|---|
| `src/lib/supabase.js` | One module-level client from VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY; rejects service_role\|sb_secret; PKCE |
| `src/lib/central-sync.mjs` | Anon-only raw fetch to Central sync_clinic_subscription; centralHeaders() deliberately sends only the Central anon key — the comment explicitly says a session token is "kept out of the headers on purpose"; sealed 7-day offline lease; zero-side-effect CENTRAL_PROBE_BODY = { p_email:'', p_origin:'', p_device_id:'healthcheck' }; blockedCentralKey() |
| `src/lib/health.mjs` + `src/pages/Setup.jsx` | configChecks() / restCheck() / schemaCheck() / readiness() — a working connectivity self-test screen at #/setup that probes REST and app_schema_version |
| `src/lib/offline*.js` | Offline-first cache + outbox in localStorage, keyed by userId + clinicId; clearAllCache() |
| `vite.config.js` | Relative base:'./', manualChunks splitting @supabase and react, lazy routes, scoped obfuscation of only central-sync.mjs + license.mjs |
| `public/sw.js` + `public/_headers` | Cache-first hashed assets; never caches REST/Auth/Edge; /assets/* immutable 1 year; nosniff, Referrer-Policy, X-Frame-Options: DENY, Permissions-Policy |
| `supabase/schema.sql` | One idempotent additive file, §0–§21, app_meta + schema_migrations registry, app_schema_version(), full RLS role matrix, clinic_slug(), create_clinic(), accept_invite(), issue_token(), PG17 schema-tests.sql |
| `.github/workflows/pages.yml` | Forwards 4 VITE_* values; fails the build on placeholder URLs and sb_secret\|service_role; verifies the Central host actually reached the bundle |
| `scripts/` | check-pages.mjs, security-check.mjs, check-contributing.mjs, run-tests.mjs |
| `docs/SECURITY.md` | Records finding #2: whole-clinic PHI snapshot in localStorage with no expiry/scope — this gets worse with N tenants |
| `index.html` | Has an inline `<style>` but no CSP meta |

### 1.3 myClinicLicenseAuthority (v3.1.0, schema v4)

APP_VERSION=3.1.0, SCHEMA_VERSION=4, 24 test files / 84 tests (per CHANGELOG), 26/26 contributing rules, security 20/20, React 19 + Vite 8 + Tailwind 4, @supabase/supabase-js ^2.119.0.

| Area | What already exists and should be reused |
|---|---|
| This IS App 1 | A complete hash-routed admin SPA: EntitlementsPage, InvoicesPage, ActivityPage, SetupPage, GuidePage, ValidatorLabPage, NodeAgentPage, ProfilePage |
| `src/components/entitlements/OnboardingWizard.jsx` | 5-step wizard (Identity → Plan & Seats → Term & Notes → Review & Create → Handoff checklist) reusing the existing provisioning RPC, plus first invoice draft |
| `src/lib/auth.mjs` + `is_license_admin()` | Admin gate uses immutable auth.jwt() -> 'app_metadata' ->> 'role' = 'admin'; explicitly ignores mutable user_metadata. Signups recommended OFF |
| `supabase/schema.sql` v4 | subscriptions (email + allowed_origin + tier + seats + expiry), licenses, activated_machines, sync_rate_limits (hashed IP, 60/min + 15 misses/5 min), sync_attempts (append-only refusal audit), clinic_activity_log (append-only by ACL), invoices, admin_license_view, app_meta + schema_migrations |
| Zero-trust RLS §5 | anon has ZERO table/view access and exactly ONE executable RPC — sync_clinic_subscription(text,text,text). FORCE RLS; record_sync_attempt() has no grant to anon/authenticated; refusal evidence cannot be erased |
| `sync_clinic_subscription()` | Cross-checks the unforgeable PostgREST Origin header against the claim, rate-limits, writes refusal evidence, returns only minimal capability JSON (allowed, tier, plan, doctors, frontdesk, branches, expires_at, grace_until, schema_version) — zero PII |
| `src/lib/supabase.js` | resolveAuthorityBackend(), saveRuntimeSupabaseConfig() (connect without a rebuild, localStorage runtime override), getOrCreateCloudClient() signature-cached client (url::anonKey) |
| `src/lib/health.mjs` | inspectSupabaseConfig() rejects placeholder hosts, sb_secret_, service_role, and decodes the JWT role claim to catch a service-role key |
| `src/lib/auto-sync-client.mjs` | assertPublishableAnonKey(); sealed offline lease; explicit invariant: never forwards the clinic's own Supabase Auth JWT across projects |
| `src/pages/GuidePage.jsx` + auto-sync-client.mjs | "Copy .env.production", "Copy central-subscription.mjs", "Copy Vite Obfuscator", "Copy Full schema.sql", "Copy Admin Grant SQL", plus a live probeCentralAutoSync() check |
| `src/pages/SetupPage.jsx` | Runtime connection form + 3-point health check + "Copy diagnostics" report |
| `src/lib/coalesce.mjs` + reads.mjs (v3.1.0) | In-flight read coalescing: concurrent callers of readAllLicenses() / readSubscriptionsLite() share ONE PostgREST round trip, key dropped on settle → no TTL, no stale reads |
| `public/sw.js` v8 | Hashed /assets/ cache-first; shell/navigations network-first; zero-trust exclusion of REST/Auth/Edge untouched |
| RS256 stack | crypto-rs256.mjs (signCapabilityJwt / verifyCapabilityJwt), verify-license Edge Function holding LICENSE_PRIVATE_KEY (PKCS#8), server/license-middleware.mjs + node-host.mjs holding only LICENSE_PUBLIC_KEY (SPKI) and serving MYCLINIC_DIST_DIR with HTTP 402 gating. EXPECTED_TOKEN_ISSUER='myclinic-license-authority', TOKEN_TTL_SECONDS = 7 days |
| `contract/tier-contract.json` | Still 3,947 bytes, sha256 36c6af2b… — byte-identical to the copy vendored in myClinic v1.43.0 |
| `tests/myclinic-compat.test.mjs` | Now pins myClinic v1.43.0 (b1e174ee) and states both SUBSCRIPTION_INACTIVE gaps are closed |

✅ The outstanding v1.43.0 operator note is already resolved upstream. Revision 1 said "refresh Central v2.4.0 tests/myclinic-compat.test.mjs v1.35.6 mirror/pins after ship". Central v3.x did exactly that. Remove that note from the plan.

### 1.4 Documentation drift found (hurts "easy to connect")

| File | Says | Should say |
|---|---|---|
| Central README.md line 1 | v2.3.0 · Schema v3 | v3.1.0 · Schema v4 |
| Central README.md body | "zero Edge Functions, zero RSA keys" | supabase/functions/verify-license/index.ts exists and uses RS256 |
| Central GuidePage.jsx button | "Copy Full schema.sql (v2)" | v4 |
| myClinic docs/SUPABASE-SETUP.md | "Schema version required v2", "App version 1.2.1" | schema 21 / 1.43.0 |
| myClinic docs/ARCHITECTURE.md | "Measured at v1.26.0, schema 18", "529 tests" | 1.43.0 / schema 21 / 743 tests |

## 2. Corrections to Revision 1

| # | Plan R1 section | Correction from the scan | Impact |
|---|---|---|---|
| X1 | §1, §7 — build a new App 1 and a new Master Admin Supabase | App 1 already exists: Central v3.1.0 IS the admin portal, with login, onboarding wizard, invoices, activity, guide, setup diagnostics and audit. Extend it; do not build a new frontend. | Deletes Phase P2 almost entirely; removes a whole new project's auth/RLS/audit |
| X2 | §0 A2 / §16 — Central v2.4.0 with stale v1.35.6 compat pins | Central is v3.1.0 / schema v4 and already pins v1.43.0. Contract sha unchanged. | Removes the operator to-do; adds a schema-v4 compatibility requirement |
| X3 | §4 — new vault schema + vault.platform_admins | Central AGENTS.md rule #5: "Single SQL Source of Truth — never create split migration fragments". Extend public.subscriptions additively (schema v5) and reuse is_license_admin(); drop the new platform_admins table unless you need a multi-admin team. | Smaller surface, inherits existing RLS/rate-limits/audit/activity/invoices |
| X4 | §5 — public_workspace_by_slug() granted to anon | Violates Central's core invariant: anon may execute exactly ONE RPC. Fold the booking pointer into sync_clinic_subscription's response, or make discovery authenticated-only. | Keeps the zero-trust posture and the single refusal-audit trail |
| X5 | §2 D1 — send a Master JWT to tenant projects | Central is admin-only (signups OFF) and its invariant forbids forwarding a clinic JWT across projects. Staff have no Central Auth account today. → needs the 3-plane/2-plane decision in §3. | Biggest open decision |
| X6 | §7 / §13 — new VITE_MASTER_SUPABASE_* env vars | Both repos already have a working VITE_* + build-guard pattern. Minimal set is two values per app, with tenant URL/key arriving at runtime. | Reduces setup from 4 vars + N per-clinic vars to 2 |
| X7 | §13 — one dist/ with / + /admin/ | Both repos ship public/sw.js. Central registers ./sw.js with default scope /; myClinic registers ${base}sw.js with scope: base. On one origin these two service workers will fight. Central's SW must be scoped to /admin/ (or disabled). | Fixes a real deployment bug R1 missed |
| X8 | §9.1 — mountTenant() creates a fresh client each time | Central already has the correct pattern: getOrCreateCloudClient(url, anonKey) signature cache + inspectSupabaseConfig() validation. Reuse it verbatim. | Faster re-mount, fewer GoTrue instances, validated inputs |
| X9 | §3 C1 — "anon key is public" hardening | Both repos already enforce it (health.mjs, central-sync.mjs, pages.yml, SQL CHECK). Reuse; don't reinvent. | Less code |
| X10 | §11 P6 — new ratchets/tests | Both repos already have check:pages, security-check, check-contributing, PG17 schema-tests.sql, checksum-pin tests and mutation-proved drift ratchets. Extend these rather than building new scripts. | Reuses proven gates |
| X11 | §3 C2 / §9 — tenant RLS | A ready-made RS256 capability-token stack exists (crypto-rs256.mjs, verify-license, SPKI validator). Use it for tenant auth instead of a shared HS256 secret. | Strongest security + per-workspace claims |
| X12 | §10 — vite.config.js unchanged | Do not add tenant-client.js to OBFUSCATED_MODULES: v1.43.0 already hit javascript-obfuscator Unexpected token (56:52) on modern syntax (JSON import attributes). Keep the tenant client unobfuscated and debuggable. | Avoids a known build failure |

## 3. Revised architecture and decisions

### 3.1 Recommended topology — reuse the two existing projects

| Plane | Existing asset | Role | JWT exposure |
|---|---|---|---|
| I · Master / Directory | Central myClinicLicenseAuthority v3.1.0 Supabase | App 1 (already built) + Stage-1 login + workspaces / workspace_members + licence verdict + RS256 signer | Its own users only; never receives a clinic JWT |
| II · Tenant DBs | New Supabase project per clinic | Patients, appointments, consultations, prescriptions, invoices; tenant_members allowlist; strict RLS | Trusts a short-lived scoped token from Plane I |
| III · Static hosting | One GitHub Pages site | / = App 2 (existing myClinic SPA), /admin/ = App 1 (Central console build) | — |

**Decision D6 (new, blocking): where do doctor/staff accounts live?**

- **D6-A (recommended, matches the brief's "one Master"):** enable invite-only staff accounts in Central Auth with immutable app_metadata.role = 'clinic_user' (keep public signup OFF; use auth.admin.inviteUserByEmail). All existing admin policies already gate on is_license_admin(), so staff automatically see zero subscription/invoice/activity rows. Add workspaces + workspace_members with auth.uid() RLS — exactly the brief's design. One auth system, two env values, fewest projects.
- **D6-B (conservative):** keep Central admin-only; retain the existing myClinic Supabase purely as an Identity + Directory project (auth.users, profiles, staff, invites already exist, so auth.uid() stays stable for every current user). Central remains a pure anon-only control plane. Safer for Central's posture, but adds a third project and a server-to-server onboarding sync. Deviates from the brief's two-tier picture.

**Decision D1′ (replaces R1 D1): tenant authentication via a short-lived RS256 capability token.**

Reuse src/lib/crypto-rs256.mjs / supabase/functions/verify-license/index.ts to mint:

```jsonc
{
  "iss": "myclinic-license-authority",
  "sub": "<staff auth.users UUID>",
  "aud": "authenticated",
  "role": "authenticated",
  "workspace_id": "<uuid>",
  "tenant_slug": "sunrise-opd",
  "tenant_schema_version": 21,
  "tier": "growth",
  "kid": "<signing key id>",          // ← currently ABSENT, must be added
  "iat": 1730000000,
  "exp": 1730000900                  // ← 5–15 min, NOT the existing 7-day TTL
}
```

Concrete changes required in Central (grounded in the scan):

- signRs256Jwt() currently emits header `{ alg: "RS256", typ: "JWT" }` — add `kid`.
- TOKEN_TTL_SECONDS = 60*60*24*7 in entitlements.mjs is for the offline licence lease — do not change it. Add a separate TENANT_TOKEN_TTL_SECONDS = 900.
- Publish the SPKI public key as JWKS (/auth/v1/.well-known/jwks.json equivalent) and configure each tenant project's third-party-auth integration. Third-party auth requires asymmetric tokens with a `kid` header and a `role: authenticated` claim; a Supabase maintainer confirms a JWT accepted across projects still resolves auth.uid() in RLS.
- Add `aud`, `role`, `workspace_id`, `tenant_slug`, `tenant_schema_version` to the payload (today: iss, sub, license_key, tier, machine_fingerprint, allowed_origin, max_machines, subscription_expires_at, iat, exp).
- Tenant RLS pins `auth.jwt()->>'tenant_slug' = '{{SLUG}}'` and `public.is_tenant_member()` — defence in depth.
- Client passes it with a live accessToken callback (never a snapshot), per R1 §3-C2 / §9.1.

Why this beats R1's options: no shared symmetric HS256 secret, no cross-project forwarding of a staff session JWT (preserves Central's invariant), per-workspace claim pinning closes R1's cross-tenant residual risk, short TTL + is_active = fast revocation, and it reuses an already-tested signer/verifier. Fallback: direct Central access token + tenant JWKS trust + the tenant_members allowlist, if minting a second token is unacceptable.

**Decision D2′ (hosting):** keep R1's single Pages site / + /admin/, but add the service-worker scoping fix (X7) and note that GitHub Pages supports one custom domain per site with subdirectories as the supported pattern. Also: Central's index.html has a CSP with connect-src 'self' https://*.supabase.co, which already permits dynamic tenant hosts.

**Decision D4′ (public booking):** fold the pointer into sync_clinic_subscription (X4) rather than adding a second anon RPC.

## 4. Improvements — SECURE

| # | Improvement | Reuse / change | Why it is more secure |
|---|---|---|---|
| S1 | Do not create a third "Master Admin Supabase". Make Central the Master and App 1 its existing console. | Extend myClinicLicenseAuthority; delete R1 §7's new frontend tree and §4's new project. | One fewer trust boundary, one fewer auth database, one fewer set of keys. Inherits 20/20 security checks, 84 tests, PG17 harness. |
| S2 | Extend public.subscriptions additively (schema v5) instead of a new vault schema: slug (unique), target_supabase_url, target_anon_key, is_active, tenant_schema_version, workspace_id. Add CHECK (target_anon_key !~* 'service_role\|sb_secret') and a unique index on lower(slug). | Central schema.sql §2 + app_meta/schema_migrations; AGENTS.md rule #5. | Keeps FORCE RLS, admin-only policies, rate limiter, append-only clinic_activity_log, invoices, and the single SQL source of truth. No new REVOKE/GRANT matrix to get wrong. |
| S3 | Preserve "anon = exactly ONE RPC". Merge licence verdict + workspace list + booking pointer into sync_clinic_subscription's JSON response. Keep discovery for authenticated staff on a separate authenticated-only RPC with workspace_members RLS. | Central schema.sql §5, record_sync_attempt(), consume_sync_rate_limit(). | No new anon attack surface; every lookup stays rate-limited, Origin-checked and audited with hashed-IP / masked-email evidence. |
| S4 | D1′ RS256 scoped tenant token (§3.1). | crypto-rs256.mjs, verify-license, license-middleware.mjs. | Asymmetric, short-lived, per-workspace claims, no HS256 shared secret, no staff JWT forwarded to Central. |
| S5 | Keep tenant_members + is_tenant_member() on every tenant (R1 §8 is correct — retain it). | New tenant tenant-schema.sql §22, derived from myClinic schema.sql RLS helpers is_clinic_staff() / clinic_role() / staff_guard(). | Even with a scoped token, a per-tenant allowlist prevents a token valid on one project from reading another. |
| S6 | Validate every runtime tenant credential with the existing inspectSupabaseConfig() / blockedCentralKey() logic before createClient. Extend pages.yml's sb_secret\|service_role scan to also assert no privileged column name appears in the discovery RPC's SELECT list. | Central src/lib/health.mjs, myClinic central-sync.mjs:356, .github/workflows/pages.yml:143. | Blocks placeholder URLs, secret keys, and service-role JWTs at boot, on rotation, and in CI. |
| S7 | Reuse is_license_admin() (immutable app_metadata.role) for App 1 and add is_clinic_user() for staff. | Central schema.sql:142, src/lib/auth.mjs, AGENTS.md rule #4. | No mutable user_metadata, no new admin table to protect. |
| S8 | Add the byte-pinned contract pattern to the new directory. Publish contract/workspace-directory-contract.json with a sha256 pin, derive all workspace/role/tenant-schema constants from it, and add drift ratchets on both repos plus the tenant schema. Leave tier-contract.json untouched (sha 36c6af2b…, 3,947 bytes). | myClinic contract/tier-contract.json + tests/tier-contract.test.mjs + tests/myclinic-compat.test.mjs; Central src/lib/tier-contract.mjs + its definition-site scan. | The exact mechanism that already proved itself with mutation testing; prevents three-way vocabulary drift. |
| S9 | Fix cross-app session bleed (R1 C5) plus scope the two service workers. Distinct storageKey per app; Central SW registered at /admin/sw.js with scope:'/admin/' (or disabled). | myClinic src/lib/pwa.jsx:55 already passes { scope: base } — mirror it. | Prevents a / SW from controlling /admin/ and vice versa, and prevents cached admin HTML from being served to clinic users. |
| S10 | Add a CSP to myClinic index.html modelled on Central's, allowing connect-src 'self' https://*.supabase.co and style-src 'self' 'unsafe-inline' (myClinic has one inline <style>). Add Central's missing public/_headers security headers. | Central index.html; myClinic public/_headers. | Closes a real gap found by the scan; still permits dynamic tenant hosts. |
| S11 | Keep the sealed lease and offline grace exactly as-is; do not widen it to hold tenant connection secrets. | central-sync.mjs seal (origin + email + deviceId), license.mjs canWrite(). | Cached credentials stay non-authoritative (R1 C6). |

## 5. Improvements — FAST / PERFORM

| # | Improvement | Reuse / change | Measured effect |
|---|---|---|---|
| F1 | Collapse Stage 2 + Stage 2.5 into ONE round trip. Return { workspaces[], verdict, booking_pointer, schema_version } from the single sync_clinic_subscription call instead of my_workspaces() → licence RPC → mount. | Central sync_clinic_subscription() already returns tier/seats/expiry/schema_version in one JSON body. | Removes 1–2 sequential PostgREST calls from every boot — the single biggest cold-start win. |
| F2 | Copy coalesce.mjs / reads.mjs into App 2 for my_workspaces(), tenant schema probe and licence state. | Central v3.1.0 src/lib/coalesce.mjs + reads.mjs (5 + 3 tests). | Concurrent mounts share ONE read; key drops on settle → no TTL, no stale reads, no invalidation contract. |
| F3 | Reuse getOrCreateCloudClient() signature caching (url::anonKey) inside mountTenant(), disposing on logout/slug change. | Central src/lib/supabase.js. | Avoids recreating a GoTrue client and re-doing auth init on re-render/remount. |
| F4 | Keep all existing perf assets and extend them to /admin/: manualChunks (@supabase, react), lazy routes, public/sw.js cache-first hashed assets, public/_headers /assets/* immutable, 404.html handling. | Both vite.config.js, both public/sw.js, myClinic public/_headers, scripts/check-pages.mjs. | Zero chunk re-downloads after first visit; Central v3.1.0 measured this exact fix. |
| F5 | Warm the tenant connection in parallel with React mount: fire a lightweight GET /auth/v1/health or schema_meta.version probe while the selector renders, not after. Add <link rel="preconnect"> dynamically once the slug is known. | Central's zero-side-effect healthcheck probe pattern (CENTRAL_PROBE_BODY). | Hides DNS/TCP/TLS setup behind paint; no side effects, no seat consumption. |
| F6 | Cache schema_meta.version per slug for the tab lifetime; cache the coalesced discovery result only in-flight, never with a TTL (R1 C6 stays true). | app_schema_version() pattern in both repos. | One cheap single-row query instead of a repeated probe. |
| F7 | Fix the PHI-cache problem before multiplying it. docs/SECURITY.md finding #2 (whole clinic snapshot in localStorage, no expiry) becomes N snapshots with N tenants. Move the per-slug clinical cache to IndexedDB (or cap + TTL), keep localStorage for tiny non-clinical hints only, and namespace by slug (R1 C7). Never cache REST/Auth/Edge in the SW — both repos already enforce this. | src/lib/offline*.js, offline-cache.js, both public/sw.js. | Less main-thread JSON parse, bounded storage, and a smaller PHI footprint on shared reception machines. |
| F8 | Keep tenant-client.js unobfuscated (X12). | vite.config.js OBFUSCATED_MODULES. | Avoids the known javascript-obfuscator modern-syntax build failure and keeps the hot connection path fast/debuggable. |
| F9 | Optional on-prem fast path: Central's server/node-host.mjs already serves MYCLINIC_DIST_DIR locally and enforces HTTP 402 with a cached licence. A clinic can serve the SPA from its LAN while the tenant DB stays in the cloud. | server/node-host.mjs:146, license-middleware.mjs. | Lowest latency for reception desks with poor internet; no change to the SPA. |

## 6. Improvements — EASY TO CONNECT / SETUP

| # | Improvement | Reuse / change | Setup win |
|---|---|---|---|
| E1 | Two env values per app, zero per-clinic values. App 2 needs only VITE_CENTRAL_SUPABASE_URL + VITE_CENTRAL_SUPABASE_ANON_KEY; delete VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (tenant URL/key arrive from the directory at runtime). App 1 keeps its existing two. | auto-sync-client.mjs:545 clientKit.envVars already generates exactly those two lines; pages.yml already forwards + validates them. | Halves the config; directly satisfies checklist item 2 with an existing guard. |
| E2 | Connect the console without a rebuild. Reuse saveRuntimeSupabaseConfig() / resolveAuthorityBackend() / inspectSupabaseConfig() for both apps. | Central src/lib/supabase.js, src/lib/health.mjs, SetupPage.jsx. | Paste URL + publishable key → validated and connected in seconds; no CI run. |
| E3 | Extend the existing Onboarding Wizard with a "Connection" step (clinic name, slug, tenant URL, publishable anon key, owner email/user id) and a live 5-point check: URL shape → key is publishable → tenant REST reachable → schema_meta.version matches → anon clinical read is denied. Reuse its Handoff checklist, first invoice draft and activity log. | OnboardingWizard.jsx, create_subscription_with_license(), Setup.jsx configChecks/restCheck/schemaCheck/readiness, probeCentralAutoSync(). | One wizard already exists; adding a step beats building a new admin app. Onboarding becomes a guided, verified flow. |
| E4 | Add one "Copy tenant connection kit" button to GuidePage.jsx instead of writing new docs; it already has copy buttons and a live RPC probe. | GuidePage.jsx:467-530, auto-sync-client.mjs client kit. | Copy → paste → done; no new documentation surface. |
| E5 | One #/setup diagnostics screen in App 2 showing: Master reachable · workspaces found · tenant reachable · anon RLS denies · schema version · licence verdict · active slug. Reuse readiness() states (pass/warn/fail/skip) and the "Copy diagnostics" pattern. | myClinic Setup.jsx, health.mjs; Central SetupPage.jsx:191. | A clinic can self-diagnose a bad connection in under a minute without contacting the operator. |
| E6 | Keep one idempotent SQL file per project. Central supabase/schema.sql (v5 additive), myClinic supabase/schema.sql (identity-only slim-down), and a new supabase/tenant/tenant-schema.sql templated with {{SLUG}}. Bump SCHEMA_VERSION with a schema_migrations row; reuse check-contributing's version-lockstep ratchet. | Both app_meta/schema_migrations, docs/SCHEMA-APPLY-SAFETY.md, AGENTS.md rule #5. | Paste one file, run once, safe to re-run — the pattern both repos already document. |
| E7 | Fix the stale docs in §1.4 and add a check:docs-version ratchet that fails when README/Guide/ARCHITECTURE version strings disagree with APP_VERSION / SCHEMA_VERSION / test counts. | check-contributing.mjs existing ratchet style. | Setup guides stop lying; the drift cannot silently return. |
| E8 | Reuse the PG17 schema-tests.sql harness for Master, tenant and cross-repo contract parity; keep npm run verify, check:pages, test:security, check:contributing and add only the three checklist ratchets from R1 §12.1. | Both supabase/schema-tests.sql, both scripts/. | Proven gates, no new CI framework. |

## 7. Revised phase plan (delta from R1 §11)

| Phase | R1 | R2 change |
|---|---|---|
| P0 | decisions | Add D6 (staff auth home) and D1′ (RS256/JWKS: verify Central issues asymmetric tokens, add kid, publish JWKS, confirm tenant third-party-auth support on your plan). Confirm accessToken in pinned ^2.118.0 / ^2.119.0. |
| P1 | new Master schema + Edge Functions | Extend Central subscriptions to schema v5 additively; reuse is_license_admin(), sync_rate_limits, sync_attempts, clinic_activity_log; extend sync_clinic_subscription response (F1/S3); add workspaces/workspace_members with auth.uid() RLS. Publish contract/workspace-directory-contract.json + sha pin. |
| P2 | build App 1 | Mostly deleted. Extend OnboardingWizard (E3), GuidePage (E4), SetupPage (E2/E5), fix docs (E7). |
| P3 | tenant template | Same as R1 §8, derived from myClinic schema.sql RLS helpers; add tenant_slug pin if D1′ |
| P4 | dual-client engine | Same, but use getOrCreateCloudClient() signature cache (F3), coalesce() (F2), single boot RPC (F1), inspectSupabaseConfig() validation (S6), SW scoping (S9/X7) |
| P5 | migrate call sites | Same, plus IndexedDB/slug-scoped offline cache (F7), CSP (S10), delete the two obsolete VITE_* vars (E1) |
| P6 | tests | Extend existing gates; add cross-repo directory-contract drift ratchets (S8), two-service-worker test, two-tab isolation test, mutation tests |
| P7 | CI/CD | Two builds → one dist/; scope Central SW to /admin/; CNAME; extend _headers to /admin/assets/*; keep the sb_secret guard for both bundles |
| P8 | pilot cutover | Same; rollback baseline is now the pushed v1.43.0 at b1e174e |

Net effect: P2 shrinks dramatically, P1/P4/P6 get simpler by reuse, P5 grows slightly for the offline-cache and CSP fixes.

## 8. Revised verification checklist

Carry over all of R1 §12, and add:

- [ ] sync_clinic_subscription remains the only RPC granted to anon (schema-tests.sql assertion)
- [ ] subscriptions v5 is additive: blank apply and re-apply on PG17 both pass (Central v3.0.0 already proved the re-apply trap)
- [ ] contract/tier-contract.json sha is still 36c6af2b… / 3,947 bytes in both repos; new directory contract has its own pin and mutation-proved ratchet
- [ ] Tenant token carries kid, role, aud, tenant_slug, workspace_id, exp ≤ 900 s; 7-day offline lease TTL unchanged
- [ ] Two service workers on one origin: /sw.js scope /, /admin/sw.js scope /admin/; neither caches REST/Auth/Edge
- [ ] App 2 has 2 VITE_* values; no VITE_SUPABASE_*; no per-clinic URL/key in src/, .env.example, scripts/ or dist/assets/
- [ ] inspectSupabaseConfig() rejects a rotated-in sb_secret_ / service_role JWT at runtime
- [ ] Two concurrent Stage-2 reads produce one network request (coalesce test)
- [ ] #/setup reports pass/warn/fail for all six connection dimensions
- [ ] README / Guide / ARCHITECTURE version strings match APP_VERSION / SCHEMA_VERSION / test counts
- [ ] myClinic index.html CSP present and permits https://*.supabase.co

## 9. New / revised open questions

1. D6-A or D6-B? Enable invite-only staff accounts in Central Auth, or keep a separate Identity project? (Recommend A for "easy connect" and exact brief compliance; B for preserving Central's current admin-only posture.)
2. D1′ feasibility: does your Central Supabase plan support asymmetric signing keys and third-party Auth/JWKS on tenant projects? If no, fall back to the shared-HS256-secret option from R1 §2-D1.
3. May we change verify-license's JWT header (kid) and add a second short-TTL token, leaving the 7-day offline lease untouched?
4. Should the directory contract be a new workspace-directory-contract.json, or contract v2 of tier-contract.json? (Recommend new file — keeps the v1.43.0 byte-pin untouched.)
5. Is the yoursaas.com Pages site the same repo as myClinic, or a third publishing repo? This decides how the two builds are aggregated.
6. Which of the two service workers should own the origin root? (Recommend: disable Central's SW on the aggregated site; keep only myClinic's.)
7. Is the on-prem node-host.mjs LAN fast-path (F9) in scope, or cloud-only?
8. Pilot-first cutover (R1 D5) still recommended — which clinic, and does its tenant project already exist?

## 10. Evidence — files inspected

myClinic @ b1e174e: package.json, vite.config.js, index.html, public/_headers, public/sw.js, wrangler.jsonc, src/main.jsx, src/App.jsx, src/lib/supabase.js, src/lib/auth-context.jsx, src/lib/store.jsx (35 Supabase call sites), src/lib/central-sync.mjs, src/lib/license.mjs, src/lib/health.mjs, src/lib/offline*.js, src/lib/public-booking.mjs, src/pages/Setup.jsx, supabase/schema.sql (RLS/index/RPC inventory), supabase/functions/sync-clinic-license/index.ts, .github/workflows/pages.yml, scripts/check-pages.mjs, scripts/security-check.mjs, docs/SECURITY.md, docs/SUPABASE-SETUP.md, docs/ARCHITECTURE.md, contract/tier-contract.json, tests/ (46 files).

myClinicLicenseAuthority @ da36c7b: package.json, .env.example, AGENTS.md, README.md, CHANGELOG.md (v2.4.0 → v3.1.0), index.html, public/sw.js, vite.config.js, .github/workflows/pages.yml, src/lib/{supabase.js,auth.mjs,auto-sync-client.mjs,health.mjs,coalesce.mjs,reads.mjs,crypto-rs256.mjs,entitlements.mjs,tier-contract.mjs}, src/pages/{SetupPage.jsx,GuidePage.jsx,ValidatorLabPage.jsx,NodeAgentPage.jsx}, src/components/entitlements/OnboardingWizard.jsx, supabase/schema.sql (v4, §0–§6), supabase/schema-tests.sql, supabase/functions/verify-license/index.ts, server/{license-middleware.mjs,node-host.mjs}, scripts/security-check.mjs, contract/tier-contract.json, tests/myclinic-compat.test.mjs, tests/tier-contract.test.mjs.

External sources:
- Third-party Auth config shapes, asymmetric-only tokens / kid / role claims, service_role caution, JWKS rotation caching: erfi.dev/guides/supabase-shared-tenancy/
- Shared JWT trust across Supabase projects and auth.uid() in RLS: github.com/orgs/supabase/discussions/16673
- global.headers, auth.* options, dispose() caveat, realtime.setAuth: supabase.com/docs/reference/javascript/initializing + release-notes
- accessToken in SupabaseClientOptions: supabase.com/docs/reference/server/frameworks
- GitHub Pages custom-domain / subdirectory constraints: github-help-wanted.com + community discussions

Third-party guides are corroboration, not authority. Re-confirm third-party-auth support and accessToken behaviour against official docs for the exact versions pinned in P0.

## 11. One-line summary

Don't build a new admin portal or a new Master Supabase — Central v3.1.0 already is both. Extend its subscriptions table, onboarding wizard, Guide and single anon RPC; authenticate tenants with a short-lived RS256 capability token from its existing signer; cut the client to two env values and one boot round trip; and reuse both repos' coalescing, cache-first SW, config validation, diagnostics, PG17 harness and checksum-pinned contract ratchets.
