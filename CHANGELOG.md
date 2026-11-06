# Changelog

All notable changes to `myclinic-license-authority` are documented in this file.

## [1.1.1] - 2026-11-06

### Changed
- **Post-Login Cloud Endpoint Connection (`src/pages/LoginPage.jsx`, `src/pages/SetupPage.jsx`, `src/lib/auth.mjs`):** Operators now authenticate at the login gate **first** (via a one-time PBKDF2-SHA256 120k-iteration local operator vault before Cloud Supabase is linked) and connect **`Authority Supabase Project URL`** + **`Public Publishable / Anon Key`** **after login** inside `#/setup` (`Authority & Session`), without any pre-login endpoint prompt or unauthenticated bypass.

## [1.1.0] - 2026-11-06

### Added
- **Zero-Trust Cloud Admin Authentication Gate (`src/pages/LoginPage.jsx`, `src/lib/auth.mjs`):** Hard-gates all Control Plane routes (`#/dashboard`, `#/node-agent`, `#/simulator`, `#/setup`) behind an authenticated operator session carrying `app_metadata.role = 'admin'`.
- **Operator Sign-In & Password Recovery Flows:** Email + password sign-in with visibility toggle, password recovery link dispatch (`resetPasswordForEmail`) compatible with GitHub Pages hash routing (`#/reset-password`), in-app password rotation (`updateUser`), and a `403 · Admin Role Claim Required` remediation screen with copyable `auth.users` SQL grant.

## [1.0.0] - 2026-11-06

### Added
- Unified single-repository web application (`src/`) and distributed Express 5 local validator (`server/`) for self-hosted `myClinic` deployments.
- Single source-of-truth idempotent PostgreSQL schema (`supabase/schema.sql`, Schema v1) with `subscriptions`, `licenses`, `activated_machines`, row-locked `enforce_max_machines_limit()` trigger, `security_invoker` `admin_license_view`, atomic `create_subscription_with_license()` RPC, and scratch regression suite (`supabase/schema-tests.sql`).
- Supabase Edge Function (`supabase/functions/verify-license/index.ts`) signing 7-day RS256 capability JWTs via PKCS#8 WebCrypto.
- GitHub Pages ready hash-routed Control Room (`EntitlementsPage`, `ValidatorLabPage`, `NodeAgentPage`, `SetupPage`) with zero-HTML rich notes AST rendering and in-browser RS256 Key Studio.
- Vendored Cloudflare `security-audit` skill (`.claude/skills/security-audit/`), `AGENTS.md`, `CLAUDE.md`, `SECURITY.md`, `CONTRIBUTING.md`, automated CI + Pages workflows, and full Node test suite (`tests/`).
