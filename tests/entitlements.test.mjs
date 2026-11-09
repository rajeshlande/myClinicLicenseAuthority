import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MYCLINIC_TIER_ENTITLEMENTS,
  buildDockerComposeConfig,
  buildMyClinicCloudSetup,
  computeFleetMetrics,
  computeStanding,
  describeClientSyncState,
  describeClinicIdentity,
  formatSyncTimestamp,
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

test('describeClientSyncState tracks Awaiting Connect, Plan Synced, Update Pending, and Pause Synced', () => {
  const now = new Date('2026-11-06T12:00:00.000Z');

  assert.equal(formatSyncTimestamp('2026-11-06T11:59:30.000Z', now), 'just now');
  assert.equal(formatSyncTimestamp('2026-11-06T11:55:00.000Z', now), '5m ago');
  assert.equal(formatSyncTimestamp('2026-11-06T09:00:00.000Z', now), '3h ago');

  // 1. Newly added clinic that hasn't opened myClinic yet
  const neverConnected = describeClientSyncState(
    {
      is_active: true,
      status: 'active',
      tier: 'growth',
      registered_machines: 0,
      max_machines: 2,
      last_heartbeat: null,
      updated_at: '2026-11-06T10:00:00.000Z',
      expires_at: '2027-11-06T00:00:00.000Z',
    },
    now,
  );
  assert.equal(neverConnected.state, 'awaiting_connect');
  assert.equal(neverConnected.isConnected, false);
  assert.equal(neverConnected.badgeLabel, 'Awaiting Connect');

  // 2. Connected clinic that synced AFTER last Central edit with matching tier
  const syncedRow = {
    is_active: true,
    status: 'active',
    tier: 'growth',
    registered_machines: 1,
    max_machines: 2,
    last_heartbeat: '2026-11-06T11:58:00.000Z',
    updated_at: '2026-11-06T11:30:00.000Z',
    last_synced_tier: 'growth',
    last_synced_status: 'active',
    last_synced_expires_at: '2027-11-06T00:00:00.000Z',
    expires_at: '2027-11-06T00:00:00.000Z',
  };
  const inSync = describeClientSyncState(syncedRow, now);
  assert.equal(inSync.state, 'in_sync');
  assert.equal(inSync.isConnected, true);
  assert.equal(inSync.isPlanSynced, true);
  assert.equal(inSync.badgeLabel, 'Plan Synced');
  assert.match(inSync.detail, /GROWTH live · 2m ago/);

  // 3. Admin upgrades clinic from growth -> chain at 11:59 (client last synced at 11:58 on growth)
  const pendingRow = {
    ...syncedRow,
    tier: 'chain',
    updated_at: '2026-11-06T11:59:00.000Z',
  };
  const pending = describeClientSyncState(pendingRow, now);
  assert.equal(pending.state, 'update_pending');
  assert.equal(pending.isConnected, true);
  assert.equal(pending.isPlanSynced, false);
  assert.equal(pending.badgeLabel, 'Update Pending');
  assert.match(pending.detail, /Client on GROWTH · last sync 2m ago/);

  // 4. Admin pauses clinic -> Pause Pending until client acknowledges 'paused'
  const pausePending = describeClientSyncState(
    {
      ...syncedRow,
      is_active: false,
      updated_at: '2026-11-06T11:59:00.000Z',
    },
    now,
  );
  assert.equal(pausePending.state, 'update_pending');
  assert.equal(pausePending.badgeLabel, 'Pause Pending');

  const pauseSynced = describeClientSyncState(
    {
      ...syncedRow,
      is_active: false,
      updated_at: '2026-11-06T11:59:00.000Z',
      last_heartbeat: '2026-11-06T11:59:40.000Z',
      last_synced_tier: 'solo',
      last_synced_status: 'paused',
    },
    now,
  );
  assert.equal(pauseSynced.state, 'in_sync');
  assert.equal(pauseSynced.badgeLabel, 'Pause Synced');
  assert.match(pauseSynced.detail, /PAUSED enforced · just now/);

  const fleet = computeFleetMetrics([syncedRow, pendingRow], now);
  assert.equal(fleet.connectedClinicsCount, 2);
  assert.equal(fleet.inSyncClinicsCount, 1);
  assert.equal(fleet.pendingSyncClinicsCount, 1);
});
