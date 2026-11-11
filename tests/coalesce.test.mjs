import test from 'node:test';
import assert from 'node:assert/strict';
import { coalesce, inflightReadCount } from '../src/lib/coalesce.mjs';

test('concurrent callers of one key share a single build', async () => {
  let builds = 0;
  const build = () => {
    builds += 1;
    return new Promise((resolve) => setTimeout(() => resolve('rows'), 5));
  };
  const [a, b, c] = await Promise.all([
    coalesce('t1-share', build),
    coalesce('t1-share', build),
    coalesce('t1-share', build),
  ]);
  assert.equal(builds, 1);
  assert.deepEqual([a, b, c], ['rows', 'rows', 'rows']);
  assert.equal(inflightReadCount(), 0);
});

test('sequential calls refetch — no TTL, no stale memoisation', async () => {
  let builds = 0;
  const build = () => {
    builds += 1;
    return Promise.resolve(builds);
  };
  const first = await coalesce('t2-seq', build);
  const second = await coalesce('t2-seq', build);
  assert.equal(first, 1);
  assert.equal(second, 2);
});

test('distinct keys stay independent even when concurrent', async () => {
  let builds = 0;
  const build = () => {
    builds += 1;
    return new Promise((resolve) => setTimeout(() => resolve(builds), 3));
  };
  await Promise.all([coalesce('t3-a', build), coalesce('t3-b', build)]);
  assert.equal(builds, 2);
});

test('a rejected read clears its key so the retry rebuilds', async () => {
  let attempts = 0;
  const build = () => {
    attempts += 1;
    return attempts === 1
      ? Promise.reject(new Error('network down'))
      : Promise.resolve('recovered');
  };
  await assert.rejects(() => coalesce('t4-flaky', build), /network down/);
  assert.equal(inflightReadCount(), 0);
  const retry = await coalesce('t4-flaky', build);
  assert.equal(retry, 'recovered');
  assert.equal(attempts, 2);
});

test('a synchronously throwing build rejects instead of escaping', async () => {
  await assert.rejects(
    () =>
      coalesce('t5-sync-throw', () => {
        throw new Error('boom');
      }),
    /boom/,
  );
  assert.equal(inflightReadCount(), 0);
});
