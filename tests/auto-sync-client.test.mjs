import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertPublishableAnonKey,
  buildCentralPostgrestHeaders,
  buildMyClinicAutoSyncKit,
  normalizeClinicEmail,
  normalizeClinicOrigin,
  probeCentralAutoSync,
  readCachedCentralLease,
  startCentralAutoSync,
  syncCentralSubscription,
} from '../src/lib/auto-sync-client.mjs';

function makeMemoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

function makeFakeJwtWithRole(role) {
  const toB64 = (obj) =>
    Buffer.from(JSON.stringify(obj)).toString('base64url');
  return [toB64({ alg: 'HS256', typ: 'JWT' }), toB64({ role }), 'sigpart'].join(
    '.',
  );
}

test('assertPublishableAnonKey blocks sb_secret_ and service_role keys while allowing publishable/anon keys', () => {
  const sbSecret = ['sb_', 'secret_', '1234567890abcdefghij'].join('');
  assert.throws(
    () => assertPublishableAnonKey(sbSecret),
    (err) => err.code === 'CENTRAL_SECRET_KEY_BLOCKED',
  );

  const serviceRoleJwt = makeFakeJwtWithRole('service_role');
  assert.throws(
    () => assertPublishableAnonKey(serviceRoleJwt),
    (err) => err.code === 'CENTRAL_SECRET_KEY_BLOCKED',
  );

  const publishable = 'sb_publishable_demo_safe_key';
  assert.equal(assertPublishableAnonKey(publishable), publishable);

  const anonJwt = makeFakeJwtWithRole('anon');
  assert.equal(assertPublishableAnonKey(anonJwt), anonJwt);
});

test('normalizeClinicOrigin and buildCentralPostgrestHeaders isolate cross-Supabase credentials', () => {
  assert.equal(
    normalizeClinicOrigin('https://RajeshLande.github.io/myClinic/?tab=1'),
    'https://rajeshlande.github.io',
  );
  assert.equal(normalizeClinicOrigin('ftp://invalid.example.com'), '');
  assert.equal(normalizeClinicEmail('  Dr.Sharma@Clinic.IN '), 'dr.sharma@clinic.in');
  assert.equal(normalizeClinicEmail('not-an-email'), '');

  const pubHeaders = buildCentralPostgrestHeaders('sb_publishable_abc123');
  assert.equal(pubHeaders.apikey, 'sb_publishable_abc123');
  assert.equal(pubHeaders.Authorization, undefined);

  const anonJwt = makeFakeJwtWithRole('anon');
  const legacyHeaders = buildCentralPostgrestHeaders(anonJwt);
  assert.equal(legacyHeaders.apikey, anonJwt);
  assert.equal(legacyHeaders.Authorization, `Bearer ${anonJwt}`);
});

test('syncCentralSubscription seals active lease, survives 7-day offline outage, blocks tampering, and wipes on central pause', async () => {
  const storage = makeMemoryStorage();
  const now = new Date('2026-11-06T12:00:00.000Z');
  const centralUrl = 'https://centralref.supabase.co';
  const centralAnonKey = 'sb_publishable_demo';

  // 1. Online active sync (Email + URL matched)
  const live = await syncCentralSubscription({
    centralUrl,
    centralAnonKey,
    email: 'owner@sharmaclinic.in',
    origin: 'https://sharmaclinic.github.io/myClinic/',
    deviceId: 'clinic-node-1',
    storage,
    now,
    fetchImpl: async (url, opts) => {
      assert.equal(url, 'https://centralref.supabase.co/rest/v1/rpc/sync_clinic_subscription');
      const sent = JSON.parse(opts.body);
      assert.equal(sent.p_email, 'owner@sharmaclinic.in');
      assert.equal(sent.p_origin, 'https://sharmaclinic.github.io');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          allowed: true,
          status: 'active',
          code: 'ACTIVE',
          tier: 'growth',
          plan: 'growth',
          doctors: 5,
          frontdesk: 3,
          branches: 1,
          expires_at: '2027-11-06T23:59:59.000Z',
          grace_until: '2026-11-13T12:00:00.000Z',
          match_mode: 'email+url',
        }),
      };
    },
  });
  assert.equal(live.allowed, true);
  assert.equal(live.source, 'central_live');
  assert.equal(live.tier, 'growth');

  // 2. Network outage 2 days later -> falls back to SHA-256 sealed offline lease
  const offline = await syncCentralSubscription({
    centralUrl,
    centralAnonKey,
    email: 'owner@sharmaclinic.in',
    origin: 'https://sharmaclinic.github.io',
    deviceId: 'clinic-node-1',
    storage,
    now: new Date('2026-11-08T12:00:00.000Z'),
    fetchImpl: async () => {
      throw new TypeError('Failed to fetch');
    },
  });
  assert.equal(offline.allowed, true);
  assert.equal(offline.source, 'offline_cache');
  assert.equal(offline.plan, 'growth');

  // 3. DevTools localStorage tampering (`tier: "enterprise"`) -> seal breaks & wipes cache
  const rawSaved = JSON.parse(storage.getItem('myclinic.central.subscription.v2'));
  rawSaved.lease.tier = 'enterprise';
  rawSaved.lease.plan = 'chain';
  storage.setItem('myclinic.central.subscription.v2', JSON.stringify(rawSaved));

  const tampered = await readCachedCentralLease({
    origin: 'https://sharmaclinic.github.io',
    email: 'owner@sharmaclinic.in',
    deviceId: 'clinic-node-1',
    storage,
    now: new Date('2026-11-08T13:00:00.000Z'),
  });
  assert.equal(tampered.allowed, false);
  assert.equal(tampered.code, 'CACHE_TAMPERED');

  // 4. Re-sync active, then Central Admin clicks Pause -> cache wiped immediately
  await syncCentralSubscription({
    centralUrl,
    centralAnonKey,
    email: 'owner@sharmaclinic.in',
    origin: 'https://sharmaclinic.github.io',
    deviceId: 'clinic-node-1',
    storage,
    now,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        allowed: true,
        status: 'active',
        tier: 'growth',
        plan: 'growth',
        doctors: 5,
        frontdesk: 3,
        branches: 1,
        expires_at: '2027-11-06T23:59:59.000Z',
        grace_until: '2026-11-13T12:00:00.000Z',
      }),
    }),
  });

  const paused = await syncCentralSubscription({
    centralUrl,
    centralAnonKey,
    email: 'owner@sharmaclinic.in',
    origin: 'https://sharmaclinic.github.io',
    deviceId: 'clinic-node-1',
    storage,
    now,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        allowed: false,
        status: 'paused',
        code: 'SUBSCRIPTION_PAUSED',
        tier: 'solo',
        reason: 'Subscription is paused by the administrator.',
      }),
    }),
  });
  assert.equal(paused.allowed, false);
  assert.equal(paused.code, 'SUBSCRIPTION_PAUSED');
  assert.equal(storage.getItem('myclinic.central.subscription.v2'), null);
});

test('probeCentralAutoSync, startCentralAutoSync, and buildMyClinicAutoSyncKit work cleanly', async () => {
  await assert.rejects(
    () =>
      probeCentralAutoSync('https://centralref.supabase.co', 'sb_publishable_demo', {
        fetchImpl: async () => ({
          ok: false,
          status: 404,
          json: async () => ({ code: 'PGRST202' }),
        }),
      }),
    (err) => err.code === 'SCHEMA_V2_REQUIRED',
  );

  const probeOk = await probeCentralAutoSync(
    'https://centralref.supabase.co',
    'sb_publishable_demo',
    {
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, sync_ready: true, schema_version: 2 }),
      }),
    },
  );
  assert.equal(probeOk.ok, true);
  assert.equal(probeOk.schemaVersion, 2);

  const updates = [];
  const stop = startCentralAutoSync({
    centralUrl: 'https://centralref.supabase.co',
    centralAnonKey: 'sb_publishable_demo',
    getEmail: () => '',
    getOrigin: () => 'https://urlclinic.github.io',
    onUpdate: (v) => updates.push(v),
    intervalMs: 60_000,
    storage: makeMemoryStorage(),
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        allowed: true,
        status: 'active',
        tier: 'chain',
        plan: 'chain',
        expires_at: '2027-11-06T23:59:59.000Z',
        grace_until: '2026-11-13T12:00:00.000Z',
      }),
    }),
  });

  await new Promise((r) => setTimeout(r, 20));
  stop();
  assert.equal(updates.length, 1);
  assert.equal(updates[0].allowed, true);

  const kit = buildMyClinicAutoSyncKit({
    centralUrl: 'https://centralref.supabase.co/',
    centralAnonKey: 'sb_publishable_demo',
  });
  assert.match(kit.envVars, /VITE_CENTRAL_SUPABASE_URL="https:\/\/centralref\.supabase\.co"/);
  assert.match(kit.clientModule, /sync_clinic_subscription/);
  assert.match(kit.viteObfuscatorSnippet, /JavaScriptObfuscator/);
});
