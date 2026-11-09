#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const selfPath = fileURLToPath(import.meta.url);
const root = dirname(dirname(selfPath));
const dir = join(root, 'tests');

let names;
try {
  names = readdirSync(dir);
} catch {
  console.error(`run-tests: no tests directory at ${dir}`);
  process.exit(1);
}

const files = names
  .filter((name) => name.endsWith('.test.mjs'))
  .sort()
  .map((name) => join(dir, name));

if (files.length === 0) {
  console.error(`run-tests: no *.test.mjs files in ${dir}`);
  process.exit(1);
}

// Run suites in a single test runner process (`--test-isolation=none` on Node >= 22.8,
// or single-entrypoint dynamic import on Node 20) to avoid Windows Node 22/24 child-worker
// WebCrypto CppgcMixin / ContextifyScript teardown crashes (nodejs/node#65756).
if (process.env.MYCLINIC_SINGLE_PROCESS_TESTS === '1') {
  for (const file of files) {
    await import(pathToFileURL(file).href);
  }
} else {
  const [major = 0, minor = 0] = process.versions.node
    .split('.')
    .map((part) => Number.parseInt(part, 10));
  const supportsIsolationNone = major > 22 || (major === 22 && minor >= 8);

  const extra = process.argv.slice(2);
  const hasIsolationFlag = extra.some((arg) =>
    arg.startsWith('--test-isolation'),
  );
  const runnerArgs = [
    '--test',
    ...(supportsIsolationNone && !hasIsolationFlag
      ? ['--test-isolation=none']
      : []),
    ...extra,
    ...(supportsIsolationNone ? files : [selfPath]),
  ];

  const run = spawnSync(process.execPath, runnerArgs, {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      MYCLINIC_SINGLE_PROCESS_TESTS: supportsIsolationNone ? '0' : '1',
    },
  });

  if (run.error) {
    console.error(
      `run-tests: could not start node --test — ${run.error.message}`,
    );
    process.exit(1);
  }
  process.exit(run.status ?? 1);
}
