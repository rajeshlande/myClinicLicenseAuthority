# Agent Operating Manual (`AGENTS.md`)

Instructions for coding agents (Codex, Arena, Cursor, Copilot, OpenCode, Claude) working in `myclinic-license-authority`.

---

## 1. Repository Architecture (Single Unified Web App + Node Gateway)

All modules of the **myClinic Subscription Management & Asymmetric RS256 Validation Engine** live in one unified repository:

| Path | Responsibility |
| --- | --- |
| `supabase/schema.sql` | **Single source-of-truth SQL schema** (idempotent `BEGIN...COMMIT`, `subscriptions`, `licenses`, `activated_machines`, `admin_license_view`, `create_subscription_with_license()`, `enforce_max_machines_limit()` row-locked trigger, admin RLS). |
| `supabase/schema-tests.sql` | Transactional scratch-DB verification suite (`ROLLBACK` on exit). |
| `supabase/functions/verify-license/index.ts` | Deno Edge Function holding `LICENSE_PRIVATE_KEY` (PKCS#8) to verify standing, bind hardware locks, and sign 7-day RS256 JWTs. |
| `src/lib/*.mjs` | Pure, zero-DOM, lower-case domain & WebCrypto libraries shared across UI and tests (`entitlements.mjs`, `notes.mjs`, `crypto-rs256.mjs`, `health.mjs`, `demo-store.mjs`). |
| `src/pages/*.jsx` & `src/components/*.jsx` | `PascalCase.jsx` hash-routed React 19 + Tailwind 4 Control Room (`EntitlementsPage`, `ValidatorLabPage`, `NodeAgentPage`, `SetupPage`). Works both in Cloud Supabase mode and static GitHub Pages Demo Mode. |
| `server/license-middleware.mjs` & `server/node-host.mjs` | Express 5 + `jsonwebtoken` + `node-cron` distributed on-premises validator holding ONLY `LICENSE_PUBLIC_KEY` (SPKI) and enforcing HTTP `402 Payment Required`. |
| `.claude/skills/security-audit/` | Vendored verbatim [Cloudflare `security-audit` skill](https://github.com/cloudflare/security-audit-skill) (MIT). **Never edit files inside this directory.** |

---

## 2. Non-Negotiable Zero-Trust Rules

1. **Asymmetric Key Isolation**: `LICENSE_PRIVATE_KEY` exists ONLY in Supabase Edge Function Secrets. Customer containers and browser code hold ONLY `LICENSE_PUBLIC_KEY` (SPKI).
2. **Never Leak Privileged Keys to `VITE_`**: `src/lib/health.mjs` and `.github/workflows/pages.yml` refuse `service_role` or `sb_secret_` keys in `VITE_SUPABASE_ANON_KEY`.
3. **No Raw HTML Injection**: `dangerouslySetInnerHTML`, `.innerHTML`, `outerHTML`, and `insertAdjacentHTML` are banned and fail `npm run check:contributing`. Rich notes use the AST parser in `src/lib/notes.mjs` rendered via `src/components/RichNotesView.jsx`.
4. **Immutable Admin Authorization**: RLS policies authorize operators via `(auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'`, never mutable `user_metadata`.
5. **Single SQL Source of Truth**: Never create split migration fragments. Keep `supabase/schema.sql` idempotent and bump `SCHEMA_VERSION` in `src/lib/version.js` alongside `supabase/schema-tests.sql`.

---

## 3. Running Security Audits (`.claude/skills/security-audit/`)

When asked to perform a security audit of this repository, load `.claude/skills/security-audit/SKILL.md` and follow all six phases:
1. **Reconnaissance** (`RECONNAISSANCE.md`) — map trust boundaries (Browser Admin <-> PostgREST RLS <-> Edge Signer <-> Distributed Express Node).
2. **Coverage-Led Hunting** (`HUNTING.md`, `WEB-PROTOCOL-AND-AUTH.md`, `CLIENT-SIDE.md`, `CLOUD-AND-DEPLOYMENT.md`, `SUPPLY-CHAIN-AND-RELEASE.md`).
3. **Candidate Validation** — source-first inside sandbox; never probe production endpoints.
4. **Structured Output** — validate findings JSON via `node .claude/skills/security-audit/validate-findings.cjs <findings.json>` and ledger via `node .claude/skills/security-audit/validate-coverage-ledger.cjs <ledger.json>`.
5. **Independent Record Verification** — an agent never verifies its own finding.
6. **Reporting** (`VALIDATION-AND-REPORTING.md`).

---

## 4. Pre-Commit Verification Gate

Every change must pass all checks before completion:

```bash
npm test                     # Node test runner across tests/*.test.mjs
npm run verify               # tests + Vite build + Pages check + CONTRIBUTING check
npm run test:security        # security boundary & schema pre-flight
npm audit --audit-level=high # dependency vulnerability gate (must report 0)
```
