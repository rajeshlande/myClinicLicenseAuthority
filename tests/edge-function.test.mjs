import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const edgeSource = readFileSync(
  'supabase/functions/verify-license/index.ts',
  'utf8',
);

test('verify-license Edge Function enforces CORS, standing checks, hardware lock, and RS256', () => {
  assert.match(edgeSource, /@supabase\/supabase-js@2\.119\.0/);
  assert.match(edgeSource, /djwt@v3\.0\.2/);
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
});
