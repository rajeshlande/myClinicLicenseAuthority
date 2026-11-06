import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectSupabaseConfig } from '../src/lib/health.mjs';

function buildFakeJwtWithRole(role) {
  const toB64Url = (obj) =>
    Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  return `${toB64Url({ alg: 'HS256' })}.${toB64Url({ role })}.sig`;
}

test('inspectSupabaseConfig reports unconfigured when unset and accepts both url/anonKey and VITE_ env keys', () => {
  const unset = inspectSupabaseConfig({});
  assert.equal(unset.ok, false);
  assert.equal(unset.mode, 'unconfigured');

  const cloudDirect = inspectSupabaseConfig({
    url: 'https://projref123.supabase.co/',
    anonKey: 'sb_publishable_safe_public_key_value',
  });
  assert.equal(cloudDirect.ok, true);
  assert.equal(cloudDirect.mode, 'cloud');
  assert.equal(cloudDirect.url, 'https://projref123.supabase.co');

  const cloudViteEnv = inspectSupabaseConfig({
    VITE_SUPABASE_URL: 'https://projref456.supabase.co/',
    VITE_SUPABASE_ANON_KEY: 'sb_publishable_vite_env_public_key',
  });
  assert.equal(cloudViteEnv.ok, true);
  assert.equal(cloudViteEnv.mode, 'cloud');
  assert.equal(cloudViteEnv.url, 'https://projref456.supabase.co');
});

test('inspectSupabaseConfig refuses placeholder URLs and privileged secret keys', () => {
  const placeholder = inspectSupabaseConfig({
    url: 'https://YOUR-PROJECT.supabase.co',
    anonKey: 'sb_publishable_123',
  });
  assert.equal(placeholder.ok, false);

  const sbSecret = inspectSupabaseConfig({
    url: 'https://projref123.supabase.co',
    anonKey: ['sb', 'secret', 'privileged_value_0000000000'].join('_'),
  });
  assert.equal(sbSecret.ok, false);
  assert.equal(sbSecret.mode, 'forbidden-secret');

  const serviceJwt = inspectSupabaseConfig({
    url: 'https://projref123.supabase.co',
    anonKey: buildFakeJwtWithRole('service_role'),
  });
  assert.equal(serviceJwt.ok, false);
  assert.equal(serviceJwt.mode, 'forbidden-secret');
});
