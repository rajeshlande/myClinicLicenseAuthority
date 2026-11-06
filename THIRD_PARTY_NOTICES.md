# Third-party notices

`myclinic-license-authority` is built on open-source software:

| Package | Licence | Use |
| --- | --- | --- |
| [React](https://react.dev) (`react`, `react-dom`) | MIT | Control Room UI runtime |
| [@supabase/supabase-js](https://supabase.com/docs/reference/javascript) | MIT | Supabase Auth, PostgREST & RPC client |
| [lucide-react](https://lucide.dev) | ISC | Interface icons |
| [Express](https://expressjs.com) (`express`) | MIT | On-premises container license gateway (`server/`) |
| [jsonwebtoken](https://github.com/auth0/node-jsonwebtoken) (`jsonwebtoken`) | MIT | Offline RS256 public-key JWT verification (`server/`) |
| [node-cron](https://github.com/node-cron/node-cron) (`node-cron`) | ISC | Automated 6-hour phone-home token sync scheduler (`server/`) |
| [Vite](https://vite.dev) / `@vitejs/plugin-react` / `tailwindcss` / `@tailwindcss/vite` | MIT | Build & CSS tooling (dev dependencies) |
| [Cloudflare `security-audit` skill](https://github.com/cloudflare/security-audit-skill) | MIT | Vendored at `.claude/skills/security-audit/` — contributor/agent security audit tooling (never bundled into `dist/`) |

This repository's own source code is licensed under MIT — see [`LICENSE`](LICENSE).
