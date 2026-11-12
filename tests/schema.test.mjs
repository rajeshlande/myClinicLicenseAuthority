import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { SCHEMA_VERSION } from '../src/lib/version.js';

const schemaSql = readFileSync('supabase/schema.sql', 'utf8');
const schemaTestsSql = readFileSync('supabase/schema-tests.sql', 'utf8');

test('supabase/schema.sql is wrapped in one transaction and matches SCHEMA_VERSION', () => {
  assert.equal(SCHEMA_VERSION, 6);
  assert.match(schemaSql, /^\s*begin;/im);
  assert.match(schemaSql, /commit;\s*$/im);
  assert.match(schemaSql, /\(2,\s*'keyless-auto-sync-core'/);
  assert.match(schemaSql, /\(3,\s*'refused-attempt-audit'/);
  assert.match(schemaSql, /\(4,\s*'activity-log-and-invoices'/);
  assert.match(schemaSql, /\(5,\s*'workspace-directory'/);
  assert.match(schemaSql, /\(6,\s*'tenant-connection-and-keep-warm'/);
  assert.match(
    schemaSql,
    new RegExp(`greatest\\(schema_version,\\s*${SCHEMA_VERSION}\\)`),
  );
  // The readiness probe answers with the same version the app advertises.
  assert.match(
    schemaSql,
    new RegExp(`'schema_version',\\s*${SCHEMA_VERSION},`),
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
    'sync_attempts',
    'clinic_activity_log',
    'invoices',
    'workspaces',
    'workspace_members',
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
  assert.match(schemaSql, /revoke\s+all\s+on\s+public\.sync_attempts\s+from\s+public,\s*anon/i);

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

test('schema v4: activity log + invoices are FORCE RLS, admin-only and append-only', () => {
  // Both tables carry enable AND force RLS (asserted in the loop above); here
  // the grant surface: anon revoked entirely, authenticated never gets
  // update/delete on the append-only timeline.
  assert.match(schemaSql, /revoke\s+all\s+on\s+public\.clinic_activity_log\s+from\s+public,\s*anon/i);
  assert.match(schemaSql, /revoke\s+all\s+on\s+public\.invoices\s+from\s+public,\s*anon/i);
  assert.match(schemaSql, /grant\s+select,\s*insert\s+on\s+public\.clinic_activity_log\s+to\s+authenticated/i);
  assert.match(
    schemaSql,
    /revoke\s+update,\s*delete\s+on\s+public\.clinic_activity_log\s+from\s+authenticated/i,
    'default-privilege ALL grants must be closed back down to append-only',
  );
  assert.doesNotMatch(
    schemaSql,
    /grant\s+[^;\n]*(update|delete)\s+on\s+public\.clinic_activity_log/i,
    'the operational timeline must stay append-only for every role',
  );
  assert.doesNotMatch(
    schemaSql,
    /create\s+policy\s+\w+\s+on\s+public\.clinic_activity_log\s+for\s+(update|delete|all)/i,
    'no policy may open the timeline to mutation',
  );

  // Event vocabulary is closed and covers every console mutation.
  for (const kind of [
    'onboarded',
    'paused',
    'resumed',
    'renewed',
    'tier_changed',
    'routing_changed',
    'payment_received',
    'invoice_issued',
    'invoice_paid',
    'invoice_void',
    'notes_changed',
  ]) {
    assert.match(schemaSql, new RegExp(`'${kind}'`));
  }

  // Invoice document invariants: closed status set, numeric totals, jsonb items.
  assert.match(schemaSql, /check\s*\(status\s+in\s*\('draft',\s*'issued',\s*'paid',\s*'void'\)\)/i);
  assert.match(schemaSql, /line_items\s+jsonb\s+not\s+null/i);
  assert.match(schemaSql, /tax_rate\s+numeric\(5,\s*4\)/i);

  // The flattened view exposes the billing standing columns (appended last).
  for (const col of [
    'latest_invoice_number',
    'latest_invoice_status',
    'latest_invoice_total',
    'open_invoice_count',
  ]) {
    assert.match(schemaSql, new RegExp(`\\)\\s+as\\s+${col}\\b`));
  }

  // The PG suite proves it live (section 8).
  assert.match(schemaTestsSql, /--\s*8\./);
  assert.match(schemaTestsSql, /clinic_activity_log/);
  assert.match(schemaTestsSql, /append-only/i);
});

test('schema v5: workspace directory is member-read, admin-write, anon-dark', () => {
  // anon is revoked entirely on both directory tables; the single-anon-RPC
  // invariant (asserted above) is untouched by v5.
  assert.match(schemaSql, /revoke\s+all\s+on\s+public\.workspaces\s+from\s+public,\s*anon/i);
  assert.match(schemaSql, /revoke\s+all\s+on\s+public\.workspace_members\s+from\s+public,\s*anon/i);
  assert.match(schemaSql, /grant\s+select\s+on\s+public\.workspaces\s+to\s+authenticated/i);
  assert.match(schemaSql, /grant\s+select\s+on\s+public\.workspace_members\s+to\s+authenticated/i);

  // Discovery is authenticated-only: execute granted to authenticated, never anon.
  assert.match(schemaSql, /grant\s+execute\s+on\s+function\s+public\.my_workspaces\(\)\s+to\s+authenticated/i);
  assert.doesNotMatch(
    schemaSql,
    /grant\s+execute\s+on\s+function\s+public\.my_workspaces\(\)[^;]*\banon\b/i,
  );

  // Connection columns carry the same privileged-key CHECK as the contract.
  assert.match(schemaSql, /supabase_anon_key\s+!~\*\s*'service_role\|sb_secret'/i);
  assert.match(schemaSql, /check\s*\(role\s+in\s*\('admin',\s*'doctor',\s*'staff'\)\)/i);

  // Membership RLS: members read their own row, writes are admin-only.
  assert.match(schemaSql, /using\s*\(public\.is_workspace_member\(id\)\s+or\s+public\.is_license_admin\(\)\)/i);
  assert.match(schemaSql, /using\s*\(user_id\s*=\s*auth\.uid\(\)\s+or\s+public\.is_license_admin\(\)\)/i);

  // The PG suite proves the matrix live (section 9).
  assert.match(schemaTestsSql, /anon denied read on public\.workspaces/);
  assert.match(schemaTestsSql, /member discovery returns exactly one active workspace/);
});

test('schema v6: keep-warm is admin-only, contract-cadenced and cron-guarded', () => {
  // The console may list and stamp; the fleet-wide cycle belongs to pg_cron.
  assert.match(
    schemaSql,
    /grant\s+execute\s+on\s+function\s+public\.due_keep_warm_workspaces\(integer\)\s+to\s+authenticated/i,
  );
  assert.match(
    schemaSql,
    /grant\s+execute\s+on\s+function\s+public\.stamp_keep_warm\(uuid,\s*boolean\)\s+to\s+authenticated/i,
  );
  assert.match(
    schemaSql,
    /revoke\s+all\s+on\s+function\s+public\.run_keep_warm_cycle\(integer\)\s+from\s+public,\s*anon,\s*authenticated/i,
  );

  // pg_cron + pg_net are OPTIONAL: the file must still apply without them.
  assert.match(schemaSql, /from pg_extension where extname = 'pg_cron'/i);
  assert.match(schemaSql, /from pg_extension where extname = 'pg_net'/i);
  assert.match(schemaSql, /cron\.schedule\(/i);

  // A failed probe must never be recorded as warmth.
  assert.match(schemaSql, /p_ok boolean default true/i);
  assert.match(
    schemaSql,
    /if v_ok then\s+update public\.workspaces\s+set keep_warm_at = now\(\)/i,
  );

  // The view hand-off: §6 stands aside once §8 owns the definition, because
  // CREATE OR REPLACE VIEW may never drop columns (the re-apply trap).
  assert.match(schemaSql, /do \$viewv4\$/);
  assert.match(schemaSql, /column_name = 'workspace_id'/);
  assert.match(schemaSql, /w\.keep_warm_at as workspace_keep_warm_at/i);

  // The PG suite proves the matrix live (section 11).
  assert.match(schemaTestsSql, /--\s*11\./);
  assert.match(schemaTestsSql, /run_keep_warm_cycle belongs to the database/);
  assert.match(schemaTestsSql, /a failed probe stamped the workspace warm/);
});
