import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { SCHEMA_VERSION } from '../src/lib/version.js';

const schemaSql = readFileSync('supabase/schema.sql', 'utf8');
const schemaTestsSql = readFileSync('supabase/schema-tests.sql', 'utf8');

test('supabase/schema.sql is wrapped in one transaction and matches SCHEMA_VERSION', () => {
  assert.equal(SCHEMA_VERSION, 2);
  assert.match(schemaSql, /^\s*begin;/im);
  assert.match(schemaSql, /commit;\s*$/im);
  assert.match(
    schemaSql,
    new RegExp(`\\(${SCHEMA_VERSION},\\s*'keyless-auto-sync-core'`),
  );
});

test('every security definer function pins search_path and avoids dynamic SQL', () => {
  const fnBlocks = schemaSql.split(/create\s+or\s+replace\s+function/i).slice(1);
  assert.ok(fnBlocks.length >= 7);
  for (const block of fnBlocks) {
    const header = block.split(/\bas\s+\$\$/i)[0] ?? '';
    const body = block.split(/\bas\s+\$\$/i)[1] ?? '';
    if (/security\s+definer/i.test(header)) {
      assert.match(header, /set\s+search_path\s*=/i);
      assert.doesNotMatch(
        body,
        /\bexecute\s+['"]/i,
        'SECURITY DEFINER functions must never run dynamic SQL strings',
      );
    }
  }
});

test('Central DB enforces FORCE RLS, zero anon table access, and single-RPC surface', () => {
  assert.match(
    schemaSql,
    /create\s+or\s+replace\s+view\s+public\.admin_license_view[\s\S]*?with\s*\(\s*security_invoker\s*=\s*true\s*\)/i,
  );

  // Every table must have BOTH enable and force row level security
  for (const tbl of [
    'app_meta',
    'schema_migrations',
    'subscriptions',
    'licenses',
    'activated_machines',
    'sync_rate_limits',
  ]) {
    assert.match(
      schemaSql,
      new RegExp(`alter\\s+table\\s+public\\.${tbl}\\s+enable\\s+row\\s+level\\s+security`, 'i'),
    );
    assert.match(
      schemaSql,
      new RegExp(`alter\\s+table\\s+public\\.${tbl}\\s+force\\s+row\\s+level\\s+security`, 'i'),
    );
  }

  // anon has zero table/view/rate-limit access
  assert.match(schemaSql, /revoke\s+all\s+on\s+public\.subscriptions\s+from\s+public,\s*anon/i);
  assert.match(schemaSql, /revoke\s+all\s+on\s+public\.admin_license_view\s+from\s+public,\s*anon/i);
  assert.match(schemaSql, /revoke\s+all\s+on\s+public\.sync_rate_limits\s+from\s+public,\s*anon,\s*authenticated/i);

  // anon ONLY receives EXECUTE on sync_clinic_subscription
  const anonGrants = schemaSql.match(/grant\s+[^\n;]+\bto\b[^\n;]*\banon\b[^\n;]*;/gi) ?? [];
  assert.equal(
    anonGrants.length,
    1,
    `Expected anon to have exactly 1 GRANT (sync_clinic_subscription), found: ${anonGrants.join(' | ')}`,
  );
  assert.match(anonGrants[0], /sync_clinic_subscription/i);

  assert.match(schemaSql, /for\s+update\s+of\s+l/i);
  assert.match(schemaSql, /app_metadata/);
  assert.doesNotMatch(schemaSql, /user_metadata\s*->>\s*'role'/i);
  assert.match(schemaTestsSql, /ORIGIN_MISMATCH/);
  assert.match(schemaTestsSql, /rollback;\s*$/im);
});
