import test from 'node:test';
import assert from 'node:assert/strict';
import { readAllLicenses, readSubscriptionsLite } from '../src/lib/reads.mjs';

// Minimal recording stand-in for the Supabase query builder: enough of the
// chain (from -> select -> order) to prove the wire shape and the sharing.
function makeFakeSupabase(log) {
  const thenable = (entry) => ({
    order(column, opts) {
      entry.order = [column, opts];
      return this;
    },
    then(resolve) {
      resolve({ data: [], error: null });
    },
  });
  return {
    from(table) {
      return {
        select(columns) {
          const entry = { table, columns };
          log.push(entry);
          return thenable(entry);
        },
      };
    },
  };
}

test('readSubscriptionsLite keeps the identity-map wire shape and shares one query', async () => {
  const log = [];
  const fake = makeFakeSupabase(log);
  const [a, b] = await Promise.all([
    readSubscriptionsLite(fake),
    readSubscriptionsLite(fake),
  ]);
  assert.equal(log.length, 1, 'concurrent readers must share one round trip');
  assert.deepEqual(log[0], {
    table: 'subscriptions',
    columns: 'id, customer_email, allowed_origin',
  });
  assert.deepEqual(a, { data: [], error: null });
  assert.deepEqual(b, a);
});

test('readAllLicenses keeps the registry wire shape (newest first)', async () => {
  const log = [];
  const fake = makeFakeSupabase(log);
  await readAllLicenses(fake);
  assert.equal(log.length, 1);
  assert.equal(log[0].table, 'admin_license_view');
  assert.equal(log[0].columns, '*');
  assert.deepEqual(log[0].order, ['created_at', { ascending: false }]);
});

test('sequential reads refetch instead of serving a memo', async () => {
  const log = [];
  const fake = makeFakeSupabase(log);
  await readSubscriptionsLite(fake);
  await readSubscriptionsLite(fake);
  assert.equal(log.length, 2);
});
