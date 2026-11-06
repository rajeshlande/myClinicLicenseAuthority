import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findSecrets,
  namingProblems,
  runChecks,
  unbalancedListeners,
  unsafeHtml,
} from '../scripts/check-contributing.mjs';

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

  const secretHit = findSecrets(
    'src/leak.js',
    ['const k = "', 'sk-', '12345678901234567890abcd";'].join(''),
  );
  assert.equal(secretHit.length, 1);
});

test('this repository passes all CONTRIBUTING.md checks with 0 failures and 0 warnings', () => {
  const outcome = runChecks();
  assert.deepEqual(outcome.failures, []);
  assert.deepEqual(outcome.warnings, []);
});
