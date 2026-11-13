import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CLINICAL_TABLES,
  DIRECTORY_AUTHORITY_ALLOWLIST,
  collectSourceFiles,
  findAdminStaticViolations,
  findDistViolations,
  isPlaceholderHost,
} from '../scripts/check-admin-static.mjs';

/* P6 · §12.1 item 1 — "Master Admin App contains zero dynamic tenant-switching logic",
 * enforced intent-faithfully on Central (owner decision p6_item1_admin_static =
 * intent_allowlist). §12.2 requires every ratchet to FAIL on its injected mutation,
 * so each rule below gets an offender that is caught and a neighbour that is not. */

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const entry = (file, text) => [{ file, text }];
const rules = (vs) => vs.map((v) => v.rule);

// Assembled at runtime so no credential- or host-shaped literal sits in a tracked file.
const tenantHost = ['https://acme-dental', '-9f3', '.supabase.co'].join('');
const secretKey = ['sb', 'secret', 'AbC0123456789xyzAbC'].join('_');

// A minimal one-client app: the baseline the mutations are injected into. The import
// line has no call paren, so only the construction counts.
const ONE_CLIENT = [{
  file: 'src/lib/supabase.js',
  text: "import { createClient } from '@supabase/supabase-js';\nconst c = createClient(url, key, {});\n",
}];

test('item 1: the real Central src passes clean (one Master client, no tenant switching)', () => {
  const files = collectSourceFiles(ROOT);
  assert.ok(files.length > 20, `scanned ${files.length} source files`);
  const entries = files.map((file) => ({ file, text: read(file) }));
  assert.deepEqual(findAdminStaticViolations(entries), [], 'Central src is item-1 clean');
  const count = entries.reduce((n, e) => n + (e.text.match(/createClient\s*\(/g) ?? []).length, 0);
  assert.equal(count, 1, 'exactly one Master client across the whole admin app');
});

test('item 1 MUTATION: a second createClient is caught (§12.2)', () => {
  const two = [...ONE_CLIENT, { file: 'src/lib/tenant-client.js', text: 'const t = createClient(tenantUrl, tenantKey, {});\n' }];
  const vs = findAdminStaticViolations(two);
  assert.ok(rules(vs).includes('create-client-count'), 'a second client fails the count rule');
  assert.match(vs.find((v) => v.rule === 'create-client-count').detail, /found 2/);
  // and zero clients fails too — the app must build its Master client
  assert.ok(rules(findAdminStaticViolations(entry('src/lib/x.js', 'const a = 1;'))).includes('create-client-count'));
});

test('item 1 MUTATION: dynamic tenant switching is caught', () => {
  for (const marker of ['mountTenant(row)', 'disposeTenant()', 'const tenantClient = make()', 'useTenantClient()', 'VITE_TENANT_SUPABASE_URL']) {
    const vs = findAdminStaticViolations([{ file: 'src/lib/supabase.js', text: `const c = createClient(u,k,{}); ${marker}` }]);
    assert.ok(rules(vs).includes('tenant-switch'), `${marker} is dynamic tenant switching`);
  }
});

test('item 1 MUTATION: a clinical/PHI table read is caught, a Master-side table is not', () => {
  for (const table of ['patients', 'appointments', 'consultations', 'day_closes', 'reminders', 'profiles']) {
    const vs = findAdminStaticViolations([{ file: 'src/pages/X.jsx', text: `const c = createClient(u,k,{}); c.from('${table}').select()` }]);
    assert.ok(rules(vs).includes('clinical-table'), `.from('${table}') reads PHI`);
  }
  // Central's OWN Master-side tables are not clinical (its `invoices` are subscription billing).
  for (const table of ['invoices', 'subscriptions', 'licenses', 'clinic_activity_log', 'activated_machines', 'admin_license_view']) {
    const vs = findAdminStaticViolations([{ file: 'src/lib/supabase.js', text: `const c = createClient(u,k,{}); c.from('${table}').select()` }]);
    assert.ok(!rules(vs).includes('clinical-table'), `${table} is Master-side, not clinical`);
  }
});

test('item 1 MUTATION: a directory-authority term outside the allowlist is caught', () => {
  const offList = findAdminStaticViolations(entry('src/pages/EntitlementsPage.jsx',
    'const c = createClient(u,k,{}); const key = row.supabase_anon_key;'));
  assert.ok(rules(offList).includes('directory-authority'), 'a clinic key in a non-allowlisted page fails');
  // the SAME term inside an allowlisted Master-side module is the directory doing its job
  const onList = findAdminStaticViolations(entry('src/lib/tenant-connection.mjs',
    'const c = createClient(u,k,{}); const key = row.supabase_anon_key;'));
  assert.ok(!rules(onList).includes('directory-authority'), 'the directory authority may name a clinic key');
});

test('item 1: the bundle scan catches a tenant host and a secret key, not a placeholder or the Master', () => {
  assert.ok(rules(findDistViolations(entry('dist/assets/x.js', `fetch('${tenantHost}')`))).includes('dist-tenant-url'),
    'a real tenant host baked into the bundle fails');
  assert.ok(rules(findDistViolations(entry('dist/assets/x.js', `const k = '${secretKey}';`))).includes('dist-secret-key'),
    'a secret key baked into the bundle fails');
  // documentation placeholders and the build-time Master URL are allowed
  assert.ok(isPlaceholderHost('https://project-ref.supabase.co'));
  assert.ok(isPlaceholderHost('https://your-central-project.supabase.co'));
  assert.deepEqual(findDistViolations(entry('dist/assets/x.js', "fetch('https://project-ref.supabase.co')")), []);
  const masterUrl = ['https://central-real', '.supabase.co'].join('');
  assert.deepEqual(findDistViolations(entry('dist/assets/x.js', `fetch('${masterUrl}')`), { masterUrl }), [],
    'the Master URL is allowed in the bundle');
});

test('item 1: the frozen sets are exactly what the owner decision recorded', () => {
  assert.deepEqual([...DIRECTORY_AUTHORITY_ALLOWLIST].sort(), [
    'src/components/entitlements/OnboardingWizard.jsx',
    'src/lib/keep-warm.mjs',
    'src/lib/tenant-connection.mjs',
    'src/pages/SetupPage.jsx',
    'src/pages/WorkspacesPage.jsx',
  ].sort(), 'the directory-authority allowlist is the five Master-side modules');
  assert.ok(CLINICAL_TABLES.includes('patients') && !CLINICAL_TABLES.includes('invoices'),
    "the clinical list is the PHI surface; Central's billing invoices are not clinical");
  assert.ok(Object.isFrozen(DIRECTORY_AUTHORITY_ALLOWLIST) && Object.isFrozen(CLINICAL_TABLES));
});
