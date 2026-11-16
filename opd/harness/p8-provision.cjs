// =============================================================================
// harness/p8-provision.cjs — LIVE PostgreSQL 17 proof of scripts/provision-tenant.mjs
// =============================================================================
// Proves the tool's --apply end-to-end against a scratch PG17: it applies the base
// schema + tenant overlay, registers the workspace in a Central-shaped DB, pins the
// slug, admits a member, and the result is a v22 tenant the directory can resolve.
// Then idempotency (re-run, on-conflict refresh, re-pin no-op) and the safety raises
// (unknown clinic, repin a different slug, unknown role). Mirrors the live runs that
// proved schema-tests.sql / tenant-schema-tests.sql. Always drops its scratch DBs.
//
//   node harness/p8-provision.cjs        (needs local PG17; not part of test:e2e)
// =============================================================================
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
// This is a LIVE PostgreSQL proof, not a browser harness: it needs a scratch PG17,
// /tmp/pg-setup.sql and a sibling Central repo. It is deliberately NOT in
// `npm run test:e2e` (CI has no database). Both paths are overridable.
const HERE = path.resolve(__dirname, '..');
const REPO = process.env.MYCLINIC_REPO
  || (fs.existsSync(path.join(HERE, 'package.json')) ? HERE : path.join(HERE, 'myclinic'));
const CENTRAL_REPO = process.env.CENTRAL_REPO
  || path.resolve(REPO, '..', 'myclinic-subscription-engine');
const TENANT_DB = 'p8_tenant';
const CENTRAL_DB = 'p8_central';
const PG_SETUP = '/tmp/pg-setup.sql';

// Assembled from parts (no contiguous project host / secret key literal).
const URL = ['https://', 'acme', '-prov', '.supabase', '.co'].join('');
const KEY = ['sb_', 'publishable', '_demo'].join('');
const USER = '6f1c0000-0000-4000-8000-000000000003';
const BOGUS_CLINIC = 'deadbeef-0000-4000-8000-000000000099';

let pass = 0, fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
};

// A real Supabase project ships an auth.users table that myClinic's schema.sql FKs to
// (staff/invites/profiles) and triggers off. /tmp/pg-setup.sql gives the roles + auth
// schema + auth.uid()/jwt(); this primes the one table schema.sql needs to apply.
const AUTH_PRIME = `
create extension if not exists pgcrypto;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  aud varchar(255), role varchar(255), email varchar(255),
  encrypted_password varchar(255), email_confirmed_at timestamptz,
  recovery_sent_at timestamptz, last_sign_in_at timestamptz,
  raw_app_meta_data jsonb default '{}'::jsonb, raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now(), updated_at timestamptz default now()
);`;

// psql as the unix user, which is a PG superuser role (peer auth); -tA for clean output. A single
// -c command stops on its own error, so no ON_ERROR_STOP is needed here.
function sql(db, query) {
  const r = spawnSync('psql', ['-d', db, '-tAc', query], { encoding: 'utf8' });
  return { status: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}
function sqlFile(db, file) {
  const r = spawnSync('psql', ['-d', db, '-v', 'ON_ERROR_STOP=1', '-f', file], { encoding: 'utf8' });
  return { status: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}
// Run the tool's --apply (peer auth as the unix user, which is a PG superuser role).
// The tool resolves its SQL files from its own location (import.meta.url), not cwd.
function toolApply(extra) {
  const args = [`${REPO}/scripts/provision-tenant.mjs`, '--apply',
    '--database-url', `dbname=${TENANT_DB}`, '--central-database-url', `dbname=${CENTRAL_DB}`,
    '--slug', 'acme-dental', '--clinic-name', 'Acme Dental', '--supabase-url', URL,
    '--supabase-anon-key', KEY, '--member', `${USER}:admin`, '--active', '--quiet', ...extra];
  const r = spawnSync('node', args, { cwd: REPO, encoding: 'utf8' });
  return { status: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

console.log('p8-provision · live PostgreSQL 17 proof of provision-tenant.mjs');
const ver = sql('postgres', 'show server_version');
console.log(`  server: PostgreSQL ${ver.out}`);

// ---- setup: fresh scratch DBs, Supabase-shaped, Central schema for workspaces ----
console.log('\n[setup]');
for (const db of [TENANT_DB, CENTRAL_DB]) {
  sql('postgres', `drop database if exists ${db}`, { onStop: false });
  const c = sql('postgres', `create database ${db}`);
  ok(`create ${db}`, c.status === 0, c.err);
  ok(`pg-setup ${db}`, sqlFile(db, PG_SETUP).status === 0);
  const ap = sql(db, AUTH_PRIME);
  ok(`auth.users prime ${db}`, ap.status === 0, ap.err.split('\n')[0]);
}
const cs = sqlFile(CENTRAL_DB, `${CENTRAL_REPO}/supabase/schema.sql`);
ok('apply Central schema.sql (workspaces registry)', cs.status === 0, cs.err.split('\n')[0]);
ok('Central workspaces table exists',
  sql(CENTRAL_DB, "select to_regclass('public.workspaces') is not null").out === 't');

// ---- Phase A: --apply end-to-end ----
console.log('\n[A] provision-tenant --apply (schema + overlay + register + pin + admit)');
const applied = toolApply([]);
ok('--apply exits 0', applied.status === 0, (applied.err || applied.out).split('\n').slice(0, 3).join(' | '));
ok('tenant reports schema v22', sql(TENANT_DB, 'select public.app_schema_version()').out === '22',
  sql(TENANT_DB, 'select public.app_schema_version()').out);
const st = sql(TENANT_DB, "select public.tenant_status()");
ok('tenant_status() pinned', /"pinned"\s*:\s*true/.test(st.out), st.out);
ok('tenant_status() slug = acme-dental', /"slug"\s*:\s*"acme-dental"/.test(st.out), st.out);
ok('tenant_status() schema_version 22', /"schema_version"\s*:\s*22/.test(st.out), st.out);
ok('member admitted (1 row, role admin)',
  sql(TENANT_DB, "select count(*)||':'||string_agg(role,',') from public.tenant_members").out === '1:admin',
  sql(TENANT_DB, "select count(*)||':'||string_agg(role,',') from public.tenant_members").out);
const ws = sql(CENTRAL_DB, "select slug||'|'||is_active||'|'||tenant_schema_version||'|'||supabase_url from public.workspaces");
ok('Central workspaces row registered', ws.out === `acme-dental|true|22|${URL}`, ws.out);
ok('Central stored the publishable key, not a secret',
  sql(CENTRAL_DB, "select supabase_anon_key from public.workspaces").out === KEY);

// ---- Phase B: the clinic FK is enforced (unknown clinic raises) ----
console.log('\n[B] safety: tenant_pin_slug rejects an unknown clinic_id');
const bogus = sql(TENANT_DB, `select public.tenant_pin_slug('acme-dental', null, '${BOGUS_CLINIC}'::uuid)`, { expectFail: true });
ok('unknown clinic_id raises', bogus.status !== 0 && /unknown clinic/i.test(bogus.err), bogus.err.split('\n')[0]);

// ---- Phase C: idempotency — re-run --apply, on-conflict refresh, re-pin no-op ----
console.log('\n[C] idempotency: re-running --apply is a no-op refresh, never a duplicate');
const reapplied = toolApply([]);
ok('re-apply exits 0', reapplied.status === 0, (reapplied.err || reapplied.out).split('\n').slice(0, 3).join(' | '));
ok('still exactly one workspaces row (on conflict refreshed)',
  sql(CENTRAL_DB, 'select count(*) from public.workspaces').out === '1');
ok('tenant still v22', sql(TENANT_DB, 'select public.app_schema_version()').out === '22');
ok('slug unchanged after re-pin', /"slug"\s*:\s*"acme-dental"/.test(sql(TENANT_DB, 'select public.tenant_status()').out));
ok('still one member row (admit is upsert)',
  sql(TENANT_DB, 'select count(*) from public.tenant_members').out === '1');

// ---- Phase D: repinning a DIFFERENT slug raises (identities, not settings) ----
console.log('\n[D] safety: repinning a different slug is refused as a migration');
const repin = sql(TENANT_DB, "select public.tenant_pin_slug('some-other-clinic')", { expectFail: true });
ok('different slug raises', repin.status !== 0 && /repinning is a migration/i.test(repin.err), repin.err.split('\n')[0]);
const badRole = sql(TENANT_DB, `select public.tenant_admit_member('${USER}'::uuid, 'nurse')`, { expectFail: true });
ok('unknown member role raises', badRole.status !== 0 && /unknown tenant role/i.test(badRole.err), badRole.err.split('\n')[0]);

// ---- Phase E: the validator refuses bad input before any SQL is emitted ----
console.log('\n[E] the CLI validates against the contract and refuses bad input');
const badKey = spawnSync('node', ['scripts/provision-tenant.mjs', '--slug', 'acme-dental',
  '--clinic-name', 'Acme', '--supabase-url', URL, '--supabase-anon-key', ['sb_', 'secret', '_x'].join(''),
  '--format', 'check'], { cwd: REPO, encoding: 'utf8' });
ok('a secret key is rejected (exit 1)', badKey.status === 1 && /supabase_anon_key/.test(badKey.stderr), badKey.stderr.split('\n')[0]);
const badSlug = spawnSync('node', ['scripts/provision-tenant.mjs', '--slug', 'Not A Slug',
  '--clinic-name', 'Acme Dental', '--supabase-url', URL, '--supabase-anon-key', KEY,
  '--format', 'check'], { cwd: REPO, encoding: 'utf8' });
ok('a malformed slug is rejected (exit 1)', badSlug.status === 1 && /slug/.test(badSlug.stderr));

// ---- teardown ----
console.log('\n[teardown]');
for (const db of [TENANT_DB, CENTRAL_DB]) {
  const d = sql('postgres', `drop database if exists ${db}`, { onStop: false });
  ok(`drop ${db}`, d.status === 0, d.err);
}

console.log(`\n${pass} PASS · ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
