import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import {
  CENTRAL_AUTH_ROLES,
  DIRECTORY_ANON_RPCS,
  DIRECTORY_CONTRACT_VERSION,
  DIRECTORY_DISCOVERY_RPC,
  DIRECTORY_ROLES,
  FORBIDDEN_TENANT_KEY_PATTERN,
  KEEP_WARM,
  TENANT_CLINICAL_PROBE_TABLE,
  TENANT_REST_ROOT,
  TENANT_VERSION_PROBE,
  OFFLINE_LEASE_TTL_SECONDS,
  OPD_CLINIC_ENV_VARS,
  OPD_PAGES,
  OPD_STORAGE_KEYS,
  SYNC_RESPONSE_WORKSPACE,
  TENANT_SCHEMA_VERSION,
  TENANT_SUPABASE_URL_PATTERN,
  TENANT_TOKEN_CLAIMS,
  TENANT_TOKEN_TTL_SECONDS,
  WORKSPACE_SLUG_PATTERN,
} from '../src/lib/workspace-directory.mjs';

const RAW = readFileSync(new URL('../contract/workspace-directory-contract.json', import.meta.url));
const CONTRACT = JSON.parse(RAW.toString('utf8'));

test('the directory contract byte-pin matches the shipped file', () => {
  assert.equal(
    createHash('sha256').update(RAW).digest('hex'),
    'ef3601ce1a68345f4ca8389790fcb7168640d26dff92b61dfc634c84fab5b59c',
  );
});

test('the generated view equals the contract file', () => {
  assert.equal(DIRECTORY_CONTRACT_VERSION, CONTRACT.version);
  assert.deepEqual([...DIRECTORY_ROLES], CONTRACT.roles.workspace_member);
  assert.deepEqual([...CENTRAL_AUTH_ROLES], CONTRACT.roles.central_auth_metadata);
  assert.equal(TENANT_SCHEMA_VERSION, CONTRACT.tenant.schema_version);
  assert.equal(TENANT_TOKEN_TTL_SECONDS, CONTRACT.auth.tenant_token_ttl_seconds);
  assert.equal(OFFLINE_LEASE_TTL_SECONDS, CONTRACT.auth.offline_lease_ttl_seconds);
  assert.deepEqual([...TENANT_TOKEN_CLAIMS], CONTRACT.auth.claims);
  assert.deepEqual([...DIRECTORY_ANON_RPCS], CONTRACT.rpc.anon_only);
  assert.equal(DIRECTORY_DISCOVERY_RPC, CONTRACT.rpc.authenticated_discovery);
  assert.deepEqual(
    { ...SYNC_RESPONSE_WORKSPACE, fields: [...SYNC_RESPONSE_WORKSPACE.fields] },
    CONTRACT.rpc.sync_response_workspace,
  );
  assert.deepEqual({ ...OPD_STORAGE_KEYS }, CONTRACT.storage_keys);
  assert.equal(WORKSPACE_SLUG_PATTERN, CONTRACT.tenant.slug_pattern);
  assert.equal(TENANT_SUPABASE_URL_PATTERN, CONTRACT.tenant.url_pattern);
  assert.equal(FORBIDDEN_TENANT_KEY_PATTERN, CONTRACT.tenant.forbidden_key_pattern);
  assert.deepEqual({ ...OPD_PAGES }, CONTRACT.pages);
  assert.deepEqual([...OPD_CLINIC_ENV_VARS], CONTRACT.env.clinic_app);
  assert.equal(TENANT_REST_ROOT, CONTRACT.tenant.rest_root);
  assert.deepEqual({ ...TENANT_VERSION_PROBE }, CONTRACT.tenant.version_probe);
  assert.equal(
    TENANT_CLINICAL_PROBE_TABLE,
    CONTRACT.tenant.clinical_probe_table,
  );
  assert.deepEqual({ ...KEEP_WARM }, CONTRACT.keep_warm);
});

test('contract invariants: roles, TTLs and the single anon RPC', () => {
  assert.deepEqual([...DIRECTORY_ROLES], ['admin', 'doctor', 'staff']);
  assert.deepEqual([...CENTRAL_AUTH_ROLES], ['admin', 'clinic_user']);
  assert.equal(TENANT_TOKEN_TTL_SECONDS, 900);
  assert.ok(TENANT_TOKEN_TTL_SECONDS <= 900, 'D1\' caps tenant tokens at 15 min');
  assert.equal(OFFLINE_LEASE_TTL_SECONDS, 604800, 'the 7-day lease is untouched');
  assert.deepEqual([...DIRECTORY_ANON_RPCS], ['sync_clinic_subscription']);
  // The pointer rides the anon RPC and goes dark when the workspace is inactive.
  assert.equal(SYNC_RESPONSE_WORKSPACE.key, 'workspace');
  assert.deepEqual([...SYNC_RESPONSE_WORKSPACE.fields], [
    'slug',
    'supabase_url',
    'supabase_anon_key',
    'tenant_schema_version',
  ]);
  assert.match(SYNC_RESPONSE_WORKSPACE.null_when, /is_inactive/);
  for (const claim of ['kid', 'role', 'aud', 'tenant_slug', 'workspace_id']) {
    assert.ok(TENANT_TOKEN_CLAIMS.includes(claim), `claim ${claim} present`);
  }
});

test('contract v3 invariants: the tenant probe and the keep-warm cadence', () => {
  // The Connection step's 5-point check reads the tenant version through an
  // RPC anon may execute; if a tenant ever locks that down the check must
  // change here, in the contract, not silently in the wizard.
  assert.equal(TENANT_VERSION_PROBE.rpc, 'app_schema_version');
  assert.equal(TENANT_VERSION_PROBE.anon_executable, true);
  assert.equal(TENANT_VERSION_PROBE.path, '/rest/v1/rpc/app_schema_version');
  assert.equal(TENANT_REST_ROOT, '/rest/v1/');
  assert.equal(TENANT_CLINICAL_PROBE_TABLE, 'patients');

  // Free tier pauses after 7 idle days, so the probe target must stay strictly
  // inside that window with margin to spare.
  assert.equal(KEEP_WARM.pause_days, 7);
  assert.equal(KEEP_WARM.target_days, 5);
  assert.ok(
    KEEP_WARM.target_days < KEEP_WARM.pause_days,
    'keep-warm target must be shorter than the free-tier pause window',
  );
  assert.equal(KEEP_WARM.stamp_column, 'keep_warm_at');
  assert.equal(KEEP_WARM.probe_path, '/rest/v1/');
  assert.equal(KEEP_WARM.cron_schedule, '17 */6 * * *');
});

test('definition-site scan: storage keys live only in the contract view', () => {
  const walk = (dir) =>
    readdirSync(dir).flatMap((entry) => {
      const path = `${dir}/${entry}`;
      return statSync(path).isDirectory() ? walk(path) : [path];
    });
  const offenders = walk(new URL('../src', import.meta.url).pathname).filter(
    (file) =>
      !file.endsWith('workspace-directory.mjs') &&
      /opd\.(active\.workspace|last\.workspace|admin\.master\.auth|clinic\.master\.auth)/.test(
        readFileSync(file, 'utf8'),
      ),
  );
  assert.deepEqual(offenders, [], 'storage-key literals outside the contract view');
});

test('sync_clinic_subscription is still the only RPC granted to anon', () => {
  const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
  const grants = [...schema.matchAll(/grant execute on function public\.([a-z_]+)\([^)]*\) to anon/gm)]
    .map((m) => m[1]);
  assert.deepEqual(grants, ['sync_clinic_subscription']);
});
