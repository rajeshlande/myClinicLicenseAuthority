import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import {
  generateRsaKeyPairPem,
  verifyCapabilityJwt,
} from '../src/lib/crypto-rs256.mjs';

const edgeSource = readFileSync(
  'supabase/functions/verify-license/index.ts',
  'utf8',
);

test('verify-license Edge Function is self-contained for Supabase Dashboard Editor & enforces RS256 invariants', async () => {
  assert.match(edgeSource, /@supabase\/supabase-js@2\.119\.0/);
  assert.doesNotMatch(
    edgeSource,
    /deno\.land\/x\/djwt/,
    'verify-license must use built-in WebCrypto RS256 signing so it pastes cleanly into Supabase Dashboard Editor',
  );
  assert.match(edgeSource, /function signRs256Jwt/);
  assert.match(edgeSource, /req\.method === "OPTIONS"/);
  assert.match(edgeSource, /!licenseRecord\.is_active/);
  assert.match(edgeSource, /subscription\.status !== "active"/);
  assert.match(edgeSource, /currentNodes >= subscription\.max_machines/);
  assert.match(edgeSource, /RSASSA-PKCS1-v1_5/);
  assert.match(edgeSource, /alg:\s*"RS256"/);
  assert.match(edgeSource, /60 \* 60 \* 24 \* 7/);
  assert.match(
    edgeSource,
    /\.\.\.\(effectiveOrigin \? \{ allowed_origin: effectiveOrigin \} : \{\}\)/,
    'verify-license must populate allowed_origin for server-to-server sync-clinic-license web:<origin> calls',
  );
  assert.doesNotMatch(
    edgeSource,
    /err instanceof Error\s*\?\s*err\.message/,
    'Unhandled 500 catch block must not echo raw internal Error.message strings',
  );

  // Verify the exact WebCrypto RS256 JWT signing format matches both WebCrypto & jsonwebtoken verifiers
  const { privateKeyPem, publicKeyPem } = await generateRsaKeyPairPem();
  const base64Body = privateKeyPem
    .replace(/-----(?:BEGIN|END) [A-Z0-9 ]+-----/g, '')
    .replace(/\s+/g, '');
  const keyDer = Buffer.from(base64Body, 'base64');
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    'pkcs8',
    keyDer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const nowSec = Math.floor(Date.now() / 1000);
  const b64url = (buf) =>
    Buffer.from(buf)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  const headerSeg = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payloadSeg = b64url(
    JSON.stringify({
      iss: 'myclinic-license-authority',
      sub: '00000000-0000-0000-0000-000000000001',
      license_key: 'ABCDEF0123456789ABCDEF0123456789',
      tier: 'growth',
      machine_fingerprint: 'web:https://clinic.example.com',
      allowed_origin: 'https://clinic.example.com',
      max_machines: 2,
      subscription_expires_at: new Date(Date.now() + 86400_000 * 30).toISOString(),
      iat: nowSec,
      exp: nowSec + 60 * 60 * 24 * 7,
    }),
  );
  const sigBuf = await globalThis.crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    cryptoKey,
    new TextEncoder().encode(`${headerSeg}.${payloadSeg}`),
  );
  const signedJwt = `${headerSeg}.${payloadSeg}.${b64url(new Uint8Array(sigBuf))}`;

  const webCheck = await verifyCapabilityJwt(signedJwt, publicKeyPem, {
    expectedFingerprint: 'web:https://clinic.example.com',
    expectedOrigin: 'https://clinic.example.com',
  });
  assert.equal(webCheck.valid, true);
  assert.equal(webCheck.claims.tier, 'growth');

  const nodeDecoded = jwt.verify(signedJwt, publicKeyPem, {
    algorithms: ['RS256'],
    issuer: 'myclinic-license-authority',
  });
  assert.equal(nodeDecoded.tier, 'growth');
});
