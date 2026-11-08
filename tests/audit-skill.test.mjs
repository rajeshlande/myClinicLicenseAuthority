import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const schema = require('../.claude/skills/security-audit/report-schema.json');
const findingsValidator = require('../.claude/skills/security-audit/validate-findings.cjs');
const ledgerValidator = require('../.claude/skills/security-audit/validate-coverage-ledger.cjs');

const HAS_POSIX_SAFE_OPEN =
  Number.isInteger(fs.constants.O_NOFOLLOW) &&
  fs.constants.O_NOFOLLOW !== 0 &&
  Number.isInteger(fs.constants.O_NONBLOCK) &&
  fs.constants.O_NONBLOCK !== 0;

test('vendored Cloudflare security-audit validators work cross-platform (Windows, macOS, Linux)', () => {
  // 1. Cross-platform programmatic schema + semantic validators (works on Windows & POSIX)
  assert.deepEqual(findingsValidator.validateDocument([], schema), []);

  const badFindingErrors = findingsValidator.validateDocument(
    [{ verdict: 'confirmed', fingerprint: 'bad' }],
    schema,
  );
  assert.ok(badFindingErrors.length > 0, 'Incomplete confirmed finding must be rejected');

  assert.deepEqual(ledgerValidator.validateDocument([]), []);
  const covId = ledgerValidator.canonicalCoverageId({
    surface: 'server/node-host.mjs#GET /api/clinic/entitlements',
    boundary: 'server/license-middleware.mjs#createLicenseMiddleware',
    subsystem: 'server',
    attack_class: 'ATTACK-CLASSES.md#Cryptography and secrets',
  });
  assert.match(covId, /::server::/);

  // 2. Upstream CLI suites use POSIX O_NOFOLLOW | O_NONBLOCK; run full CLI suites on POSIX
  if (HAS_POSIX_SAFE_OPEN) {
    for (const suite of [
      '.claude/skills/security-audit/validate-findings.test.cjs',
      '.claude/skills/security-audit/validate-coverage-ledger.test.cjs',
    ]) {
      const res = spawnSync(process.execPath, ['--test', suite], {
        encoding: 'utf8',
      });
      assert.equal(
        res.status,
        0,
        `${suite} failed:\n${res.stdout}\n${res.stderr}`,
      );
    }
  }
});

test('validate-findings.cjs CLI enforces safe input handling across POSIX and Windows', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-check-'));
  const samplePath = path.join(tmpDir, 'findings.json');
  try {
    fs.writeFileSync(samplePath, JSON.stringify([], null, 2));

    const run = spawnSync(
      process.execPath,
      ['.claude/skills/security-audit/validate-findings.cjs', samplePath],
      { encoding: 'utf8' },
    );

    if (HAS_POSIX_SAFE_OPEN) {
      assert.equal(run.status, 0, run.stderr || run.stdout);
      assert.match(run.stdout, /PASS: 0 findings valid/);
    } else {
      // On Windows (where O_NOFOLLOW / O_NONBLOCK are unavailable), the CLI
      // intentionally fails closed rather than opening untrusted paths unsafely.
      assert.equal(run.status, 1);
      assert.match(
        run.stderr,
        /OS no-follow and nonblocking input protection is unavailable/,
      );
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
