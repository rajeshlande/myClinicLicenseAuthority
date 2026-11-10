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
import { TIER_CONTRACT } from '../src/lib/tier-contract.mjs';

/**
 * `rajeshlande/myClinic` **v1.35.6** mirrors: `src/lib/plans.mjs:115`
 * (`CENTRAL_TIER_TO_PLAN`) and `src/lib/central-sync.mjs` (`CENTRAL_CODES`,
 * `CENTRAL_CODE_NOTES`). The companion patch shipped with contract v1
 * (CLIENT-CONTRACT-PATCH.md, contract sha256 pinned there) moves the client
 * onto the published JSON; until that lands these mirrors ARE the wire, and
 * the test below fails the moment either side drifts.
 */
const CLIENT_V1_35_6_CENTRAL_CODES = [
  'ACTIVE',
  'SUBSCRIPTION_PAUSED',
  'SUBSCRIPTION_EXPIRED',
  'SUBSCRIPTION_NOT_FOUND',
  'SEAT_LIMIT_REACHED',
  'ORIGIN_MISMATCH',
  'RATE_LIMITED',
  'INVALID_EMAIL',
  'INVALID_ORIGIN',
  'MISSING_IDENTITY',
  // Never from Central: the client adds it when a build cannot fetch at all.
  'FETCH_UNAVAILABLE',
];

// CENTRAL_CODES also carries the success verdict; it is not a refusal code.
const CLIENT_NON_REFUSAL_CODES = ['ACTIVE', 'FETCH_UNAVAILABLE'];

/** Codes the client's v1.35.6 note card carries a sentence for. */
const CLIENT_V1_35_6_NOTED_CODES = [
  'SUBSCRIPTION_NOT_FOUND',
  'ORIGIN_MISMATCH',
  'SEAT_LIMIT_REACHED',
  'SUBSCRIPTION_PAUSED',
  'SUBSCRIPTION_EXPIRED',
  'RATE_LIMITED',
  'INVALID_EMAIL',
  'INVALID_ORIGIN',
  'MISSING_IDENTITY',
  'FETCH_UNAVAILABLE',
];

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

test('the published tier contract agrees with the myClinic v1.35.6 wire mirrors', () => {
  // 1. Every contract tier maps to the plan and seats the client expects.
  for (const [tier, spec] of Object.entries(TIER_CONTRACT.tiers)) {
    assert.ok(MYCLINIC_TIER_TO_PLAN[tier], `client knows no tier ${tier}`);
    assert.equal(spec.plan, MYCLINIC_TIER_TO_PLAN[tier]);
    assert.deepEqual(
      {
        doctors: spec.doctors,
        frontdesk: spec.frontdesk,
        branches: spec.branches,
      },
      MYCLINIC_AUTHORITY_SEATS[tier],
    );
  }
  assert.deepEqual(
    Object.keys(TIER_CONTRACT.tiers).sort(),
    Object.keys(MYCLINIC_TIER_TO_PLAN).sort(),
  );

  // 2. Every refusal code the client can decode is a contract code, and the
  //    client adds exactly one verdict of its own (FETCH_UNAVAILABLE).
  const contractCodes = Object.keys(TIER_CONTRACT.refusal_codes).sort();
  const clientRefusals = CLIENT_V1_35_6_CENTRAL_CODES.filter(
    (c) => !CLIENT_NON_REFUSAL_CODES.includes(c),
  );
  for (const code of clientRefusals) {
    assert.ok(
      code in TIER_CONTRACT.refusal_codes,
      `client decodes ${code} but the contract does not define it`,
    );
  }

  // 3. The documented gaps the companion patch closes, pinned exactly: v1.35.6
  //    can neither decode nor explain SUBSCRIPTION_INACTIVE. Updating these
  //    mirrors after the client patch lands must revisit this expectation.
  const undecoded = contractCodes.filter((c) => !clientRefusals.includes(c));
  assert.deepEqual(undecoded, ['SUBSCRIPTION_INACTIVE']);
  const unnoted = contractCodes.filter(
    (code) => !CLIENT_V1_35_6_NOTED_CODES.includes(code),
  );
  assert.deepEqual(unnoted, ['SUBSCRIPTION_INACTIVE']);
});
