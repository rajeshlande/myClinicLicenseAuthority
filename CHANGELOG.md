# Changelog

All notable changes to `myclinic-license-authority` are documented in this file.

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
