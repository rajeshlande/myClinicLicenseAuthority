import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bytesToBase64Url,
  generateRsaKeyPairPem,
  signCapabilityJwt,
  verifyCapabilityJwt,
} from '../src/lib/crypto-rs256.mjs';

test('WebCrypto RS256 keypair signs and verifies 7-day capability tokens offline', async () => {
  const { privateKeyPem, publicKeyPem } = await generateRsaKeyPairPem();
  const nowSeconds = 1_790_000_000;

  const { token } = await signCapabilityJwt(
    {
      license_key: 'ABCDEF0123456789ABCDEF0123456789',
      tier: 'growth',
      machine_fingerprint: 'node_clinic_01',
    },
    privateKeyPem,
    { nowSeconds },
  );

  const valid = await verifyCapabilityJwt(token, publicKeyPem, {
    nowSeconds: nowSeconds + 3600,
    expectedFingerprint: 'node_clinic_01',
    expectedLicenseKey: 'abcdef0123456789abcdef0123456789',
  });
  assert.equal(valid.valid, true);
  assert.equal(valid.claims.tier, 'growth');

  // Expired after 8 days
  const expired = await verifyCapabilityJwt(token, publicKeyPem, {
    nowSeconds: nowSeconds + 86400 * 8,
  });
  assert.equal(expired.valid, false);
  assert.equal(expired.code, 'CAPABILITY_TOKEN_EXPIRED');

  // Hardware mismatch
  const wrongHost = await verifyCapabilityJwt(token, publicKeyPem, {
    nowSeconds: nowSeconds + 60,
    expectedFingerprint: 'node_other_machine',
  });
  assert.equal(wrongHost.valid, false);
  assert.equal(wrongHost.code, 'HARDWARE_FINGERPRINT_MISMATCH');
});

test('verifyCapabilityJwt rejects alg:none downgrade tokens', async () => {
  const { publicKeyPem } = await generateRsaKeyPairPem();
  const enc = new TextEncoder();
  const noneHeader = bytesToBase64Url(
    enc.encode(JSON.stringify({ alg: 'none', typ: 'JWT' })),
  );
  const body = bytesToBase64Url(
    enc.encode(
      JSON.stringify({
        iss: 'myclinic-license-authority',
        tier: 'chain',
        exp: 9_999_999_999,
      }),
    ),
  );

  const res = await verifyCapabilityJwt(`${noneHeader}.${body}.`, publicKeyPem);
  assert.equal(res.valid, false);
  assert.equal(res.code, 'UNSUPPORTED_ALGORITHM');
});
