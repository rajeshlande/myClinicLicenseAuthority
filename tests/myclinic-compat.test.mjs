import assert from 'node:assert/strict';
import test from 'node:test';
import {
  generateRsaKeyPairPem,
  signCapabilityJwt,
  verifyCapabilityJwt,
} from '../src/lib/crypto-rs256.mjs';
import {
  EXPECTED_TOKEN_ISSUER,
  MYCLINIC_TIER_ENTITLEMENTS,
  VALID_TIERS,
} from '../src/lib/entitlements.mjs';

/**
 * Mirrors `rajeshlande/myClinic` (`v1.20.2`, schema 18) `src/lib/authority.mjs`
 * and `supabase/functions/sync-clinic-license/index.ts` claim verification rules
 * to guarantee 100% wire-protocol compatibility between both repositories.
 */
const MYCLINIC_TIER_TO_PLAN = {
  solo: 'solo',
  standard: 'growth',
  growth: 'growth',
  chain: 'chain',
  enterprise: 'chain',
};

const MYCLINIC_AUTHORITY_SEATS = {
  solo: { doctors: 1, frontdesk: 1, branches: 1 },
  standard: { doctors: 5, frontdesk: 3, branches: 1 },
  growth: { doctors: 5, frontdesk: 3, branches: 1 },
  chain: { doctors: null, frontdesk: null, branches: null },
  enterprise: { doctors: null, frontdesk: null, branches: null },
};

test('Authority RS256 capability tokens and tier mappings match rajeshlande/myClinic v1.20+ (schema 18)', async () => {
  // 1. Every authority tier maps to the exact plan and seat limits expected by myClinic
  for (const tier of VALID_TIERS) {
    const ours = MYCLINIC_TIER_ENTITLEMENTS[tier];
    assert.ok(ours, `Missing entitlement mapping for tier ${tier}`);
    assert.equal(ours.plan, MYCLINIC_TIER_TO_PLAN[tier]);
    assert.deepEqual(
      {
        doctors: ours.doctors,
        frontdesk: ours.frontdesk,
        branches: ours.branches,
      },
      MYCLINIC_AUTHORITY_SEATS[tier],
    );
  }

  // 2. Mint a capability token shaped identically to verify-license/index.ts for sync-clinic-license
  const { privateKeyPem, publicKeyPem } = await generateRsaKeyPairPem();
  const origin = 'https://clinic.github.io';
  const fingerprint = `web:${origin}`;
  const licenseKey = '7A3F91C4082BD6E54A109F83C2D17E6B';
  const expiresAtIso = '2027-11-06T00:00:00.000Z';

  const { token } = await signCapabilityJwt(
    {
      sub: '11111111-2222-3333-4444-555555555555',
      license_key: licenseKey,
      tier: 'growth',
      machine_fingerprint: fingerprint,
      allowed_origin: origin,
      max_machines: 2,
      subscription_expires_at: expiresAtIso,
    },
    privateKeyPem,
  );

  const verified = await verifyCapabilityJwt(token, publicKeyPem, {
    expectedFingerprint: fingerprint,
    expectedLicenseKey: licenseKey,
    expectedOrigin: origin,
  });

  assert.equal(verified.valid, true);
  assert.equal(verified.claims.iss, EXPECTED_TOKEN_ISSUER);
  assert.equal(verified.claims.machine_fingerprint, 'web:https://clinic.github.io');
  assert.equal(verified.claims.allowed_origin, 'https://clinic.github.io');
  assert.equal(verified.claims.license_key, licenseKey);
  assert.equal(verified.claims.subscription_expires_at, expiresAtIso);
  assert.ok(
    !Number.isNaN(new Date(verified.claims.subscription_expires_at).getTime()),
    'subscription_expires_at must parse cleanly for apply_authority_license()',
  );
});
