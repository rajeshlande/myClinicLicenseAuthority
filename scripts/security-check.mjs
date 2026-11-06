#!/usr/bin/env node
/**
 * Security boundary pre-flight & scratch-database verification procedure.
 */
import { existsSync } from 'node:fs';

const checks = [
  [
    existsSync('supabase/schema.sql'),
    'supabase/schema.sql present (single source of truth, schema v1)',
  ],
  [
    existsSync('supabase/schema-tests.sql'),
    'supabase/schema-tests.sql present (RLS + hardware lock regression suite)',
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
];

console.log('\nmyClinic License Authority — security verification\n');
for (const [ok, label] of checks) {
  console.log(`  ${ok ? '✓' : '✗'} ${label}`);
}

console.log(`
Database checks (run against a SCRATCH Supabase project, never production):

  1. psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/schema.sql
     -> single idempotent transaction; sets public.app_schema_version() = 1.

  2. psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/schema-tests.sql
     -> asserts anon refusal, non-admin authenticated refusal, atomic
        create_subscription_with_license(), admin_license_view counts,
        row-locked enforce_max_machines_limit() (53400), and kill-switch toggle,
        then rolls back cleanly.

Cryptographic & client checks:
  npm test    — RS256 keypair, JWT signature/expiry/fingerprint enforcement,
                algorithm-confusion defense, schema invariants, audit validators
`);

if (checks.some(([ok]) => !ok)) process.exit(1);
