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
  OFFLINE_LEASE_TTL_SECONDS,
  OPD_CLINIC_ENV_VARS,
  OPD_PAGES,
  OPD_STORAGE_KEYS,
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
    '6bdf09b0b784c062f8738d8299d500e90817863b7958b9bef4da3eadbf5f0497',
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
  assert.deepEqual({ ...OPD_STORAGE_KEYS }, CONTRACT.storage_keys);
  assert.equal(WORKSPACE_SLUG_PATTERN, CONTRACT.tenant.slug_pattern);
  assert.equal(TENANT_SUPABASE_URL_PATTERN, CONTRACT.tenant.url_pattern);
  assert.equal(FORBIDDEN_TENANT_KEY_PATTERN, CONTRACT.tenant.forbidden_key_pattern);
  assert.deepEqual({ ...OPD_PAGES }, CONTRACT.pages);
  assert.deepEqual([...OPD_CLINIC_ENV_VARS], CONTRACT.env.clinic_app);
});

test('contract invariants: roles, TTLs and the single anon RPC', () => {
  assert.deepEqual([...DIRECTORY_ROLES], ['admin', 'doctor', 'staff']);
  assert.deepEqual([...CENTRAL_AUTH_ROLES], ['admin', 'clinic_user']);
  assert.equal(TENANT_TOKEN_TTL_SECONDS, 900);
  assert.ok(TENANT_TOKEN_TTL_SECONDS <= 900, 'D1\' caps tenant tokens at 15 min');
  assert.equal(OFFLINE_LEASE_TTL_SECONDS, 604800, 'the 7-day lease is untouched');
  assert.deepEqual([...DIRECTORY_ANON_RPCS], ['sync_clinic_subscription']);
  for (const claim of ['kid', 'role', 'aud', 'tenant_slug', 'workspace_id']) {
    assert.ok(TENANT_TOKEN_CLAIMS.includes(claim), `claim ${claim} present`);
  }
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
