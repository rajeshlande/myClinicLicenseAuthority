import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * S9: the console's worker claims only the base it was built for.
 *
 * Source assertions, because scope is decided at registration and nothing at
 * runtime notices a worker that quietly widened its reach until a second app on
 * the same origin starts serving the first app's HTML. The default-scope
 * registration is the exact shape S9 forbids.
 */
const main = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
const sw = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');

test('registration is scoped to the build base, never the default', () => {
  const call = main.match(/serviceWorker\.register\(([^;]*?)\)\.catch/s);
  assert.ok(call, 'the registration call changed shape; update this test');
  assert.match(call[1], /\{ scope: swBase \}/, 'registration dropped its scope option');
  assert.match(call[1], /`\$\{swBase\}sw\.js`/, 'the worker path no longer follows the base');
  assert.match(main, /typeof __BUILD_BASE__ === 'string' \? __BUILD_BASE__ : '\.\/'/,
    'the Node-safe base fallback changed');
});

test('the worker still refuses cross-origin and Supabase calls', () => {
  const skip = sw.slice(sw.indexOf('const url = new URL(request.url);'));
  for (const path of ['/rest/v1/', '/auth/v1/', '/functions/v1/']) {
    assert.ok(skip.includes(`'${path}'`), `${path} is not skipped`);
  }
  assert.match(skip, /url\.origin !== self\.location\.origin/);
});
