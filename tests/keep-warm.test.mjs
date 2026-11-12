import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  KEEP_WARM_CRON_SCHEDULE,
  KEEP_WARM_PAUSE_DAYS,
  KEEP_WARM_PROBE_PATH,
  KEEP_WARM_STAMP_COLUMN,
  KEEP_WARM_TARGET_DAYS,
  describeKeepWarmFleet,
  isKeepWarmDue,
  keepWarmStatus,
  pickKeepWarmTargets,
  probeTenantKeepWarm,
} from '../src/lib/keep-warm.mjs';
import { KEEP_WARM } from '../src/lib/workspace-directory.mjs';

const NOW = new Date('2026-11-12T12:00:00.000Z');
const daysAgo = (n) =>
  new Date(NOW.getTime() - n * 24 * 3_600_000).toISOString();

function workspace(overrides = {}) {
  return {
    id: 'ws-1',
    clinic_name: 'Sunrise OPD',
    slug: 'sunrise-opd',
    supabase_url: 'https://sunriseopd.supabase.co',
    supabase_anon_key: 'sb_publishable_sunrise_0001',
    is_active: true,
    keep_warm_at: daysAgo(1),
    ...overrides,
  };
}

function recordingFetch(status = 200, error = null) {
  const calls = [];
  return {
    calls,
    impl: async (url, init = {}) => {
      calls.push({ url, headers: { ...(init.headers ?? {}) } });
      if (error) throw error;
      return { status, ok: status >= 200 && status < 300, text: async () => '' };
    },
  };
}

test('the cadence is the contract cadence, and it fits inside the pause window', () => {
  assert.equal(KEEP_WARM_PAUSE_DAYS, KEEP_WARM.pause_days);
  assert.equal(KEEP_WARM_TARGET_DAYS, KEEP_WARM.target_days);
  assert.equal(KEEP_WARM_PROBE_PATH, KEEP_WARM.probe_path);
  assert.equal(KEEP_WARM_CRON_SCHEDULE, KEEP_WARM.cron_schedule);
  assert.equal(KEEP_WARM_STAMP_COLUMN, KEEP_WARM.stamp_column);
  assert.equal(KEEP_WARM_PAUSE_DAYS, 7, 'free tier pauses after 7 idle days');
  assert.ok(
    KEEP_WARM_TARGET_DAYS < KEEP_WARM_PAUSE_DAYS,
    'the probe target must leave margin before the pause',
  );
  assert.ok(KEEP_WARM_TARGET_DAYS >= KEEP_WARM_PAUSE_DAYS - 3, '…but not so tight it burns egress');
});

test('keepWarmStatus names all five states', () => {
  assert.equal(keepWarmStatus({ ...workspace(), now: NOW }).state, 'fresh');
  assert.equal(
    keepWarmStatus({ ...workspace({ keep_warm_at: daysAgo(5) }), now: NOW }).state,
    'due',
  );
  assert.equal(
    keepWarmStatus({ ...workspace({ keep_warm_at: daysAgo(6) }), now: NOW }).state,
    'due',
  );
  assert.equal(
    keepWarmStatus({ ...workspace({ keep_warm_at: daysAgo(8) }), now: NOW }).state,
    'overdue',
  );
  assert.equal(
    keepWarmStatus({ ...workspace({ keep_warm_at: null }), now: NOW }).state,
    'unknown',
  );
  assert.equal(
    keepWarmStatus({ ...workspace({ is_active: false }), now: NOW }).state,
    'unarmed',
  );
  assert.equal(
    keepWarmStatus({ ...workspace({ supabase_url: null }), now: NOW }).state,
    'unarmed',
  );
});

test('keepWarmStatus counts down to the pause and reads both naming styles', () => {
  const overdue = keepWarmStatus({ ...workspace({ keep_warm_at: daysAgo(8) }), now: NOW });
  assert.equal(overdue.hoursUntilPause, 0);
  assert.match(overdue.label, /paused/i);
  assert.match(overdue.detail, /Restore the project/);

  const due = keepWarmStatus({ ...workspace({ keep_warm_at: daysAgo(5) }), now: NOW });
  assert.equal(due.hoursUntilPause, 48, '7-day window minus 5 idle days');
  assert.equal(due.label, 'Probe due');

  const fresh = keepWarmStatus({ ...workspace({ keep_warm_at: daysAgo(1) }), now: NOW });
  assert.equal(fresh.hoursUntilPause, 144);
  assert.match(fresh.detail, /next probe due in 4 day/);

  const camel = keepWarmStatus({
    keepWarmAt: daysAgo(1),
    isActive: true,
    supabaseUrl: 'https://x.supabase.co',
    now: NOW,
  });
  assert.equal(camel.state, 'fresh', 'camelCase rows must not read as unarmed');
});

test('isKeepWarmDue: unknown, due and overdue need a probe; fresh and unarmed do not', () => {
  assert.equal(isKeepWarmDue(workspace({ keep_warm_at: daysAgo(1) }), NOW), false);
  assert.equal(isKeepWarmDue(workspace({ keep_warm_at: daysAgo(5) }), NOW), true);
  assert.equal(isKeepWarmDue(workspace({ keep_warm_at: daysAgo(9) }), NOW), true);
  assert.equal(isKeepWarmDue(workspace({ keep_warm_at: null }), NOW), true);
  assert.equal(isKeepWarmDue(workspace({ is_active: false, keep_warm_at: null }), NOW), false);
});

test('pickKeepWarmTargets: never-probed first, then oldest, capped, armed only', () => {
  const fleet = [
    workspace({ id: 'fresh', slug: 'fresh-clinic', keep_warm_at: daysAgo(1) }),
    workspace({ id: 'old', slug: 'old-clinic', keep_warm_at: daysAgo(6) }),
    workspace({ id: 'never', slug: 'never-clinic', keep_warm_at: null }),
    workspace({ id: 'mid', slug: 'mid-clinic', keep_warm_at: daysAgo(5) }),
    workspace({ id: 'off', slug: 'off-clinic', is_active: false, keep_warm_at: null }),
    workspace({ id: 'bare', slug: 'bare-clinic', supabase_url: null, keep_warm_at: null }),
  ];
  const targets = pickKeepWarmTargets({ workspaces: fleet, now: NOW });
  assert.deepEqual(
    targets.map((t) => t.slug),
    ['never-clinic', 'old-clinic', 'mid-clinic'],
  );
  assert.deepEqual(
    targets.map((t) => t.state),
    ['unknown', 'due', 'due'],
  );
  assert.equal(pickKeepWarmTargets({ workspaces: fleet, now: NOW, limit: 1 }).length, 1);
  assert.equal(pickKeepWarmTargets({ workspaces: fleet, now: NOW, limit: 0 }).length, 0);
  assert.equal(pickKeepWarmTargets({ workspaces: [], now: NOW }).length, 0);
  assert.equal(pickKeepWarmTargets({ now: NOW }).length, 0);
  // The probe needs both halves of the connection.
  assert.equal(targets[0].supabaseUrl, 'https://sunriseopd.supabase.co');
  assert.equal(targets[0].supabaseAnonKey, 'sb_publishable_sunrise_0001');
  assert.equal(targets[0].id, 'never');
});

test('describeKeepWarmFleet gives one honest headline per situation', () => {
  assert.match(describeKeepWarmFleet({ workspaces: [], now: NOW }).headline, /No workspaces/);
  assert.match(
    describeKeepWarmFleet({ workspaces: [workspace({ is_active: false })], now: NOW }).headline,
    /Nothing armed/,
  );
  const warm = describeKeepWarmFleet({
    workspaces: [workspace(), workspace({ id: 'b', slug: 'b-clinic' })],
    now: NOW,
  });
  assert.equal(warm.needsProbe, 0);
  assert.match(warm.headline, /All 2 tenant projects are warm/);
  const mixed = describeKeepWarmFleet({
    workspaces: [workspace(), workspace({ id: 'c', slug: 'c-clinic', keep_warm_at: daysAgo(9) })],
    now: NOW,
  });
  assert.equal(mixed.total, 2);
  assert.equal(mixed.active, 2);
  assert.equal(mixed.fresh, 1);
  assert.equal(mixed.overdue, 1);
  assert.equal(mixed.needsProbe, 1);
  assert.match(mixed.headline, /1 of 2 tenant projects need a keep-warm probe/);
  assert.equal(
    describeKeepWarmFleet({ workspaces: [workspace()], now: NOW }).headline,
    'All 1 tenant project is warm',
  );
});

test('probeTenantKeepWarm hits the contract probe path with the tenant key', async () => {
  const { impl, calls } = recordingFetch(200);
  const res = await probeTenantKeepWarm({
    supabaseUrl: 'https://sunriseopd.supabase.co/',
    supabaseAnonKey: 'sb_publishable_sunrise_0001',
    fetchImpl: impl,
  });
  assert.equal(res.ok, true);
  assert.equal(res.status, 200);
  assert.ok(res.probedAt);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://sunriseopd.supabase.co${KEEP_WARM_PROBE_PATH}`);
  assert.equal(calls[0].headers.apikey, 'sb_publishable_sunrise_0001');
});

test('any answer below 500 proves the project is awake', async () => {
  for (const status of [200, 401, 404]) {
    const { impl } = recordingFetch(status);
    const res = await probeTenantKeepWarm({
      supabaseUrl: 'https://x.supabase.co',
      supabaseAnonKey: 'sb_publishable_x',
      fetchImpl: impl,
    });
    assert.equal(res.ok, true, `HTTP ${status} still means PostgREST answered`);
  }
});

test('a 5xx or a dead socket is what a paused project looks like', async () => {
  const { impl } = recordingFetch(540);
  const res = await probeTenantKeepWarm({
    supabaseUrl: 'https://x.supabase.co',
    supabaseAnonKey: 'sb_publishable_x',
    fetchImpl: impl,
  });
  assert.equal(res.ok, false);
  assert.equal(res.status, 540);
  assert.match(res.reason, /may be paused/);

  const threw = await probeTenantKeepWarm({
    supabaseUrl: 'https://x.supabase.co',
    supabaseAnonKey: 'sb_publishable_x',
    fetchImpl: async () => {
      throw new Error('Failed to fetch');
    },
  });
  assert.equal(threw.ok, false);
  assert.equal(threw.status, 0);
  assert.match(threw.reason, /Failed to fetch/);

  const aborted = await probeTenantKeepWarm({
    supabaseUrl: 'https://x.supabase.co',
    supabaseAnonKey: 'sb_publishable_x',
    fetchImpl: async () => {
      throw new Error('The operation was aborted.');
    },
  });
  assert.match(aborted.reason, /may be paused or unreachable/);
});

test('a workspace with no URL cannot be probed', async () => {
  const { impl, calls } = recordingFetch(200);
  const res = await probeTenantKeepWarm({ supabaseUrl: '', fetchImpl: impl });
  assert.equal(res.ok, false);
  assert.equal(calls.length, 0);
  assert.match(res.reason, /No tenant URL/);
});

// ── The SQL half of the same cadence ──────────────────────────────────────────
// pg_cron + pg_net run the cycle when nobody has the console open. Both are
// optional extensions, so schema.sql must guard on pg_extension and stay
// appliable on the bare PG17 harness — and the numbers it uses must be the
// contract numbers, not a second opinion.

const schemaSql = readFileSync(
  new URL('../supabase/schema.sql', import.meta.url),
  'utf8',
);

test('schema.sql keeps the directory warm on the contract cadence', () => {
  assert.match(
    schemaSql,
    new RegExp(`interval '${KEEP_WARM_TARGET_DAYS} days'`),
    'the SQL due-window must equal keep_warm.target_days',
  );
  assert.match(
    schemaSql,
    new RegExp(`interval '${KEEP_WARM_PAUSE_DAYS} days'`),
    'the SQL overdue-window must equal keep_warm.pause_days',
  );
  assert.ok(
    schemaSql.includes(KEEP_WARM_CRON_SCHEDULE),
    'the cron schedule must come from the contract',
  );
  assert.ok(
    schemaSql.includes(KEEP_WARM_PROBE_PATH),
    'the cron probe path must equal keep_warm.probe_path',
  );
  assert.match(schemaSql, /create or replace function public\.run_keep_warm_cycle/i);
  assert.match(schemaSql, /create or replace function public\.due_keep_warm_workspaces/i);
  assert.match(schemaSql, /create or replace function public\.stamp_keep_warm/i);
  assert.match(schemaSql, /net\.http_get\(/i);
  assert.match(schemaSql, /update public\.workspaces\s+set keep_warm_at = now\(\)/i);
  // Guarded: a project (or the harness) without the extensions still applies.
  assert.match(schemaSql, /from pg_extension where extname = 'pg_cron'/i);
  assert.match(schemaSql, /from pg_extension where extname = 'pg_net'/i);
});

test('the keep-warm surface is admin-only; the cron body belongs to the database', () => {
  // The console may list and stamp; only the database owner may run the cycle.
  assert.match(
    schemaSql,
    /grant execute on function public\.due_keep_warm_workspaces\(integer\) to authenticated/i,
  );
  assert.match(
    schemaSql,
    /grant execute on function public\.stamp_keep_warm\(uuid, boolean\) to authenticated/i,
  );
  assert.match(
    schemaSql,
    /revoke all on function public\.run_keep_warm_cycle\(integer\) from public, anon, authenticated/i,
  );
  // None of the three may widen the anon surface.
  const anonGrants =
    schemaSql.match(/grant\s+[^\n;]+\bto\b[^\n;]*\banon\b[^;]*;/gi) ?? [];
  assert.equal(anonGrants.length, 1, 'anon still holds exactly one grant');
  assert.match(anonGrants[0], /sync_clinic_subscription/i);
  // Both admin functions are SECURITY DEFINER, so both pin search_path.
  for (const fn of ['due_keep_warm_workspaces', 'stamp_keep_warm', 'run_keep_warm_cycle']) {
    const block = schemaSql
      .split(/create\s+or\s+replace\s+function/i)
      .find((b) => b.startsWith(` public.${fn}`));
    assert.ok(block, `${fn} definition found`);
    const header = block.split(/\bas\s+\$\$/i)[0] ?? '';
    assert.match(header, /security\s+definer/i, `${fn} is SECURITY DEFINER`);
    assert.match(header, /set\s+search_path\s*=/i, `${fn} pins search_path`);
  }
});
