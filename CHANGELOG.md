# Changelog

All notable changes to `myclinic-license-authority` are documented in this file.

## [1.1.0] - 2026-11-06

### Added
- **Zero-Trust Cloud Admin Authentication Gate (`src/pages/LoginPage.jsx`, `src/lib/auth.mjs`):** Hard-gates all Control Plane routes (`#/dashboard`, `#/node-agent`, `#/simulator`, `#/setup`) behind an authenticated Supabase session carrying an immutable `app_metadata.role = 'admin'` claim (`user_metadata` role tampering is explicitly ignored in both `isAuthorizedAdminUser()` and PostgreSQL `public.is_license_admin()`).
- **Operator Sign-In & Password Recovery Flows:** Email + password sign-in with visibility toggle, password recovery link dispatch (`resetPasswordForEmail`) compatible with GitHub Pages hash routing (`#/reset-password`), in-app password rotation (`updateUser`), authenticated operator session telemetry in `AppShell`, and a `403 · Admin Role Claim Required` remediation screen with copyable `auth.users` SQL grant.
- **Dedicated Auth Unit Test Suite (`tests/auth.test.mjs`):** 8 automated tests verifying role-claim enforcement, credential/password-reset validators, and GitHub-Pages-safe recovery redirect URL construction.

### Changed
- Removed unauthenticated Demo Sandbox fallback from the live Control Plane (`src/lib/supabase.js`, `src/App.jsx`, `src/pages/SetupPage.jsx`) so the operator UI strictly requires a verified Cloud Admin login.

## [1.0.0] - 2026-11-06

### Added
- Unified single-repository web application (`src/`) and distributed Express 5 local validator (`server/`) for self-hosted `myClinic` deployments.
- Single source-of-truth idempotent PostgreSQL schema (`supabase/schema.sql`, Schema v1) with `subscriptions`, `licenses`, `activated_machines`, row-locked `enforce_max_machines_limit()` trigger, `security_invoker` `admin_license_view`, atomic `create_subscription_with_license()` RPC, and scratch regression suite (`supabase/schema-tests.sql`).
- Supabase Edge Function (`supabase/functions/verify-license/index.ts`) signing 7-day RS256 capability JWTs via PKCS#8 WebCrypto.
- GitHub Pages ready hash-routed Control Room (`EntitlementsPage`, `ValidatorLabPage`, `NodeAgentPage`, `SetupPage`) with zero-HTML rich notes AST rendering and in-browser RS256 Key Studio.
- Vendored Cloudflare `security-audit` skill (`.claude/skills/security-audit/`), `AGENTS.md`, `CLAUDE.md`, `SECURITY.md`, `CONTRIBUTING.md`, automated CI + Pages workflows, and full Node test suite (`tests/`).
