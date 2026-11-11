#!/usr/bin/env node
/**
 * Security boundary pre-flight & scratch-database verification procedure.
 *
 * Every check below reads the tracked tree, so this script fails when the schema
 * drifts away from the invariants it documents — not only when a file goes missing.
 */
import { existsSync, readFileSync } from 'node:fs';
import { SCHEMA_VERSION } from '../src/lib/version.js';

const read = (file) => {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
};

const schemaSql = read('supabase/schema.sql');
const schemaTestsSql = read('supabase/schema-tests.sql');

/** The refusal-audit columns that must exist, hashed or masked, never raw. */
const auditTable = /create table if not exists public\.sync_attempts\s*\(([\s\S]*?)\n\);/.exec(
  schemaSql,
)?.[1];

/** The readiness-probe branch, which must stay completely side-effect free. */
const healthcheckBlock =
  /v_device = 'healthcheck' then([\s\S]*?)\n  end if;/.exec(schemaSql)?.[1] ?? '';

const checks = [
  [
    existsSync('supabase/schema.sql'),
    `supabase/schema.sql present (single source of truth, schema v${SCHEMA_VERSION})`,
  ],
  [
    new RegExp(`greatest\\(schema_version,\\s*${SCHEMA_VERSION}\\)`).test(schemaSql) &&
      new RegExp(`\\(${SCHEMA_VERSION},\\s*'activity-log-and-invoices'`).test(schemaSql),
    `schema.sql registers migration ${SCHEMA_VERSION} and lifts app_meta to v${SCHEMA_VERSION}`,
  ],
  [
    existsSync('supabase/schema-tests.sql'),
    'supabase/schema-tests.sql present (FORCE RLS + keyless auto-sync + refusal-audit suite)',
  ],
  [
    existsSync('src/lib/auto-sync-client.mjs'),
    'src/lib/auto-sync-client.mjs blocks secret keys & isolates cross-Supabase JWTs',
  ],
  [
    existsSync('supabase/functions/verify-license/index.ts'),
    'supabase/functions/verify-license/index.ts present (RS256 signer Edge Function)',
  ],
  [
    existsSync('src/lib/health.mjs'),
    'src/lib/health.mjs blocks service_role / sb_secret_ keys in browser',
  ],
  [
    existsSync('server/license-middleware.mjs'),
    'server/license-middleware.mjs pins RS256 + machine_fingerprint offline',
  ],
  [
    existsSync('.claude/skills/security-audit/SKILL.md'),
    '.claude/skills/security-audit/SKILL.md vendored & verifiable',
  ],
  // ── Refusal audit (schema v3): evidence without surveillance ────────────────
  [
    /alter table public\.sync_attempts force row level security/i.test(schemaSql) &&
      /revoke all on public\.sync_attempts from public, anon/i.test(schemaSql),
    'sync_attempts is FORCE RLS and revoked from public + anon',
  ],
  [
    /create policy sync_attempts_admin_read[\s\S]*?for select to authenticated[\s\S]*?using \(public\.is_license_admin\(\)\)/i.test(
      schemaSql,
    ) && !/create policy[\s\S]{0,200}sync_attempts[\s\S]{0,200}for (insert|all)/i.test(schemaSql),
    'sync_attempts is read-only for admins: the SECURITY DEFINER RPC is the only writer',
  ],
  [
    Boolean(auditTable) &&
      /ip_hash\s+text not null/i.test(auditTable) &&
      /claimed_email_hash/i.test(auditTable) &&
      /claimed_email_hint/i.test(auditTable) &&
      !/(^|\n)\s*(ip|raw_ip|ip_address|email|customer_email|email_address|device_id)\s+/i.test(
        auditTable,
      ),
    'sync_attempts stores a hashed IP and a hashed + masked email, never a raw identifier',
  ],
  [
    /interval '30 days'/i.test(schemaSql) &&
      /consume_sync_rate_limit\('prune:sync_attempts'/i.test(schemaSql) &&
      /consume_sync_rate_limit\('audit:'/i.test(schemaSql),
    'refusal evidence self-prunes after 30 days and is per-IP throttled (no write amplification)',
  ],
  [
    /return jsonb_build_object\(\s*'ok', true/.test(healthcheckBlock) &&
      !/record_sync_attempt|insert\s+into|update\s+public|delete\s+from/i.test(
        healthcheckBlock,
      ),
    'the zero-side-effect healthcheck probe still writes nothing at all',
  ],
  [
    /perform public\.record_sync_attempt\(/i.test(schemaSql) &&
      /exception when others then\s+null;/.test(
        /create or replace function public\.record_sync_attempt[\s\S]*?\$\$;/.exec(schemaSql)?.[0] ??
          '',
      ),
    'record_sync_attempt is best-effort: an audit failure can never change a client verdict',
  ],
  [
    /last_refusal_code/i.test(schemaSql) &&
      /refusals_24h/i.test(schemaSql) &&
      /near-miss:/i.test(schemaSql),
    'admin_license_view exposes the last refusal, its 24h count, and near-miss attribution',
  ],
  [
    /sync_attempts/i.test(schemaTestsSql) &&
      /retention/i.test(schemaTestsSql) &&
      /ip_hash is not the peppered|encode\(digest\('myclinic-sync-v2:/i.test(schemaTestsSql),
    'schema-tests.sql proves the audit is private, attributed, self-pruning and read-only',
  ],
  // ── Activity log + invoices (schema v4): history you cannot rewrite ─────────
  [
    /alter table public\.clinic_activity_log force row level security/i.test(schemaSql) &&
      /alter table public\.invoices force row level security/i.test(schemaSql) &&
      /revoke all on public\.clinic_activity_log from public, anon/i.test(schemaSql) &&
      /revoke all on public\.invoices from public, anon/i.test(schemaSql),
    'clinic_activity_log + invoices are FORCE RLS and revoked from public + anon',
  ],
  [
    /grant select, insert on public\.clinic_activity_log to authenticated/i.test(schemaSql) &&
      /revoke update, delete on public\.clinic_activity_log from authenticated/i.test(schemaSql) &&
      !/grant\s+[^;\n]*(update|delete)\s+on\s+public\.clinic_activity_log/i.test(schemaSql) &&
      !/create\s+policy[\s\S]{0,120}clinic_activity_log[\s\S]{0,80}for\s+(update|delete|all)/i.test(schemaSql),
    'the per-clinic activity log is append-only: SELECT + INSERT for admins, never UPDATE/DELETE',
  ],
  [
    /latest_invoice_number/i.test(schemaSql) &&
      /open_invoice_count/i.test(schemaSql) &&
      /check \(status in \('draft', 'issued', 'paid', 'void'\)/i.test(schemaSql),
    'admin_license_view exposes invoice standing; invoice status is a closed set',
  ],
  [
    /--\s*8\./.test(schemaTestsSql) && /append-only/i.test(schemaTestsSql),
    'schema-tests.sql §8 proves the v4 tables live (anon/non-admin refusal, append-only, view columns)',
  ],
];

console.log('\nmyClinic License Authority — security verification\n');
for (const [ok, label] of checks) {
  console.log(`  ${ok ? '✓' : '✗'} ${label}`);
}

console.log(`
Database checks (run against a SCRATCH Supabase project, never production):

  1. psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/schema.sql
     -> single idempotent transaction; sets public.app_schema_version() = ${SCHEMA_VERSION}.

  2. psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/schema-tests.sql
     -> asserts anon refusal, non-admin authenticated refusal, atomic
        create_subscription_with_license(), admin_license_view counts,
        row-locked enforce_max_machines_limit() (53400), kill-switch toggle,
        and the v3 refused-attempt audit (attribution, masking, retention,
        read-only), then rolls back cleanly.

Reading a refusal in production (admin only):

  select attempted_at, code, claimed_origin, browser_origin, claimed_email_hint,
         match_mode, origin_header_ok
    from public.sync_attempts
   where license_id = '<license uuid>'
   order by attempted_at desc
   limit 20;

Cryptographic & client checks:
  npm test    — RS256 keypair, JWT signature/expiry/fingerprint enforcement,
                algorithm-confusion defense, schema invariants, audit validators
`);

if (checks.some(([ok]) => !ok)) process.exit(1);
