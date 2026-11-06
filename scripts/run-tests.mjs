#!/usr/bin/env node
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
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

const extra = process.argv.slice(2);
const run = spawnSync(process.execPath, ['--test', ...extra, ...files], {
  cwd: root,
  stdio: 'inherit',
});

if (run.error) {
  console.error(`run-tests: could not start node --test — ${run.error.message}`);
  process.exit(1);
}
process.exit(run.status ?? 1);
