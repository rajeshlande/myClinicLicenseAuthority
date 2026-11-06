import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MYCLINIC_TIER_ENTITLEMENTS,
  buildDockerComposeConfig,
  computeFleetMetrics,
  computeStanding,
  validateProvisionInput,
} from '../src/lib/entitlements.mjs';

test('validateProvisionInput normalizes valid inputs and rejects malformed fields', () => {
  const valid = validateProvisionInput({
    customerEmail: '  Dr.Rao@Clinic.IN ',
    tier: 'growth',
    maxMachines: 3,
    expiresDate: '2027-12-31',
    notes: '**PO#:** `PO-101`',
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.payload.p_customer_email, 'dr.rao@clinic.in');
  assert.equal(valid.payload.p_tier, 'growth');
  assert.equal(valid.payload.p_max_machines, 3);

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
});
