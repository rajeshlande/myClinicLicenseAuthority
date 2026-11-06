import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('vendored Cloudflare security-audit skill validators pass their upstream self-tests', () => {
  for (const suite of [
    '.claude/skills/security-audit/validate-findings.test.cjs',
    '.claude/skills/security-audit/validate-coverage-ledger.test.cjs',
  ]) {
    const res = spawnSync(process.execPath, [suite], { encoding: 'utf8' });
    assert.equal(
      res.status,
      0,
      `${suite} failed:\n${res.stdout}\n${res.stderr}`,
    );
  }
});

test('validate-findings.cjs accepts a valid zero-finding audit report envelope', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-check-'));
  const samplePath = path.join(tmpDir, 'findings.json');
  try {
    fs.writeFileSync(samplePath, JSON.stringify([], null, 2));

    const run = spawnSync(
      process.execPath,
      ['.claude/skills/security-audit/validate-findings.cjs', samplePath],
      { encoding: 'utf8' },
    );
    assert.equal(run.status, 0, run.stderr || run.stdout);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
