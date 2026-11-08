#!/usr/bin/env node
/**
 * One-command automated helper for Step 2:
 *   npm run deploy:signer -- --project-ref <AUTHORITY_PROJECT_REF>
 *
 * 1. Reads VITE_SUPABASE_URL from .env.local if --project-ref is omitted.
 * 2. Generates (or reuses) an RS256 keypair inside gitignored `keys/` if LICENSE_PRIVATE_KEY is unset.
 * 3. Sets LICENSE_PRIVATE_KEY on the Authority Supabase project and deploys `verify-license --no-verify-jwt`.
 */
import { generateKeyPairSync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const keysDir = join(root, 'keys');
const privPath = join(keysDir, 'license_private_pkcs8.pem');
const pubPath = join(keysDir, 'license_public_spki.pem');

function parseArgs(argv) {
  const out = { projectRef: '', dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--project-ref' && argv[i + 1]) {
      out.projectRef = argv[i + 1].trim();
      i += 1;
    } else if (argv[i] === '--dry-run') {
      out.dryRun = true;
    }
  }
  return out;
}

function detectProjectRefFromEnvFile() {
  for (const candidate of ['.env.local', '.env']) {
    const file = join(root, candidate);
    if (!existsSync(file)) continue;
    const text = readFileSync(file, 'utf8');
    const match = /VITE_SUPABASE_URL\s*=\s*["']?https:\/\/([a-z0-9-]+)\.supabase\.co/i.exec(
      text,
    );
    if (match?.[1]) return match[1];
  }
  return '';
}

function ensureLocalKeyPair() {
  if (process.env.LICENSE_PRIVATE_KEY) {
    return {
      privateKeyEscaped: process.env.LICENSE_PRIVATE_KEY.trim().replace(/\r?\n/g, '\\n'),
      publicKeyEscaped: (process.env.LICENSE_PUBLIC_KEY ?? '').trim().replace(/\r?\n/g, '\\n'),
      source: 'environment variable',
    };
  }

  mkdirSync(keysDir, { recursive: true });
  if (existsSync(privPath) && existsSync(pubPath)) {
    const priv = readFileSync(privPath, 'utf8').trim();
    const pub = readFileSync(pubPath, 'utf8').trim();
    return {
      privateKeyEscaped: priv.replace(/\r?\n/g, '\\n'),
      publicKeyEscaped: pub.replace(/\r?\n/g, '\\n'),
      source: 'existing keys/ directory',
    };
  }

  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  writeFileSync(privPath, privateKey, { mode: 0o600 });
  writeFileSync(pubPath, publicKey, { mode: 0o644 });
  return {
    privateKeyEscaped: privateKey.trim().replace(/\r?\n/g, '\\n'),
    publicKeyEscaped: publicKey.trim().replace(/\r?\n/g, '\\n'),
    source: 'newly generated into gitignored keys/',
  };
}

function runSupabaseStep(label, args) {
  console.info(`\n→ ${label}...`);
  const npxBin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const res = spawnSync(npxBin, ['supabase', ...args], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (res.error || res.status !== 0) {
    console.error(
      `\n✗ ${label} failed. Tip: run \`npx supabase login\` first, or use the zero-terminal "Supabase Dashboard Script" tab in #/guide.`,
    );
    process.exit(res.status || 1);
  }
}

const args = parseArgs(process.argv.slice(2));
const projectRef =
  args.projectRef ||
  process.env.SUPABASE_PROJECT_REF?.trim() ||
  detectProjectRefFromEnvFile();

if (!projectRef || projectRef.includes('YOUR_')) {
  console.error(
    [
      '✗ Could not determine your Authority Supabase project ref.',
      '  Fix: set VITE_SUPABASE_URL=https://<project-ref>.supabase.co in .env.local,',
      '  or run: npm run deploy:signer -- --project-ref <YOUR_PROJECT_REF>',
      '  (Or skip the terminal completely using Step 2 → "Supabase Dashboard Script" in #/guide!)',
    ].join('\n'),
  );
  process.exit(1);
}

const keys = ensureLocalKeyPair();
console.info(`✓ RS256 keypair ready (${keys.source})`);
console.info(`✓ Target Authority Supabase project: ${projectRef}`);

if (args.dryRun) {
  console.info('✓ Dry run complete — no remote Supabase changes executed.');
  process.exit(0);
}

runSupabaseStep('Setting LICENSE_PRIVATE_KEY secret on Supabase', [
  'secrets',
  'set',
  `LICENSE_PRIVATE_KEY=${keys.privateKeyEscaped}`,
  '--project-ref',
  projectRef,
]);

runSupabaseStep('Deploying verify-license Edge Function (--no-verify-jwt)', [
  'functions',
  'deploy',
  'verify-license',
  '--no-verify-jwt',
  '--project-ref',
  projectRef,
]);

console.info('\n✓ verify-license signer deployed!');
if (keys.publicKeyEscaped) {
  console.info('\nCopy this public key into myClinic (VITE_LICENSE_PUBLIC_KEY / LICENSE_PUBLIC_KEY):\n');
  console.info(`VITE_LICENSE_PUBLIC_KEY="${keys.publicKeyEscaped}"\n`);
}
