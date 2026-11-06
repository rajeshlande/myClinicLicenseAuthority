# CLAUDE.md

Guidance for Claude Code when working in `myclinic-license-authority`.

## Quick Commands

```bash
npm run dev                  # Start Control Room web app on 0.0.0.0:5173 (Demo or Cloud mode)
npm test                     # Run all unit, crypto, schema, middleware & skill tests
npm run verify               # Full CI gate: tests + build + Pages check + CONTRIBUTING check
npm run check:contributing   # Enforce CONTRIBUTING.md zero-trust, naming, XSS, deps & skill rules
npm run test:security        # Verify schema/RLS/RS256 files & print psql scratch test commands
npm run keygen               # Generate fresh RS256 PKCS#8 + SPKI keypair for .env
npm run start:validator      # Launch Express 5 local validator gateway on 0.0.0.0:4000
```

## Architecture & Conventions

- **One Web App + One Repo**: Admin Control Room (`src/`), Central SQL Authority (`supabase/schema.sql`), Deno RS256 Edge Signer (`supabase/functions/verify-license/index.ts`), and Distributed Node.js Validator (`server/`) live together here.
- **GitHub Pages Ready**: `vite.config.js` defaults to `base: './'` and `src/App.jsx` uses hash routing (`#/dashboard`, `#/simulator`, `#/node-agent`, `#/setup`) with `React.lazy` + `Suspense`. Every build must pass `npm run check:pages`.
- **Naming**:
  - `src/components/` and `src/pages/` -> `PascalCase.jsx`
  - `src/lib/` -> `lower-case.mjs` / `.js` (pure logic, zero DOM, covered by `tests/*.test.mjs`)
- **Zero-Trust Security**:
  - Read `AGENTS.md`, `SECURITY.md`, and `CONTRIBUTING.md` before changing auth, RLS, or JWT logic.
  - Never use `dangerouslySetInnerHTML` or `.innerHTML`.
  - Balance every `addEventListener` / `setInterval` with `removeEventListener` / `clearInterval` in the same file.
  - Always pin `algorithms: ['RS256']` and verify `machine_fingerprint` when validating capability tokens.
  - Keep `APP_VERSION` (`src/lib/version.js`), `package.json` `version`, and the top entry of `CHANGELOG.md` identical.

## Vendored Audit Skill

Cloudflare's `security-audit` skill is vendored at `.claude/skills/security-audit/` (do not modify its files). When asked for a security review or audit, follow `.claude/skills/security-audit/SKILL.md` and validate outputs with `.claude/skills/security-audit/validate-findings.cjs` and `.claude/skills/security-audit/validate-coverage-ledger.cjs`.
