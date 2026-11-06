#!/usr/bin/env node
/**
 * RSA-2048 Asymmetric Keypair Generator (PKCS#8 Private Key + SPKI Public Key)
 *
 * Prints `.env`-ready keys to stdout by default. Pass `--write` to also save
 * PEM files into the gitignored `./keys/` folder.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateRsaKeyPairPem } from '../src/lib/crypto-rs256.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const shouldWrite = process.argv.includes('--write');
const asJson = process.argv.includes('--json');

const { privateKeyPem, publicKeyPem, privateKeyEnv, publicKeyEnv } =
  await generateRsaKeyPairPem();

if (shouldWrite) {
  const keysDir = join(__dirname, '..', 'keys');
  mkdirSync(keysDir, { recursive: true });
  writeFileSync(join(keysDir, 'license_private_pkcs8.pem'), privateKeyPem, {
    mode: 0o600,
  });
  writeFileSync(join(keysDir, 'license_public_spki.pem'), publicKeyPem, {
    mode: 0o644,
  });
}

if (asJson) {
  console.log(
    JSON.stringify(
      {
        LICENSE_PRIVATE_KEY: privateKeyEnv,
        LICENSE_PUBLIC_KEY: publicKeyEnv,
      },
      null,
      2,
    ),
  );
} else {
  console.log('# --- Supabase Edge Function Secret (NEVER commit or ship) ---');
  console.log(`LICENSE_PRIVATE_KEY="${privateKeyEnv}"\n`);
  console.log('# --- Distributed Local myClinic Container .env ---');
  console.log(`LICENSE_PUBLIC_KEY="${publicKeyEnv}"`);
}
