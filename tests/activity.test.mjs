import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  ACTIVITY_EVENT_KINDS,
  describeActivityEvent,
  fetchClinicActivity,
  fetchFleetActivity,
  logClinicActivity,
} from '../src/lib/activity.mjs';

const schemaSql = readFileSync('supabase/schema.sql', 'utf8');

/** Minimal PostgREST-shaped chain that records what it was asked to do. */
function makeMockSupabase() {
  const calls = [];
  let insertError = null;
  const chain = {
    select: () => chain,
    eq: (column, value) => {
      calls.push(['eq', column, value]);
      return chain;
    },
    order: (column, opts) => {
      calls.push(['order', column, opts]);
      return chain;
    },
    limit: (n) => {
      calls.push(['limit', n]);
      return chain;
    },
    insert: (row) => {
      calls.push(['insert', row]);
      return { then: (resolve) => resolve({ data: null, error: insertError }) };
    },
    then: (resolve) => resolve({ data: [], error: null }),
  };
  return {
    calls,
    setInsertError: (err) => {
      insertError = err;
    },
    supabase: { from: () => chain },
  };
}

test('the client event vocabulary is the SQL CHECK constraint, exactly', () => {
  const sqlBlock =
    /create table if not exists public\.clinic_activity_log\s*\(([^\0]*?)\n\);/.exec(
      schemaSql,
    )?.[1] ?? '';
  assert.ok(sqlBlock, 'clinic_activity_log definition not found in schema.sql');
  for (const kind of ACTIVITY_EVENT_KINDS) {
    assert.match(sqlBlock, new RegExp(`'${kind}'`), `schema.sql must accept ${kind}`);
  }
  const sqlKinds = [...sqlBlock.matchAll(/'([a-z_]+)'/g)]
    .map((m) => m[1])
    .filter((k) => k.includes('_') || ACTIVITY_EVENT_KINDS.includes(k));
  for (const kind of sqlKinds) {
    assert.ok(
      ACTIVITY_EVENT_KINDS.includes(kind),
      `client vocabulary is missing schema kind ${kind}`,
    );
  }
});

test('logClinicActivity writes the exact row shape and refuses unknown kinds', async () => {
  const mock = makeMockSupabase();
  const { error } = await logClinicActivity(mock.supabase, {
    subscriptionId: 'sub_1',
    licenseId: 'lic_1',
    eventKind: 'paused',
    actor: 'ops@myclinic.local',
    payload: { via: 'kill-switch' },
  });
  assert.equal(error, null);
  const insert = mock.calls.find(([op]) => op === 'insert');
  assert.deepEqual(insert[1], {
    subscription_id: 'sub_1',
    license_id: 'lic_1',
    event_kind: 'paused',
    actor: 'ops@myclinic.local',
    payload: { via: 'kill-switch' },
  });

  const bad = await logClinicActivity(mock.supabase, {
    subscriptionId: 'sub_1',
    eventKind: 'deleted_lol',
  });
  assert.match(bad.error.message, /unknown event kind/);
  assert.equal(
    mock.calls.filter(([op]) => op === 'insert').length,
    1,
    'an unknown kind must never reach PostgREST',
  );

  const noSub = await logClinicActivity(mock.supabase, { eventKind: 'paused' });
  assert.match(noSub.error.message, /subscriptionId is required/);
});

test('logClinicActivity surfaces backend errors without throwing', async () => {
  const mock = makeMockSupabase();
  mock.setInsertError({ message: 'relation public.clinic_activity_log does not exist' });
  const { error } = await logClinicActivity(mock.supabase, {
    subscriptionId: 'sub_1',
    eventKind: 'renewed',
  });
  assert.match(error.message, /does not exist/);
});

test('fetch helpers order newest-first and respect limits', async () => {
  const mock = makeMockSupabase();
  await fetchClinicActivity(mock.supabase, 'sub_9', 25);
  assert.deepEqual(mock.calls[0], ['eq', 'subscription_id', 'sub_9']);
  assert.deepEqual(mock.calls[1], ['order', 'at', { ascending: false }]);
  assert.deepEqual(mock.calls[2], ['limit', 25]);

  mock.calls.length = 0;
  await fetchFleetActivity(mock.supabase);
  assert.deepEqual(mock.calls[0], ['order', 'at', { ascending: false }]);
  assert.deepEqual(mock.calls[1], ['limit', 100]);
});

test('describeActivityEvent labels every kind and degrades safely', () => {
  for (const kind of ACTIVITY_EVENT_KINDS) {
    const meta = describeActivityEvent(kind);
    assert.ok(meta.label.length > 0);
    assert.ok(['ok', 'warn', 'danger', 'info'].includes(meta.tone));
  }
  assert.equal(describeActivityEvent('nope').label, 'nope');
});
