import assert from 'node:assert/strict';
import test from 'node:test';
import {
  generateRsaKeyPairPem,
  signCapabilityJwt,
} from '../src/lib/crypto-rs256.mjs';
import {
  buildPagesFingerprint,
  syncPagesLicense,
  verifyCachedPagesLicense,
} from '../src/lib/pages-client-validator.mjs';

function createMemoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

test('GitHub Pages WebCrypto validator enforces RS256 signature, Origin lock, and offline fallback', async () => {
  const { privateKeyPem, publicKeyPem } = await generateRsaKeyPairPem();
  const storage = createMemoryStorage();
  const origin = 'https://cityclinic.github.io';
  const clinicId = 'clinic-mum-01';
  const licenseKey = '7A3F91C4082BD6E54A109F83C2D17E6B';
  const nowSeconds = 1_793_000_000;

  const expectedFp = buildPagesFingerprint({ origin, clinicId });
  assert.equal(expectedFp, 'web:https://cityclinic.github.io|clinic-mum-01');

  const onlineFetch = async (_url, init) => {
    const reqBody = JSON.parse(init.body);
    const { token } = await signCapabilityJwt(
      {
        sub: 'sub-pages-01',
        license_key: reqBody.license_key,
        tier: 'growth',
        machine_fingerprint: reqBody.machine_fingerprint,
        allowed_origin: origin,
        subscription_expires_at: '2027-11-06T00:00:00.000Z',
      },
      privateKeyPem,
      { nowSeconds },
    );
    return {
      ok: true,
      status: 200,
      json: async () => ({ token }),
    };
  };

  // 1. Online sync stores verified token & maps to myClinic 'growth' plan
  const synced = await syncPagesLicense({
    verifyUrl: 'https://authority.supabase.co/functions/v1/verify-license',
    licenseKey,
    publicKeyPem,
    origin,
    clinicId,
    storage,
    fetchImpl: onlineFetch,
    nowSeconds,
  });
  assert.equal(synced.valid, true);
  assert.equal(synced.myClinicLicense.plan, 'growth');
  assert.equal(synced.entitlements.doctors, 5);

  // 2. Offline clinic fallback keeps working inside 7-day window
  const offline = await syncPagesLicense({
    verifyUrl: 'https://authority.supabase.co/functions/v1/verify-license',
    licenseKey,
    publicKeyPem,
    origin,
    clinicId,
    storage,
    fetchImpl: async () => {
      throw new Error('Network unreachable');
    },
    nowSeconds: nowSeconds + 86400 * 2,
  });
  assert.equal(offline.valid, true);
  assert.match(offline.syncWarning, /Network unreachable/);

  // 3. Cloning cached token onto a different GitHub Pages domain fails immediately
  const cloned = await verifyCachedPagesLicense({
    publicKeyPem,
    licenseKey,
    origin: 'https://pirate-copy.github.io',
    clinicId,
    storage,
    nowSeconds: nowSeconds + 60,
  });
  assert.equal(cloned.valid, false);
  assert.equal(cloned.myClinicLicense.status, 'expired');
});
