# Changelog

All notable changes to `myclinic-license-authority` are documented in this file.

## [1.0.0] - 2026-11-06

### Added
- Unified single-repository web application (`src/`) and distributed Express 5 local validator (`server/`) for self-hosted `myClinic` deployments.
- Single source-of-truth idempotent PostgreSQL schema (`supabase/schema.sql`, Schema v1) with `subscriptions`, `licenses`, `activated_machines`, row-locked `enforce_max_machines_limit()` trigger, `security_invoker` `admin_license_view`, atomic `create_subscription_with_license()` RPC, and scratch regression suite (`supabase/schema-tests.sql`).
- Supabase Edge Function (`supabase/functions/verify-license/index.ts`) signing 7-day RS256 capability JWTs via PKCS#8 WebCrypto.
- GitHub Pages ready hash-routed Control Room (`EntitlementsPage`, `ValidatorLabPage`, `NodeAgentPage`, `SetupPage`) with zero-HTML rich notes AST rendering and in-browser RS256 Key Studio.
- Vendored Cloudflare `security-audit` skill (`.claude/skills/security-audit/`), `AGENTS.md`, `CLAUDE.md`, `SECURITY.md`, `CONTRIBUTING.md`, automated CI + Pages workflows, and full Node test suite (`tests/`).
