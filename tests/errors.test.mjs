import assert from 'node:assert/strict';
import test from 'node:test';
import { copyTextToClipboard } from '../src/lib/clipboard.mjs';
import {
  buildAdminGrantSql,
  clearRecentErrors,
  diagnosticsText,
  errorLine,
  explainError,
  fetchWithTimeout,
  missingColumn,
  missingSchemaObject,
  probeVerifyLicenseEndpoint,
  recentErrors,
  rememberError,
  sanitizeDiagnosticText,
  validateEndpointUrlInput,
  validatePublicKeyPemInput,
} from '../src/lib/errors.mjs';

test('explainError maps schema, RLS, auth, seat limit, kill-switch, network, and Edge errors into actionable fixes', () => {
  const missingCol = explainError(
    {
      code: 'PGRST204',
      message: "Could not find the 'notes' column of 'licenses' in the schema cache",
    },
    { context: 'Issue license' },
  );
  assert.equal(missingCol.fix, 'schema');
  assert.match(missingCol.message, /notes/);
  assert.match(missingCol.hint, /supabase\/schema\.sql/);
  assert.deepEqual(missingColumn(missingCol.detail), {
    column: 'notes',
    table: 'licenses',
  });

  const missingView = explainError(
    {
      code: '42P01',
      message: 'relation "public.admin_license_view" does not exist',
    },
    { context: 'Load fleet' },
  );
  assert.equal(missingView.fix, 'schema');
  assert.deepEqual(
    missingSchemaObject('relation "public.admin_license_view" does not exist'),
    { kind: 'relation', name: 'public.admin_license_view' },
  );

  const seatCap = explainError(
    { code: '53400', message: 'MAX_MACHINES_EXCEEDED: hardware lock limit reached' },
    { context: 'Verify license' },
  );
  assert.equal(seatCap.fix, 'seat_limit');
  assert.match(seatCap.hint, /Release/i);

  const killed = explainError(
    { code: 'KEY_KILLED', message: 'KEY_KILLED: license suspended' },
    { context: 'Sync clinic' },
  );
  assert.equal(killed.fix, 'license_state');
  assert.match(killed.hint, /Enable/);

  const nonAdmin = explainError(
    { code: '42501', message: 'new row violates row-level security policy' },
    { context: 'Create subscription' },
  );
  assert.equal(nonAdmin.fix, 'role');
  assert.match(nonAdmin.hint, /Admin Role SQL/);

  const badLogin = explainError(
    { message: 'Invalid login credentials' },
    { context: 'Sign in' },
  );
  assert.equal(badLogin.fix, 'credentials');

  const expiredJwt = explainError(
    { status: 401, message: 'JWT expired' },
    { context: 'Load licenses' },
  );
  assert.equal(expiredJwt.fix, 'signin');

  const edgeDown = explainError(
    { status: 502, message: 'LICENSE_PRIVATE_KEY secret not configured' },
    { context: 'Heartbeat' },
  );
  assert.equal(edgeDown.fix, 'edge_config');
  assert.match(edgeDown.hint, /deploy verify-license/);

  const offline = explainError(
    { message: 'TypeError: Failed to fetch' },
    { context: 'Fetch view' },
  );
  assert.equal(offline.fix, 'network');
  assert.ok(errorLine({ message: 'TypeError: Failed to fetch' }).includes('Check'));
});

test('sanitizeDiagnosticText and rememberError redact JWTs, PEM keys, Supabase secrets, and 32-hex license keys', () => {
  clearRecentErrors();

  const fakeJwt = [
    'eyJhbGciOiJSUzI1NiJ9',
    'eyJzdWIiOiIxMjM0NTY3ODkwIn0',
    'signatureBlock123456',
  ].join('.');
  const fakeHexKey = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
  const beginPriv = ['-----BEGIN', 'PRIVATE KEY-----'].join(' ');
  const endPriv = ['-----END', 'PRIVATE KEY-----'].join(' ');
  const fakePem = `${beginPriv}\nMIIEvAIBADANBg==\n${endPriv}`;
  const fakeSbSecret = ['sb_secret', 'live999'].join('_');

  const scrubbed = sanitizeDiagnosticText(
    `token=${fakeJwt} key=${fakeHexKey} secret=${fakeSbSecret} pem=${fakePem}`,
  );
  assert.doesNotMatch(scrubbed, /eyJhbGci/);
  assert.doesNotMatch(scrubbed, /a1b2c3d4e5f6/i);
  assert.doesNotMatch(scrubbed, /sb_secret_live999/);
  assert.doesNotMatch(scrubbed, /MIIEvAIBADANBg/);
  assert.match(scrubbed, /\[REDACTED_JWT\]/);
  assert.match(scrubbed, /\[REDACTED_LICENSE_KEY\]/);
  assert.match(scrubbed, /\[REDACTED_SUPABASE_SECRET\]/);
  assert.match(scrubbed, /\[REDACTED_PEM_KEY\]/);

  rememberError(`Failed for ${fakeHexKey}`, 'Sync check');
  assert.equal(recentErrors().length, 1);

  const report = diagnosticsText({ app: '1.5.0', schema: 1, route: 'setup' });
  assert.match(report, /myClinicLicenseAuthority v1\.5\.0 · schema v1 · route #\/setup/);
  assert.doesNotMatch(report, /a1b2c3d4e5f6/i);

  clearRecentErrors();
  assert.equal(recentErrors().length, 0);
});

test('validatePublicKeyPemInput, validateEndpointUrlInput, buildAdminGrantSql, and fetchWithTimeout guard operator inputs', async () => {
  const beginPriv = ['-----BEGIN', 'PRIVATE KEY-----'].join(' ');
  const endPriv = ['-----END', 'PRIVATE KEY-----'].join(' ');
  const privateLeak = validatePublicKeyPemInput(
    `${beginPriv}\nabc\n${endPriv}`,
  );
  assert.equal(privateLeak.ok, false);
  assert.match(privateLeak.error, /PRIVATE KEY/);

  const validSpki = validatePublicKeyPemInput(
    '-----BEGIN PUBLIC KEY-----\\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A\\n-----END PUBLIC KEY-----',
  );
  assert.equal(validSpki.ok, true);
  assert.match(validSpki.escaped, /\\n/);

  assert.equal(
    validateEndpointUrlInput('http://insecure-remote.example.com').ok,
    false,
  );
  assert.equal(
    validateEndpointUrlInput('https://demo-ref.supabase.co/').normalized,
    'https://demo-ref.supabase.co',
  );
  assert.equal(
    validateEndpointUrlInput('http://localhost:54321').ok,
    true,
  );

  const sql = buildAdminGrantSql("Dr.O'Connor@Clinic.in");
  assert.match(sql, /dr\.o''connor@clinic\.in/);

  await assert.rejects(
    () =>
      fetchWithTimeout(
        'https://example.invalid/verify',
        {},
        15,
        (_url, opts) =>
          new Promise((_resolve, reject) => {
            opts.signal.addEventListener('abort', () => {
              const abortErr = new Error('Aborted');
              abortErr.name = 'AbortError';
              reject(abortErr);
            });
          }),
      ),
    (err) => err.code === 'ETIMEDOUT',
  );
});

test('copyTextToClipboard succeeds with navigator.clipboard and returns structured error when unavailable', async () => {
  let written = '';
  const okRes = await copyTextToClipboard('HELLO_KEY', {
    navigator: {
      clipboard: {
        writeText: async (v) => {
          written = v;
        },
      },
    },
  });
  assert.deepEqual(okRes, { ok: true });
  assert.equal(written, 'HELLO_KEY');

  const emptyRes = await copyTextToClipboard('', {});
  assert.equal(emptyRes.ok, false);

  const blockedRes = await copyTextToClipboard('TEXT', {});
  assert.equal(blockedRes.ok, false);
  assert.match(blockedRes.error, /Clipboard/i);
});

test('probeVerifyLicenseEndpoint distinguishes Verify-JWT-ON, missing secret, undeployed function, and healthy signer', async () => {
  // 1. Healthy signer with healthcheck
  const okProbe = await probeVerifyLicenseEndpoint('https://ref.supabase.co/functions/v1/verify-license', {
    fetchImpl: async () => ({
      status: 200,
      json: async () => ({ ok: true, signer_ready: true }),
    }),
  });
  assert.equal(okProbe.ok, true);
  assert.equal(okProbe.signerVerified, true);

  // 2. Unauthed fails with CORS TypeError: Failed to fetch, authed succeeds => Verify JWT is left ON!
  let callCount = 0;
  await assert.rejects(
    () =>
      probeVerifyLicenseEndpoint('https://ref.supabase.co/functions/v1/verify-license', {
        anonKey: 'sb_publishable_demo',
        fetchImpl: async (_url, opts) => {
          callCount += 1;
          if (!opts.headers?.Authorization) {
            throw new TypeError('Failed to fetch');
          }
          return { status: 400, json: async () => ({ error: 'license_key' }) };
        },
      }),
    (err) => {
      const explained = explainError(err, { context: 'Test verify-license' });
      assert.equal(err.code, 'EDGE_JWT_ENABLED');
      assert.equal(explained.fix, 'edge_jwt');
      assert.match(explained.hint, /Verify JWT/i);
      return true;
    },
  );
  assert.equal(callCount, 2);

  // 3. Both fail with TypeError: Failed to fetch => Function not deployed yet!
  await assert.rejects(
    () =>
      probeVerifyLicenseEndpoint('https://ref.supabase.co/functions/v1/verify-license', {
        anonKey: 'sb_publishable_demo',
        fetchImpl: async () => {
          throw new TypeError('Failed to fetch');
        },
      }),
    (err) => {
      const explained = explainError(err, { context: 'Test verify-license' });
      assert.equal(err.code, 'EDGE_NOT_DEPLOYED');
      assert.equal(explained.fix, 'edge_not_deployed');
      return true;
    },
  );

  // 4. Function deployed, Verify JWT OFF, but LICENSE_PRIVATE_KEY secret not set yet
  await assert.rejects(
    () =>
      probeVerifyLicenseEndpoint('https://ref.supabase.co/functions/v1/verify-license', {
        fetchImpl: async () => ({
          status: 503,
          json: async () => ({ ok: false, code: 'SIGNER_SECRET_MISSING' }),
        }),
      }),
    (err) => {
      const explained = explainError(err, { context: 'Test verify-license' });
      assert.equal(err.code, 'SIGNER_SECRET_MISSING');
      assert.equal(explained.fix, 'edge_secret');
      return true;
    },
  );
});
