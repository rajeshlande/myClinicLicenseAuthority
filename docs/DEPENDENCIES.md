# Dependencies

Complete inventory of direct dependencies in the unified `myclinic-license-authority` repository, audited against the npm and Deno registries on **2026-11-06**.

- **Audit status:** `npm audit` reports **0 vulnerabilities**.

## Direct NPM Dependencies (`package.json`)

| Package | Scope | Declared | Latest Stable | Licence | Status |
| --- | --- | --- | --- | --- | --- |
| `@supabase/supabase-js` | runtime | `^2.119.0` | `2.119.0` | MIT | ✅ current |
| `express` | runtime | `^5.3.0` | `5.3.0` | MIT | ✅ current |
| `jsonwebtoken` | runtime | `^9.0.3` | `9.0.3` | MIT | ✅ current |
| `lucide-react` | runtime | `^1.70.0` | `1.70.0` | ISC | ✅ current |
| `node-cron` | runtime | `^4.6.0` | `4.6.0` | ISC | ✅ current |
| `react` | runtime | `^19.3.1` | `19.3.1` | MIT | ✅ current |
| `react-dom` | runtime | `^19.3.1` | `19.3.1` | MIT | ✅ current |
| `@tailwindcss/vite` | dev | `^4.3.4` | `4.3.4` | MIT | ✅ current |
| `@vitejs/plugin-react` | dev | `^6.2.1` | `6.2.1` | MIT | ✅ current |
| `tailwindcss` | dev | `^4.3.4` | `4.3.4` | MIT | ✅ current |
| `vite` | dev | `^8.3.6` | `8.3.6` | MIT | ✅ current |

## Supabase Edge Function Imports (`supabase/functions/verify-license/index.ts`)

| Import | Pinned | Latest Stable | Licence | Status |
| --- | --- | --- | --- | --- |
| `https://esm.sh/@supabase/supabase-js` | `2.119.0` | `2.119.0` | MIT | ✅ current |
| `https://deno.land/x/djwt` | `v3.0.2` | `v3.0.2` | MIT | ✅ current |
