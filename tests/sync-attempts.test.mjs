import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  SYNC_REFUSAL_HINTS,
  computeFleetMetrics,
  describeClientSyncState,
  describeRefusal,
} from '../src/lib/entitlements.mjs';
import { probeCentralAutoSync } from '../src/lib/auto-sync-client.mjs';
import { SCHEMA_VERSION } from '../src/lib/version.js';

const schemaSql = readFileSync('supabase/schema.sql', 'utf8');
const schemaTestsSql = readFileSync('supabase/schema-tests.sql', 'utf8');

const NOW = new Date('2026-11-09T12:00:00.000Z');

/** A subscription row the way `admin_license_view` returns it. */
function row(overrides = {}) {
  return {
    license_id: 'lic-1',
    subscription_id: 'sub-1',
    customer_email: 'owner@dualclinic.in',
    allowed_origin: 'https://dualclinic.github.io',
    is_active: true,
    status: 'active',
    tier: 'growth',
    max_machines: 3,
    registered_machines: 1,
    last_heartbeat: '2026-11-09T11:55:00.000Z',
    expires_at: '2027-11-09T23:59:59.999Z',
    updated_at: '2026-11-01T00:00:00.000Z',
    last_synced_tier: 'growth',
    last_synced_status: 'active',
    last_synced_expires_at: '2027-11-09T23:59:59.999Z',
    last_refusal_code: null,
    last_refusal_at: null,
    refusals_24h: 0,
    last_refusal_email_hint: null,
    last_refusal_origin: null,
    last_refusal_browser_origin: null,
    ...overrides,
  };
}

test('every refusal code the RPC can emit has an operator-facing hint', () => {
  // The codes are read straight out of the SQL so the map cannot drift: a new
  // refusal in schema.sql without a hint fails here, not in a support call.
  const rpcBody =
    /create or replace function public\.sync_clinic_subscription[\s\S]*?\n\$\$;/.exec(
      schemaSql,
    )?.[0] ?? '';
  assert.ok(rpcBody.length > 1000, 'could not locate the auto-sync RPC body');

  const codes = new Set(
    [...rpcBody.matchAll(/'code',\s*'([A-Z_]+)'/g)].map((m) => m[1]),
  );
  // ACTIVE is the allowed verdict, not a refusal.
  codes.delete('ACTIVE');
  assert.ok(codes.size >= 9, `expected the full refusal vocabulary, got ${[...codes]}`);

  for (const code of codes) {
    const hint = SYNC_REFUSAL_HINTS[code];
    assert.ok(hint, `SYNC_REFUSAL_HINTS is missing ${code}`);
    assert.ok(hint.label && hint.label.length <= 20, `${code} needs a short label`);
    assert.ok(hint.hint.length >= 40, `${code} needs an actionable hint, not a shrug`);
    assert.doesNotMatch(hint.hint, /\b(TODO|FIXME|tbd)\b/i, `${code} hint is unfinished`);
  }

  for (const code of Object.keys(SYNC_REFUSAL_HINTS)) {
    assert.ok(codes.has(code), `SYNC_REFUSAL_HINTS invents ${code}, which the RPC never returns`);
  }
});

test('describeRefusal masks the mailbox, keeps the claimed URL verbatim, and orders events', () => {
  assert.equal(describeRefusal(row()), null, 'no refusal code means no refusal');
  assert.equal(describeRefusal(row({ last_refusal_code: '   ' })), null);

  const refusal = describeRefusal(
    row({
      last_refusal_code: 'subscription_not_found',
      last_refusal_at: '2026-11-09T11:56:00.000Z',
      refusals_24h: 4,
      last_refusal_email_hint: 'o***@dualclinic.in',
      last_refusal_origin: 'https://evil.github.io',
      last_refusal_browser_origin: 'https://evil.github.io',
    }),
    NOW,
  );

  assert.equal(refusal.code, 'SUBSCRIPTION_NOT_FOUND', 'codes are normalised upper-case');
  assert.equal(refusal.label, 'No match');
  assert.equal(refusal.ago, '4m ago');
  assert.equal(refusal.at, '2026-11-09T11:56:00.000Z');
  assert.equal(refusal.count24h, 4);
  assert.equal(refusal.claimedEmailHint, 'o***@dualclinic.in');
  assert.equal(refusal.claimedOrigin, 'https://evil.github.io');
  // The browser origin equals the claim here, so repeating it would be noise.
  assert.equal(refusal.claim, 'email o***@dualclinic.in · URL https://evil.github.io');
  assert.match(refusal.hint, /BOTH must match exactly/);

  // A spoofed Origin is the one case where both addresses matter.
  const spoof = describeRefusal(
    row({
      last_refusal_code: 'ORIGIN_MISMATCH',
      last_refusal_at: '2026-11-09T11:59:30.000Z',
      last_refusal_origin: 'https://dualclinic.github.io',
      last_refusal_browser_origin: 'https://evil.github.io',
    }),
    NOW,
  );
  assert.equal(spoof.label, 'Origin blocked');
  assert.equal(spoof.ago, 'just now');
  assert.equal(
    spoof.claim,
    'URL https://dualclinic.github.io · browser https://evil.github.io',
  );

  // Unknown codes still explain themselves instead of rendering blank.
  const unknown = describeRefusal(row({ last_refusal_code: 'SOMETHING_NEW' }), NOW);
  assert.equal(unknown.label, 'Refused');
  assert.match(unknown.hint, /SOMETHING_NEW/);

  // A missing timestamp must never read as "never" or throw.
  const undated = describeRefusal(row({ last_refusal_code: 'RATE_LIMITED' }), NOW);
  assert.equal(undated.at, null);
  assert.equal(undated.ago, 'at an unknown time');
  assert.equal(undated.count24h, 0);
});

test('describeClientSyncState reports Refused when Central has evidence of a turned-away client', () => {
  const refused = describeClientSyncState(
    row({
      registered_machines: 0,
      last_heartbeat: null,
      last_synced_tier: null,
      last_synced_status: null,
      last_refusal_code: 'SUBSCRIPTION_NOT_FOUND',
      last_refusal_at: '2026-11-09T11:56:00.000Z',
      refusals_24h: 7,
      last_refusal_email_hint: 'o***@dualclinic.in',
      last_refusal_origin: 'https://evil.github.io',
    }),
    NOW,
  );

  assert.equal(refused.state, 'refused');
  assert.equal(refused.badgeLabel, 'Refused');
  assert.equal(refused.tone, 'error');
  assert.equal(refused.isConnected, false);
  assert.equal(refused.isPlanSynced, false);
  assert.equal(refused.lastSyncedAgo, 'never');
  assert.equal(refused.detail, 'SUBSCRIPTION_NOT_FOUND · 4m ago');
  assert.equal(refused.refusals24h, 7);
  assert.match(refused.hint, /dual-pinned/i);

  // The same row with no recorded attempt is still the honest "never called".
  const awaiting = describeClientSyncState(
    row({ registered_machines: 0, last_heartbeat: null }),
    NOW,
  );
  assert.equal(awaiting.state, 'awaiting_connect');
  assert.equal(awaiting.badgeLabel, 'Awaiting Connect');
  assert.equal(awaiting.detail, 'Client app not opened yet');
  assert.equal(awaiting.tone, 'neutral');
  assert.equal(awaiting.refusal, null);
  assert.match(awaiting.hint, /sign in as the owner/i);

  // A stale heartbeat with no attempt row is still awaiting, not refused.
  const stale = describeClientSyncState(row({ last_heartbeat: null }), NOW);
  assert.equal(stale.state, 'awaiting_connect');
});

test('a recorded refusal never overrides a delivered verdict', () => {
  // The client connected, then Central paused it: the badge must keep saying the
  // pause was delivered, with the refusal carried alongside for the inspector.
  const paused = describeClientSyncState(
    row({
      is_active: false,
      last_synced_tier: 'solo',
      last_synced_status: 'paused',
      last_refusal_code: 'SUBSCRIPTION_PAUSED',
      last_refusal_at: '2026-11-09T11:58:00.000Z',
      refusals_24h: 2,
    }),
    NOW,
  );
  assert.equal(paused.state, 'in_sync');
  assert.equal(paused.badgeLabel, 'Pause Synced');
  assert.equal(paused.tone, 'ok');
  assert.equal(paused.refusal.code, 'SUBSCRIPTION_PAUSED');
  assert.equal(paused.refusals24h, 2);

  const pending = describeClientSyncState(
    row({
      tier: 'chain',
      last_synced_tier: 'growth',
      last_refusal_code: 'RATE_LIMITED',
      last_refusal_at: '2026-11-09T11:59:00.000Z',
      refusals_24h: 1,
    }),
    NOW,
  );
  assert.equal(pending.state, 'update_pending');
  assert.equal(pending.refusal.code, 'RATE_LIMITED');
  assert.match(pending.hint, /30-minute timer/);
});

test('every sync state carries the same shape, so the console cannot read undefined', () => {
  const shapes = [
    describeClientSyncState(row({ registered_machines: 0, last_heartbeat: null }), NOW),
    describeClientSyncState(
      row({
        registered_machines: 0,
        last_heartbeat: null,
        last_refusal_code: 'SEAT_LIMIT_REACHED',
        last_refusal_at: '2026-11-09T11:00:00.000Z',
      }),
      NOW,
    ),
    describeClientSyncState(row({ tier: 'chain', last_synced_tier: 'growth' }), NOW),
    describeClientSyncState(row(), NOW),
  ];

  for (const state of shapes) {
    for (const key of [
      'state',
      'isConnected',
      'isPlanSynced',
      'tone',
      'badgeLabel',
      'detail',
      'hint',
      'refusal',
      'refusals24h',
      'lastSyncedAgo',
    ]) {
      assert.ok(key in state, `${state.state} is missing ${key}`);
    }
    assert.ok(
      ['ok', 'warn', 'error', 'neutral'].includes(state.tone),
      `unexpected tone ${state.tone}`,
    );
    assert.equal(typeof state.refusals24h, 'number');
  }
});

test('computeFleetMetrics counts refused and awaiting clinics separately', () => {
  const metrics = computeFleetMetrics(
    [
      row(),
      row({ license_id: 'lic-2', tier: 'chain', last_synced_tier: 'growth' }),
      row({
        license_id: 'lic-3',
        registered_machines: 0,
        last_heartbeat: null,
        last_refusal_code: 'ORIGIN_MISMATCH',
        last_refusal_at: '2026-11-09T11:50:00.000Z',
        refusals_24h: 3,
      }),
      row({ license_id: 'lic-4', registered_machines: 0, last_heartbeat: null }),
    ],
    NOW,
  );

  assert.equal(metrics.total, 4);
  assert.equal(metrics.inSyncClinicsCount, 1);
  assert.equal(metrics.pendingSyncClinicsCount, 1);
  assert.equal(metrics.refusedClinicsCount, 1);
  assert.equal(metrics.awaitingClinicsCount, 1);
  assert.equal(metrics.connectedClinicsCount, 2);
  assert.equal(
    metrics.inSyncClinicsCount +
      metrics.pendingSyncClinicsCount +
      metrics.refusedClinicsCount +
      metrics.awaitingClinicsCount,
    metrics.total,
    'the four sync states must partition the fleet',
  );
});

test('schema v3 keeps the refusal audit private, attributed, throttled and read-only', () => {
  const table =
    /create table if not exists public\.sync_attempts\s*\(([\s\S]*?)\n\);/.exec(schemaSql)?.[1] ??
    '';
  assert.ok(table.length > 200, 'sync_attempts table definition not found');

  // Hashed / masked identifiers only.
  assert.match(table, /ip_hash\s+text not null/i);
  assert.match(table, /ip_hash ~ '\^\[a-f0-9\]\{64\}\$'/i);
  assert.match(table, /claimed_email_hash ~ '\^\[a-f0-9\]\{64\}\$'/i);
  assert.match(table, /claimed_email_hint/i);
  for (const raw of ['raw_ip', 'ip_address', 'customer_email', 'email_address', 'device_id']) {
    assert.doesNotMatch(table, new RegExp(`\\b${raw}\\b`, 'i'), `${raw} must never be stored`);
  }
  assert.doesNotMatch(table, /^\s*ip\s+/im, 'a bare `ip` column must never exist');

  // Cascade + retention.
  assert.match(table, /references public\.subscriptions\(id\) on delete cascade/i);
  assert.match(table, /references public\.licenses\(id\) on delete cascade/i);

  const fn =
    /create or replace function public\.record_sync_attempt[\s\S]*?\n\$\$;/.exec(schemaSql)?.[0] ??
    '';
  assert.ok(fn.length > 500, 'record_sync_attempt not found');
  assert.match(fn, /security definer/i);
  assert.match(fn, /set search_path = public, extensions/i);
  assert.doesNotMatch(fn, /\bexecute\s+['"]/i, 'no dynamic SQL in a SECURITY DEFINER function');
  assert.match(fn, /clock_timestamp\(\)/, 'an audit log must order real events, not transaction time');
  assert.match(fn, /digest\('myclinic-sync-v2:'/, 'the IP digest reuses the rate limiter pepper');
  assert.match(fn, /digest\('myclinic-email-v3:'/, 'the email digest is peppered');
  assert.match(fn, /consume_sync_rate_limit\('audit:'/, 'per-IP audit budget prevents table flooding');
  assert.match(fn, /consume_sync_rate_limit\('prune:sync_attempts', 86400, 1\)/);
  assert.match(fn, /interval '30 days'/);
  assert.match(fn, /offset 100000/, 'a hard ceiling backs the 30-day window');
  assert.match(
    fn,
    /exception when others then\s+null;\s+end;\s+end;\s+\$\$;/i,
    'audit failures must be swallowed so they can never change a verdict',
  );

  // Read-only for everyone, including an admin token.
  assert.match(
    schemaSql,
    /create policy sync_attempts_admin_read\s+on public\.sync_attempts for select to authenticated\s+using \(public\.is_license_admin\(\)\)/i,
  );
  assert.doesNotMatch(
    schemaSql,
    /create policy[^;]*on public\.sync_attempts for (all|insert|update|delete)/i,
    'only a SELECT policy may exist on sync_attempts',
  );
  assert.match(
    schemaSql,
    /revoke all on function public\.record_sync_attempt\([^)]*\) from public, anon, authenticated/i,
  );
  assert.doesNotMatch(
    schemaSql,
    /grant [^\n;]*\bsync_attempts\b[^\n;]*\banon\b/i,
    'anon must never be granted anything on the audit table',
  );

  // Near-miss attribution: an unmatched call is still pinned to the row it almost matched.
  const rpc =
    /create or replace function public\.sync_clinic_subscription[\s\S]*?\n\$\$;/.exec(schemaSql)?.[0] ??
    '';
  assert.match(rpc, /near-miss:/);
  assert.match(rpc, /no-candidate/);
  assert.match(rpc, /v_near_sub, v_near_lic/);
  assert.ok(
    (rpc.match(/perform public\.record_sync_attempt\(/g) ?? []).length >= 9,
    'every refusal path must be audited',
  );
  assert.match(rpc, /if not v_is_preview then\s+perform public\.record_sync_attempt/i);

  // The scratch suite has to prove it end to end.
  assert.match(schemaTestsSql, /sync_attempts/);
  assert.match(schemaTestsSql, /o\*\*\*@dualclinic\.in/);
  assert.match(schemaTestsSql, /30-day retention/);
  assert.match(schemaTestsSql, /cannot insert into sync_attempts/);
});

test('admin_license_view appends the refusal columns last so live v2 installs upgrade in place', () => {
  const view =
    /create or replace view public\.admin_license_view[\s\S]*?from public\.licenses l/.exec(
      schemaSql,
    )?.[0] ?? '';
  assert.ok(view.length > 400, 'admin_license_view definition not found');

  const columns = [...view.matchAll(/\)\s+as\s+([a-z_0-9]+)/g)].map((m) => m[1]);
  const added = [
    'last_refusal_code',
    'last_refusal_at',
    'refusals_24h',
    'last_refusal_email_hint',
    'last_refusal_origin',
    'last_refusal_browser_origin',
  ];
  for (const name of added) {
    assert.ok(columns.includes(name), `admin_license_view is missing ${name}`);
  }
  // CREATE OR REPLACE VIEW may only add columns at the end.
  const firstAdded = columns.indexOf(added[0]);
  const lastLegacy = columns.indexOf('last_synced_expires_at');
  assert.ok(
    lastLegacy >= 0 && firstAdded > lastLegacy,
    `v3 columns must come after the v2 ones, got ${columns.join(',')}`,
  );
  assert.equal(
    (view.match(/order by sa\.attempted_at desc, sa\.id desc/g) ?? []).length,
    4,
    'every "latest refusal" subquery needs a deterministic tiebreaker',
  );
});

test('probeCentralAutoSync reports the current schema version, and defaults to it', async () => {
  const probe = async (payload) =>
    probeCentralAutoSync('https://centralref.supabase.co', 'sb_publishable_demo', {
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => payload }),
    });

  assert.equal((await probe({ ok: true, sync_ready: true, schema_version: 3 })).schemaVersion, 3);
  assert.equal(
    (await probe({ ok: true, sync_ready: true })).schemaVersion,
    SCHEMA_VERSION,
    'a Central project that omits schema_version is assumed to be the current one',
  );
});
