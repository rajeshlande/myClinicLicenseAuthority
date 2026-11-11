import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getGlobalSearchQuery,
  setGlobalSearchQuery,
  subscribeGlobalSearch,
} from '../src/lib/global-search.mjs';

test('global search store starts empty and round-trips values', () => {
  setGlobalSearchQuery('');
  assert.equal(getGlobalSearchQuery(), '');
  setGlobalSearchQuery('lakeview');
  assert.equal(getGlobalSearchQuery(), 'lakeview');
  setGlobalSearchQuery('');
});

test('subscribers are notified only on actual change', () => {
  setGlobalSearchQuery('');
  const seen = [];
  const unsubscribe = subscribeGlobalSearch((q) => seen.push(q));
  setGlobalSearchQuery('dual');
  setGlobalSearchQuery('dual'); // no-op: same value
  setGlobalSearchQuery('');
  assert.deepEqual(seen, ['dual', '']);
  unsubscribe();
  setGlobalSearchQuery('after-unsub');
  assert.deepEqual(seen, ['dual', '']);
  setGlobalSearchQuery('');
});

test('non-string input coerces to empty string instead of throwing', () => {
  setGlobalSearchQuery('x');
  setGlobalSearchQuery(null);
  assert.equal(getGlobalSearchQuery(), '');
  setGlobalSearchQuery(undefined);
  assert.equal(getGlobalSearchQuery(), '');
});

test('subscribeGlobalSearch rejects non-function listeners', () => {
  assert.throws(() => subscribeGlobalSearch('nope'), TypeError);
});
