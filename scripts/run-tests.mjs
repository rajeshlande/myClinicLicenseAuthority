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

// Run suites in a single test runner process (`--test-isolation=none` where the
// flag exists, or single-entrypoint dynamic import where it does not) to avoid
// Windows Node 22/24 child-worker WebCrypto CppgcMixin / ContextifyScript
// teardown crashes (nodejs/node#65756).
if (process.env.MYCLINIC_SINGLE_PROCESS_TESTS === '1') {
  for (const file of files) {
    await import(pathToFileURL(file).href);
  }
} else {
  // `--test-isolation` only shipped stable in Node 24. Node 22 has the
  // EXPERIMENTAL spelling and Node 20 has neither: passing the stable name to
  // either aborts with "bad option: --test-isolation=none" before a single test
  // runs — which is what the Node 22 job in ci.yml did. Probe the binary rather
  // than guessing from a version number; the npm-distributed and Actions builds
  // have disagreed on this before.
  const probe = spawnSync(
    process.execPath,
    ['--test-isolation=none', '--version'],
    { stdio: 'ignore' },
  );
  const supportsIsolationNone = probe.status === 0 && !probe.error;

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
