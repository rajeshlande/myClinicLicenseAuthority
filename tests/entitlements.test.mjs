import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MYCLINIC_TIER_ENTITLEMENTS,
  buildDockerComposeConfig,
  buildMyClinicCloudSetup,
  computeFleetMetrics,
  computeStanding,
  describeClinicIdentity,
  normalizeAllowedOriginInput,
  sanitizeCsvCell,
  validateProvisionInput,
  validateRoutingUpdateInput,
} from '../src/lib/entitlements.mjs';

test('validateProvisionInput supports Email-only, URL-only, and Dual Email+URL routing', () => {
  // 1. Email + URL together (normalizes GitHub Pages path to origin)
  const dual = validateProvisionInput({
    customerEmail: '  Dr.Rao@Clinic.IN ',
    allowedOrigin: 'https://RaoClinic.github.io/myClinic/',
    lockFirstOrigin: false,
    tier: 'growth',
    maxMachines: 3,
    expiresDate: '2027-12-31',
    notes: '**PO#:** `PO-101`',
  });
  assert.equal(dual.ok, true);
  assert.equal(dual.payload.p_customer_email, 'dr.rao@clinic.in');
  assert.equal(dual.payload.p_allowed_origin, 'https://raoclinic.github.io');
  assert.equal(dual.payload.p_tier, 'growth');
  assert.equal(dual.payload.p_max_machines, 3);

  // 2. URL-only (customerEmail omitted)
  const urlOnly = validateProvisionInput({
    customerEmail: '',
    allowedOrigin: 'https://urlclinic.github.io',
    tier: 'chain',
    maxMachines: 1,
    expiresDate: '2027-12-31',
  });
  assert.equal(urlOnly.ok, true);
  assert.equal(urlOnly.payload.p_customer_email, null);
  assert.equal(urlOnly.payload.p_allowed_origin, 'https://urlclinic.github.io');

  // 3. Reject when BOTH email and URL are empty
  assert.equal(
    validateProvisionInput({
      customerEmail: '',
      allowedOrigin: '',
      tier: 'solo',
      maxMachines: 1,
      expiresDate: '2027-12-31',
    }).ok,
    false,
  );

  // 4. Reject malformed email or non-http(s) URL
  assert.equal(normalizeAllowedOriginInput('ftp://bad.example.com').ok, false);
  assert.equal(
    describeClinicIdentity({
      customer_email: 'dr.rao@clinic.in',
      allowed_origin: 'https://raoclinic.github.io',
    }).mode,
    'email+url',
  );
  assert.equal(
    validateRoutingUpdateInput({
      subscriptionId: '00000000-0000-0000-0000-000000000001',
      customerEmail: '',
      allowedOrigin: 'https://raoclinic.github.io/',
    }).ok,
    true,
  );

  assert.equal(
    validateProvisionInput({
      customerEmail: 'bad-email',
      tier: 'solo',
      maxMachines: 1,
      expiresDate: '2027-12-31',
    }).ok,
    false,
  );

  assert.equal(
    validateProvisionInput({
      customerEmail: 'valid@clinic.in',
      tier: 'unknown-tier',
      maxMachines: 1,
      expiresDate: '2027-12-31',
    }).ok,
    false,
  );
});

test('computeStanding and computeFleetMetrics track active, killed, and expiring nodes', () => {
  const now = new Date('2026-11-06T00:00:00.000Z');
  const rows = [
    {
      is_active: true,
      status: 'active',
      registered_machines: 2,
      max_machines: 5,
      expires_at: '2026-11-12T00:00:00.000Z',
    },
    {
      is_active: false,
      status: 'active',
      registered_machines: 1,
      max_machines: 2,
      expires_at: '2027-05-01T00:00:00.000Z',
    },
  ];

  const first = computeStanding(rows[0], now);
  assert.equal(first.isOperational, true);
  assert.equal(first.label, 'Active');
  assert.equal(first.usagePct, 40);
  assert.equal(first.daysLeft, 6);

  const second = computeStanding(rows[1], now);
  assert.equal(second.isOperational, false);
  assert.equal(second.stateCode, 'KEY_KILLED');
  assert.equal(second.label, 'Killed');

  const fleet = computeFleetMetrics(rows, now);
  assert.equal(fleet.total, 2);
  assert.equal(fleet.activeCount, 1);
  assert.equal(fleet.revokedOrExpiredCount, 1);
  assert.equal(fleet.expiringSoonCount, 1);
  assert.equal(fleet.totalRegisteredNodes, 3);
  assert.equal(fleet.totalCapacityNodes, 7);
});

test('MYCLINIC_TIER_ENTITLEMENTS and Docker Compose generator match myClinic plans', () => {
  assert.equal(MYCLINIC_TIER_ENTITLEMENTS.solo.doctors, 1);
  assert.equal(MYCLINIC_TIER_ENTITLEMENTS.growth.doctors, 5);
  assert.equal(MYCLINIC_TIER_ENTITLEMENTS.chain.doctors, null);

  const yaml = buildDockerComposeConfig({
    licenseKey: 'ABCD1234',
    verifyUrl: 'https://demo.supabase.co/functions/v1/verify-license',
    publicKeyEscaped: 'PUBKEY',
    hostPort: 9090,
  });
  assert.match(yaml, /"9090:4000"/);
  assert.match(yaml, /LICENSE_KEY: "ABCD1234"/);
  assert.match(yaml, /\/etc\/machine-id:\/etc\/machine-id:ro/);

  assert.equal(sanitizeCsvCell('=CMD()'), `"'=CMD()"`);
  assert.equal(sanitizeCsvCell('-bullet'), `"'-bullet"`);
  assert.equal(sanitizeCsvCell('normal "note"'), `"normal ""note"""`);

  const cloudSetup = buildMyClinicCloudSetup({
    licenseKey: '7A3F91C4082BD6E54A109F83C2D17E6B',
    verifyUrl: 'https://auth.supabase.co/functions/v1/verify-license',
    publicKeyEscaped: 'PUBKEY_SPKI',
    clinicOrigin: 'https://clinic.github.io/',
    clinicProjectRef: 'clinicref123',
  });
  assert.match(cloudSetup.appBuildVars, /^VITE_LICENSE_PUBLIC_KEY="PUBKEY_SPKI"$/);
  assert.doesNotMatch(
    cloudSetup.appBuildVars,
    /LICENSE_KEY=|7A3F91C4082BD6E54A109F83C2D17E6B/,
    'App build vars must never embed the secret LICENSE_KEY in the browser bundle',
  );
  assert.match(cloudSetup.edgeSecretsCmd, /AUTHORITY_VERIFY_URL="https:\/\/auth\.supabase\.co\/functions\/v1\/verify-license"/);
  assert.match(cloudSetup.edgeSecretsCmd, /LICENSE_KEY="7A3F91C4082BD6E54A109F83C2D17E6B"/);
  assert.match(cloudSetup.edgeSecretsCmd, /MYCLINIC_ORIGINS="https:\/\/clinic\.github\.io"/);
  assert.match(cloudSetup.edgeSecretsCmd, /sync-clinic-license --project-ref clinicref123/);
});
