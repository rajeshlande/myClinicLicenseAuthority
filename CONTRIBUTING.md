# Contributing

Central license authority and on-premises RS256 validator for self-hosted `myClinic` deployments. Two rules govern every change: **never weaken asymmetric key or admin RLS boundaries**, and **keep `supabase/schema.sql` idempotent as the single database source of truth**.

`npm run check:contributing` enforces this document in CI on every pull request.

---

## 1. Security & privacy standards

- **No hardcoded secrets.** Never commit private keys, JWTs, `service_role` keys, or `.env` files. Only public values belong in `VITE_` variables (`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`).
- **Input sanitisation & zero raw HTML.** Validate inputs in `src/lib/entitlements.mjs` and enforce constraints in `supabase/schema.sql`. Never use `dangerouslySetInnerHTML`, `.innerHTML`, `outerHTML`, or `insertAdjacentHTML`.
- **Dependency safe-listing.** Every runtime dependency must be listed in `ALLOWED_DEPENDENCIES` inside `scripts/check-contributing.mjs` and documented in `THIRD_PARTY_NOTICES.md`, with `0` high/critical advisories under `npm audit`.
- **Vendored `security-audit` skill.** Cloudflare's `security-audit` skill lives verbatim at `.claude/skills/security-audit/`. Do not edit its files; verify integrity via `npm run check:contributing -- --only skill`.

---

## 2. Performance guidelines

- **Resource management.** Clean up every `addEventListener` and `setInterval` in `src/` with a matching `removeEventListener` or `clearInterval`.
- **Non-blocking browser bundle.** Never import Node filesystem/process calls (`readFileSync`, `writeFileSync`, `execSync`) inside `src/`. Keep Node/Express validator code under `server/`.
- **Lazy-loaded routes.** Keep top-level pages in `src/App.jsx` behind `React.lazy` and `Suspense`, and fetch flattened operational state via `admin_license_view` in one round trip.

---

## 3. Coding & style standards

- **Naming conventions:**
  - `src/components/` and `src/pages/` -> `PascalCase.jsx`
  - `src/lib/` -> `lower-case.mjs` / `.js`
  - Constants -> `UPPER_CASE`, functions/variables -> `camelCase`, SQL -> `snake_case`
- **Testing:** Every module in `src/lib/*.mjs` and middleware in `server/` must have automated tests under `tests/*.test.mjs`. Run `npm test` via `scripts/run-tests.mjs`.
- **Version alignment:** `package.json`, `src/lib/version.js` (`APP_VERSION`), and the top release in `CHANGELOG.md` must match.

---

## 4. Pull request process

1. Work on a descriptive branch (`feat/...`, `fix/...`, `docs/...`).
2. Run `npm run verify` and `npm run test:security` locally before pushing.
3. Include test coverage for new logic and `supabase/schema-tests.sql` assertions for any RLS or trigger changes.
