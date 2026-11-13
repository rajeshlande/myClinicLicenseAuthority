import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PRIVILEGED_TABLES,
  blankComments,
  collectSourceFiles,
  findWriteSites,
} from '../scripts/check-write-verify.mjs';
import {
  SILENT_REFUSAL_CODE,
  SilentWriteRefusal,
  refusalMessage,
  refusalOf,
  rowsLanded,
  verifyRowsLanded,
} from '../src/lib/write-verify.mjs';
import { errorLine, explainError } from '../src/lib/errors.mjs';

/* §14 operator runbooks — "no error" is NOT proof the write landed.
 *
 * Every privileged Central table is guarded by `using (is_license_admin())`, a
 * row FILTER rather than a permission check: a non-admin's UPDATE succeeds and
 * changes nothing, so supabase-js returns `{ data: null, error: null }`. The
 * console used to toast success in exactly that case. supabase/schema-tests.sql
 * §12f–§12i proves the database behaviour against PostgreSQL 17; these tests
 * prove the runtime half, and §12.2 requires each ratchet rule to FAIL on its
 * injected mutation — so every rule below gets an offender and a neighbour. */

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const entry = (file, text) => [{ file, text }];
const sitesOf = (text, file = 'src/pages/Probe.jsx') => findWriteSites(entry(file, text));
const bad = (sites) => sites.filter((s) => !s.verified);

// ---------------------------------------------------------------------------
// rowsLanded — the count the whole fix rests on
// ---------------------------------------------------------------------------

test('rowsLanded: a .select() read-back is counted, a missing one is zero', () => {
  assert.equal(rowsLanded({ data: [{ id: 'a' }], error: null }), 1);
  assert.equal(rowsLanded({ data: [{ id: 'a' }, { id: 'b' }], error: null }), 2);
  assert.equal(rowsLanded({ data: [], error: null }), 0, 'refused write');
  // No .select() at all: PostgREST returns no representation.
  assert.equal(rowsLanded({ data: null, error: null }), 0);
  assert.equal(rowsLanded({}), 0);
  assert.equal(rowsLanded(null), 0);
  assert.equal(rowsLanded(undefined), 0);
});

test('rowsLanded: a .single()/.maybeSingle() object counts as one row', () => {
  assert.equal(rowsLanded({ data: { id: 'a', slug: 'x' }, error: null }), 1);
});

// ---------------------------------------------------------------------------
// refusalOf / verifyRowsLanded — the two call shapes
// ---------------------------------------------------------------------------

test('refusalOf: null when the write landed, a refusal when it did not', () => {
  const opts = { action: 'Pause subscription', table: 'licenses' };
  assert.equal(refusalOf({ data: [{ id: 'a' }], error: null }, opts), null);
  assert.equal(refusalOf({ data: [], error: null }, opts) instanceof SilentWriteRefusal, true);
  assert.equal(refusalOf({ data: null, error: null }, opts) instanceof SilentWriteRefusal, true);
  assert.equal(refusalOf(null, opts), null, 'nothing to inspect');
});

test('refusalOf: a real error is left to the caller, not double-reported', () => {
  const transport = { data: null, error: { message: 'Failed to fetch' } };
  assert.equal(refusalOf(transport, { action: 'x' }), null);
});

test('refusalOf: honours an expected row count above one', () => {
  const opts = { action: 'Bulk update', table: 'licenses', expected: 3 };
  assert.equal(refusalOf({ data: [{}, {}, {}], error: null }, opts), null);
  const short = refusalOf({ data: [{}, {}], error: null }, opts);
  assert.ok(short instanceof SilentWriteRefusal);
  assert.equal(short.rows, 2);
  assert.equal(short.expected, 3);
});

test('verifyRowsLanded: returns the result on success, throws on a silent refusal', () => {
  const ok = { data: [{ id: 'a' }], error: null };
  assert.equal(verifyRowsLanded(ok, { action: 'Rotate key' }), ok);

  assert.throws(
    () => verifyRowsLanded({ data: [], error: null }, { action: 'Rotate key', table: 'workspaces' }),
    (err) => {
      assert.ok(err instanceof SilentWriteRefusal);
      assert.ok(err instanceof Error);
      assert.equal(err.name, 'SilentWriteRefusal');
      assert.equal(err.code, SILENT_REFUSAL_CODE);
      assert.equal(err.code, '42501', 'the SQLSTATE an RLS refusal would have used');
      assert.equal(err.fix, 'auth');
      assert.equal(err.silent, true, 'callers can tell refused from failed');
      assert.equal(err.table, 'workspaces');
      assert.equal(err.action, 'Rotate key');
      assert.equal(err.rows, 0);
      return true;
    },
  );
});

test('refusalMessage: names the action, the shortfall and the actual cause', () => {
  const msg = refusalMessage({ action: 'Revoke member', table: 'workspace_members', rows: 0, expected: 1 });
  assert.match(msg, /Revoke member:/);
  assert.match(msg, /changed 0 of 1 row\(s\) on workspace_members/);
  assert.match(msg, /Row-level security refused it silently/);
  assert.match(msg, /not a Central admin/);
  assert.match(msg, /Nothing was changed/);
});

test('a refusal is explained by the console as a role problem, not a retry', () => {
  const refusal = new SilentWriteRefusal({ action: 'Pause subscription', table: 'licenses' });
  const explained = explainError(refusal, { context: 'Toggle pause switch' });
  assert.equal(explained.code, '42501');
  assert.equal(explained.fix, 'role', 'the operator is told to fix the role, not retry');
  assert.match(explained.message, /administrator privileges/i);
  assert.match(errorLine(refusal, { context: 'Toggle pause switch' }), /app_metadata\.role/);
});

// ---------------------------------------------------------------------------
// The ratchet — each rule gets an offender that is caught and a neighbour that
// is not, so the check cannot pass by being blind.
// ---------------------------------------------------------------------------

// The exact shape that shipped: `if (error) throw error;` then a success toast.
const SHIPPED_BUG = `
  const { error } = await supabase
    .from('licenses')
    .update({ is_active: false })
    .eq('id', row.license_id);
  if (error) throw error;
  showToast('Subscription paused — clinic enters read-only on next sync.');
`;

test('ratchet: the pre-fix kill switch is caught (0-row write reported as success)', () => {
  const sites = sitesOf(SHIPPED_BUG);
  assert.equal(sites.length, 1, 'one privileged write chain');
  assert.equal(sites[0].table, 'licenses');
  assert.equal(sites[0].verified, false);
  assert.equal(sites[0].readBack, false);
  assert.match(sites[0].reason, /no \.select\(\) read-back/);
});

test('ratchet: a read-back plus a row-count check passes', () => {
  const fixed = `
  const res = await supabase
    .from('licenses')
    .update({ is_active: false })
    .eq('id', row.license_id)
    .select('id');
  if (res.error) throw res.error;
  verifyRowsLanded(res, { action: 'Pause subscription', table: 'licenses' });
`;
  const sites = sitesOf(fixed);
  assert.equal(sites.length, 1);
  assert.equal(sites[0].verified, true);
  assert.equal(sites[0].readBack, true);
  assert.equal(sites[0].verifyCall, true);
  assert.equal(bad(sites).length, 0);
});

test('ratchet: MUTATION — keeping .select() but never counting the rows fails', () => {
  const halfFixed = `
  const res = await supabase
    .from('invoices')
    .update(patch)
    .eq('id', row.id)
    .select('id');
  if (res.error) throw res.error;
  setRows(prev => prev.map(r => ({ ...r, ...patch })));
`;
  const sites = sitesOf(halfFixed);
  assert.equal(sites.length, 1);
  assert.equal(sites[0].readBack, true);
  assert.equal(sites[0].verifyCall, false);
  assert.equal(sites[0].verified, false);
  assert.match(sites[0].reason, /never counts them/);
});

test('ratchet: MUTATION — dropping .select() from a verified chain fails', () => {
  const verified = sitesOf(`
  const res = await supabase.from('subscriptions').update({ tier }).eq('id', id).select('id');
  verifyRowsLanded(res, { action: 'Change tier', table: 'subscriptions' });
`);
  assert.equal(verified[0].verified, true);

  const regressed = sitesOf(`
  const res = await supabase.from('subscriptions').update({ tier }).eq('id', id);
  verifyRowsLanded(res, { action: 'Change tier', table: 'subscriptions' });
`);
  assert.equal(regressed[0].verified, false, 'the verify call alone cannot save it');
});

test('ratchet: .single() is self-verifying — PostgREST errors on zero rows', () => {
  const sites = sitesOf(`
  const updated = await supabase
    .from('workspaces')
    .update(row)
    .eq('id', found.data.id)
    .select(selecting)
    .single();
  if (updated.error) throw updated.error;
`, 'src/lib/tenant-connection.mjs');
  assert.equal(sites.length, 1);
  assert.equal(sites[0].selfVerifying, true);
  assert.equal(sites[0].verified, true);
});

test('ratchet: refusalOf counts too, for call sites that return an error', () => {
  const sites = sitesOf(`
  const logged = await supabase
    .from('clinic_activity_log')
    .insert({ event_kind: 'paused' })
    .select('id');
  return { error: logged.error ?? refusalOf(logged, { action: 'Append' }) };
`, 'src/lib/activity.mjs');
  assert.equal(sites.length, 1);
  assert.equal(sites[0].verified, true);
  assert.equal(sites[0].verifyCall, true);
});

test('ratchet: DELETE and UPSERT are audited, not just UPDATE/INSERT', () => {
  for (const verb of ['delete', 'upsert']) {
    const sites = sitesOf(`
  const res = await supabase.from('workspace_members').${verb}({ user_id: uid }).eq('workspace_id', wid);
  if (res.error) throw res.error;
`);
    assert.equal(sites.length, 1, `${verb} is a privileged write`);
    assert.equal(sites[0].verified, false, `${verb} needs a read-back too`);
  }
});

test('ratchet: a verify call in the NEXT statement is not credited to this one', () => {
  const sites = sitesOf(`
  const a = await supabase.from('licenses').update({ is_active: false }).eq('id', x);
  const b = await supabase.from('licenses').update({ is_active: true }).eq('id', y).select('id');
  verifyRowsLanded(b, { action: 'Resume' });
`);
  assert.equal(sites.length, 2);
  assert.equal(sites[0].verified, false, 'the first write is still unverified');
  assert.equal(sites[1].verified, true);
});

test('ratchet: reads, other tables and comments are out of scope', () => {
  // A plain read is not a write, so it is not audited here.
  assert.equal(sitesOf(`const r = await supabase.from('licenses').select('*').eq('id', x);`).length, 0);
  // A tenant clinical table is not a Central privileged table.
  assert.equal(sitesOf(`const r = await supabase.from('patients').update({}).eq('id', x);`).length, 0);
  // Documented examples must not be mistaken for code.
  const doc = `/** @returns {object} row ready for supabase.from('invoices').insert(...) */
export function buildInvoiceDraft() { return {}; }`;
  assert.equal(sitesOf(doc, 'src/lib/invoices.mjs').length, 0);
});

test('blankComments: offsets and newlines survive, so line numbers stay exact', () => {
  const src = `const a = 1;\n/* block\n   comment */\nconst b = 2; // tail\n`;
  const out = blankComments(src);
  assert.equal(out.length, src.length, 'length preserved');
  assert.equal(out.split('\n').length, src.split('\n').length, 'lines preserved');
  assert.equal(out.includes('block'), false);
  assert.equal(out.includes('tail'), false);
  assert.equal(out.includes('const b = 2;'), true, 'code untouched');
});

test('blankComments: a // inside a string is not a comment', () => {
  const src = `.update({ origin: 'a//b' }).select('id')`;
  assert.equal(blankComments(src), src);
});

// ---------------------------------------------------------------------------
// The real tree
// ---------------------------------------------------------------------------

test('the real Central src verifies every privileged write', () => {
  const files = collectSourceFiles(ROOT);
  assert.ok(files.length > 20, `scanned ${files.length} source files`);
  const entries = files.map((file) => ({ file, text: read(file) }));
  const sites = findWriteSites(entries);

  // Floor, not just "no failures": the scan is per statement, so a refactor that
  // hides writes behind a stored query builder would drop the count. Failing
  // here forces that refactor to be re-examined instead of passing silently.
  assert.ok(sites.length >= 9, `expected at least 9 audited chains, found ${sites.length}`);
  assert.deepEqual(
    bad(sites).map((s) => `${s.file}:${s.line} ${s.reason}`),
    [],
    'every privileged write counts the rows it changed',
  );

  // The three §14 operator actions and the billing paths are all covered.
  const tables = new Set(sites.map((s) => s.table));
  for (const t of ['licenses', 'subscriptions', 'invoices', 'clinic_activity_log', 'workspaces']) {
    assert.ok(tables.has(t), `${t} is audited`);
  }
  assert.ok(PRIVILEGED_TABLES.includes('workspace_members'), 'the revoke-member table is privileged');
});

test('the kill switch verifies BEFORE it flips local state and toasts success', () => {
  const text = read('src/pages/EntitlementsPage.jsx');
  const start = text.indexOf('const handleToggleKillSwitch');
  assert.ok(start > -1, 'handler found');
  const body = text.slice(start, text.indexOf('const handleCopyValue', start));

  const at = (needle) => {
    const i = body.indexOf(needle);
    assert.ok(i > -1, `expected ${needle} in the kill-switch handler`);
    return i;
  };
  // Ordering is the point: a refusal must throw before anything claims success.
  assert.ok(at(".select('id')") < at('verifyRowsLanded(killRes'), 'reads the rows back first');
  assert.ok(at('verifyRowsLanded(killRes') < at('setRecords('), 'verifies before the optimistic flip');
  assert.ok(at('verifyRowsLanded(killRes') < at('showToast('), 'verifies before the success toast');
});

test('the helper stays table-agnostic, so it needs no directory-authority allowlist', () => {
  const text = read('src/lib/write-verify.mjs');
  for (const term of ['workspaces', 'my_workspaces', 'supabase_anon_key', 'tenant_members', 'createClient(']) {
    assert.equal(text.includes(term), false, `write-verify.mjs must not name ${term}`);
  }
});
