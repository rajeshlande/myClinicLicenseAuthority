import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { SCHEMA_VERSION } from '../src/lib/version.js';

const schemaSql = readFileSync('supabase/schema.sql', 'utf8');
const schemaTestsSql = readFileSync('supabase/schema-tests.sql', 'utf8');

test('supabase/schema.sql is wrapped in one transaction and matches SCHEMA_VERSION', () => {
  assert.match(schemaSql, /^\s*begin;/im);
  assert.match(schemaSql, /commit;\s*$/im);
  assert.match(
    schemaSql,
    new RegExp(`\\(${SCHEMA_VERSION},\\s*'license-authority-core'`),
  );
});

test('every security definer function pins search_path', () => {
  const fnBlocks = schemaSql.split(/create\s+or\s+replace\s+function/i).slice(1);
  assert.ok(fnBlocks.length >= 5);
  for (const block of fnBlocks) {
    const header = block.split(/\bas\s+\$\$/i)[0] ?? '';
    if (/security\s+definer/i.test(header)) {
      assert.match(header, /set\s+search_path\s*=/i);
    }
  }
});

test('admin_license_view enforces security_invoker and RLS blocks anon + user_metadata', () => {
  assert.match(
    schemaSql,
    /create\s+or\s+replace\s+view\s+public\.admin_license_view[\s\S]*?with\s*\(\s*security_invoker\s*=\s*true\s*\)/i,
  );
  assert.match(schemaSql, /revoke\s+all\s+on\s+public\.subscriptions\s+from\s+public,\s*anon/i);
  assert.match(schemaSql, /revoke\s+all\s+on\s+public\.admin_license_view\s+from\s+public,\s*anon/i);
  assert.match(schemaSql, /for\s+update\s+of\s+l/i);
  assert.match(schemaSql, /app_metadata/);
  assert.doesNotMatch(schemaSql, /user_metadata\s*->>\s*'role'/i);
  assert.match(schemaTestsSql, /rollback;\s*$/im);
});
