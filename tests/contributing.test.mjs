import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SECRET_SCAN_SKIP,
  findSecrets,
  namingProblems,
  runChecks,
  unbalancedListeners,
  unsafeHtml,
} from '../scripts/check-contributing.mjs';

const fake = (...parts) => parts.join('');

test('check-contributing detectors catch raw HTML, unbalanced listeners, and bad naming', () => {
  assert.equal(
    unsafeHtml('src/Bad.jsx', '<div dangerouslySetInnerHTML={{ __html: x }} />'),
    'src/Bad.jsx',
  );
  assert.equal(unsafeHtml('src/Good.jsx', '<div>{x}</div>'), null);

  assert.ok(
    unbalancedListeners(
      'src/Leak.jsx',
      "window.addEventListener('resize', fn);",
    ),
  );
  assert.equal(
    unbalancedListeners(
      'src/Clean.jsx',
      "window.addEventListener('resize', fn); window.removeEventListener('resize', fn);",
    ),
    null,
  );

  assert.equal(namingProblems(['src/pages/EntitlementsPage.jsx']).length, 0);
  assert.equal(namingProblems(['src/pages/bad_name.jsx']).length, 1);
  assert.equal(namingProblems(['src/lib/BadUpper.mjs']).length, 1);

  assert.ok(
    !SECRET_SCAN_SKIP.includes('tests/'),
    'tests/ must be scanned so GitHub Secret Scanning never sees a fixture leak',
  );

  const cases = [
    [fake('-----BEGIN RSA', ' PRIVATE KEY-----'), 'private-key'],
    [fake('const k = "sb', '_secret_', 'abcdefghijklmnopqrst"'), 'supabase-secret'],
    [fake('AKIA', 'IOSFODNN7EXAMPLE'), 'aws'],
    [fake('ghp', '_aB3dE5gH7jK9mN1pQ2sT4vW6yZ8bC0dE1fG3'), 'github-token'],
    [fake('sk-', '12345678901234567890abcd'), 'openai'],
    [fake('AIza', 'SyA1234567890abcdefghijklmnopqrstuv'), 'google-api'],
  ];
  for (const [line, expectedId] of cases) {
    const hits = findSecrets('tests/fixture.test.mjs', line);
    assert.equal(hits[0]?.id, expectedId);
  }
});

test('this repository passes all CONTRIBUTING.md checks with 0 failures and 0 warnings', () => {
  const outcome = runChecks();
  assert.deepEqual(outcome.failures, []);
  assert.deepEqual(outcome.warnings, []);
});
