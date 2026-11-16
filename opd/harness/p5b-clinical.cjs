/**
 * OPD P5b acceptance — directory-mode CLINICAL loading, against a mocked Master and
 * two mocked tenant projects, on the throwaway flag-on build (dist-gate, served :5212).
 *
 * P4's harness proved the gate (login → choose → mount → isolate → logout) with empty
 * clinical tables. This proves the P5b seam: once a tenant is mounted, store.jsx's
 * loadLive reads the clinic's CLINICAL data from THAT tenant's project (never the legacy
 * singleton, which is unconfigured in a directory build), renders it, and a second tab on
 * a different clinic renders its own — no cross-clinic bleed (C7). A reload re-reads the
 * tenant. Request counters prove which project actually served the clinical tables.
 */
const { chromium } = require('playwright'); // T6: devDependency, installed by `npm ci`
const BASE = 'http://127.0.0.1:5212/';
const MASTER = 'https://central-mock.supabase.co';
const TEN_A = 'https://sunrise-mock.supabase.co';
const TEN_B = 'https://riverside-mock.supabase.co';
const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
const USER_ID = '11111111-1111-4111-8111-111111111111';

// One coherent clinic dataset per tenant, so a rendered name proves WHICH project served it.
function clinic({ slug, name, clinicId, patientName }) {
  const profile = { id: USER_ID, full_name: 'Owner One', email: 'owner@clinic.in', theme: 'system', active_branch_id: null, branch_scope: 'all' };
  const staffRow = { id: `staff-${slug}`, clinic_id: clinicId, user_id: USER_ID, role: 'owner', full_name: 'Owner One', email: 'owner@clinic.in', phone: '9000000000', created_at: '2026-01-01T00:00:00Z' };
  const clinicRow = { id: clinicId, name, slug, owner_name: 'Owner One', phone: '9000000000', address: '1 Clinic Rd', city: 'Pune', timezone: 'Asia/Kolkata', created_at: '2026-01-01T00:00:00Z' };
  const patient = { id: `pat-${slug}`, clinic_id: clinicId, full_name: patientName, code: `P-${slug.slice(0, 3).toUpperCase()}-1`, phone: '9111111111', email: '', gender: 'female', date_of_birth: '1990-01-01', address: '2 Patient Ln', city: 'Pune', tags: [], allergies: null, notes: '', created_at: '2026-01-02T00:00:00Z', created_by: USER_ID };
  return { profile, staffRow, clinicRow, patients: [patient] };
}
const CLINIC_A = clinic({ slug: 'sunrise-opd', name: 'Sunrise OPD', clinicId: 'cccccccc-0000-4000-8000-00000000000a', patientName: 'Alice Sunrise' });
const CLINIC_B = clinic({ slug: 'riverside-clinic', name: 'Riverside Clinic', clinicId: 'cccccccc-0000-4000-8000-00000000000b', patientName: 'Bob Riverside' });

const row = (over) => ({ role: 'admin', is_active: true, tenant_schema_version: 22, ...over });
const ROW_A = row({ id: 'aaaaaaaa-0000-4000-8000-000000000001', slug: 'sunrise-opd', clinic_name: 'Sunrise OPD', supabase_url: TEN_A, supabase_anon_key: 'sb_publishable_sunrise_mock_key' });
const ROW_B = row({ id: 'aaaaaaaa-0000-4000-8000-000000000002', slug: 'riverside-clinic', clinic_name: 'Riverside Clinic', supabase_url: TEN_B, supabase_anon_key: 'sb_publishable_riverside_mock_key' });
let directoryRows = [ROW_A, ROW_B];

// Per-host clinical read counters: proof of WHICH project served the tables.
const hits = { [MASTER]: {}, [TEN_A]: {}, [TEN_B]: {} };
const bump = (host, key) => { hits[host][key] = (hits[host][key] ?? 0) + 1; };

const masterSession = () => ({
  access_token: 'mock-master-access-token', token_type: 'bearer',
  expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
  refresh_token: 'mock-master-refresh-token',
  user: { id: USER_ID, aud: 'authenticated', role: 'authenticated', email: 'owner@clinic.in', email_confirmed_at: '2026-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z', app_metadata: { provider: 'email' }, user_metadata: { full_name: 'Owner One' }, identities: [] },
});

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: Boolean(ok), detail }); };

async function mockAll(context) {
  await context.route(`${MASTER}/**`, async (route) => {
    const url = route.request().url();
    const json = (o) => route.fulfill({ status: 200, headers: CORS, body: JSON.stringify(o) });
    if (url.includes('/auth/v1/token')) return json(masterSession());
    if (url.includes('/auth/v1/logout')) return route.fulfill({ status: 204, headers: CORS });
    if (url.includes('/auth/v1/user')) return json(masterSession().user);
    if (url.includes('/rpc/my_workspaces')) { bump(MASTER, 'my_workspaces'); return json(directoryRows); }
    // The Master must never serve a clinical table; if the seam leaked, this would be hit.
    const t = (url.match(/\/rest\/v1\/([a-z_]+)/) || [])[1];
    if (t && t !== 'rpc') bump(MASTER, `clinical:${t}`);  // rpc/* is my_workspaces, not a table
    if (url.includes('/rest/v1/')) return json([]);
    return json({});
  });
  for (const [host, data] of [[TEN_A, CLINIC_A], [TEN_B, CLINIC_B]]) {
    await context.route(`${host}/**`, async (route) => {
      const req = route.request();
      const url = req.url();
      const wantsObject = String(req.headers()['accept'] || '').includes('vnd.pgrst.object+json');
      const json = (o) => route.fulfill({ status: 200, headers: CORS, body: JSON.stringify(o) });
      if (url.includes('/rpc/app_schema_version')) { bump(host, 'app_schema_version'); return route.fulfill({ status: 200, headers: CORS, body: '22' }); }
      if (url.includes('/rpc/license_state')) { bump(host, 'rpc:license_state'); return json({ status: 'active', plan: 'pro', seats: 10, used: 1 }); }
      if (url.includes('/rpc/accept_invite')) { bump(host, 'rpc:accept_invite'); return json(null); }
      const table = (url.match(/\/rest\/v1\/([a-z_]+)/) || [])[1];
      if (table) bump(host, table);
      switch (table) {
        case 'profiles': return json(wantsObject ? data.profile : [data.profile]);
        case 'clinics': return json(wantsObject ? data.clinicRow : [data.clinicRow]);
        case 'staff': return json([data.staffRow]);
        case 'patients': return json(data.patients);
        case 'appointments': case 'consultations': case 'invoices':
        case 'day_closes': case 'reminders': case 'invites':
        case 'branches': case 'staff_branches': return json([]);
        default: return json(wantsObject ? null : []);
      }
    });
  }
}

const hash = (page) => page.evaluate(() => location.hash);
const bodyText = (page) => page.evaluate(() => document.body.innerText);
// The clinic name renders through CSS text-transform, so innerText is uppercased;
// match case-insensitively to assert on the data, not the display casing.
const has = (text, needle) => text.toLowerCase().includes(needle.toLowerCase());
const pointerSlug = async (page) => {
  const p = await page.evaluate(() => sessionStorage.getItem('opd.active.workspace'));
  try { return JSON.parse(p).slug; } catch { return null; }
};

(async () => {
  const browser = await chromium.launch();
  const pageErrors = [];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await mockAll(ctx);

  /* ---- tab A: login → choose Sunrise → clinical data loads from TEN_A ---- */
  const A = await ctx.newPage();
  A.on('pageerror', (e) => pageErrors.push(`A: ${e.message}`));
  await A.goto(`${BASE}#/login`, { waitUntil: 'networkidle' });
  await A.fill('#email', 'owner@clinic.in');
  await A.fill('#password', 'password-one-two-three');
  await A.press('#password', 'Enter');
  await A.waitForTimeout(1200);
  check('login lands on the chooser', (await hash(A)) === '#/select', await hash(A));
  await A.getByRole('button', { name: /Open Sunrise OPD/ }).click();
  await A.waitForTimeout(1500);
  check('picking Sunrise mounts and lands in the app', (await hash(A)).startsWith('#/app/'), await hash(A));
  check('the pointer names the chosen clinic', (await pointerSlug(A)) === 'sunrise-opd', String(await pointerSlug(A)));

  let textA = await bodyText(A);
  check('loadLive rendered the TENANT clinic name (Sunrise OPD), not demo/onboarding',
    has(textA, 'Sunrise OPD'), textA.slice(0, 80).replace(/\n/g, ' '));
  check('TEN_A served the clinical tables (clinics + patients + license_state)',
    hits[TEN_A].clinics > 0 && hits[TEN_A].patients > 0 && hits[TEN_A]['rpc:license_state'] > 0,
    JSON.stringify(hits[TEN_A]));
  check('the Master served NO clinical table (the seam did not leak to Central)',
    !Object.keys(hits[MASTER]).some((k) => k.startsWith('clinical:')),
    JSON.stringify(Object.keys(hits[MASTER])));

  // The patient list proves the clinical tables (not just the clinic row) came from the tenant.
  await A.goto(`${BASE}#/app/patients`, { waitUntil: 'networkidle' });
  await A.waitForTimeout(900);
  textA = await bodyText(A);
  check('the patients page shows the tenant patient (Alice Sunrise)',
    has(textA, 'Alice Sunrise'), textA.slice(0, 120).replace(/\n/g, ' '));

  /* ---- tab B: a second clinic renders its OWN data; tab A is untouched (C7) ---- */
  const B = await ctx.newPage();
  B.on('pageerror', (e) => pageErrors.push(`B: ${e.message}`));
  await B.goto(`${BASE}#/select`, { waitUntil: 'networkidle' });
  await B.waitForTimeout(900);
  await B.getByRole('button', { name: /Open Riverside Clinic/ }).click();
  await B.waitForTimeout(1500);
  let textB = await bodyText(B);
  check('tab B mounted Riverside and rendered its clinic name',
    (await pointerSlug(B)) === 'riverside-clinic' && has(textB, 'Riverside Clinic'),
    `${await pointerSlug(B)} | ${textB.slice(0, 60).replace(/\n/g, ' ')}`);
  await B.goto(`${BASE}#/app/patients`, { waitUntil: 'networkidle' });
  await B.waitForTimeout(900);
  textB = await bodyText(B);
  check('tab B shows its OWN patient (Bob Riverside)', has(textB, 'Bob Riverside'), textB.slice(0, 120).replace(/\n/g, ' '));
  check('C7: tab B does NOT show tab A\'s patient (no cross-clinic bleed)',
    !has(textB, 'Alice Sunrise'), 'Alice leaked into Riverside');

  textA = await bodyText(A);
  check('C7: tab A still shows Sunrise + Alice, untouched by tab B',
    has(textA, 'Sunrise OPD') && has(textA, 'Alice Sunrise') && !has(textA, 'Bob Riverside'),
    textA.slice(0, 120).replace(/\n/g, ' '));
  check('TEN_B served tab B\'s clinical tables', hits[TEN_B].clinics > 0 && hits[TEN_B].patients > 0, JSON.stringify(hits[TEN_B]));

  /* ---- reload tab A: loadLive re-reads the tenant, keeps the same clinic ---- */
  const aBefore = hits[TEN_A].clinics;
  await A.reload({ waitUntil: 'networkidle' });
  await A.waitForTimeout(1500);
  textA = await bodyText(A);
  check('a reload re-reads TEN_A and keeps Sunrise + Alice',
    (await pointerSlug(A)) === 'sunrise-opd' && has(textA, 'Sunrise OPD')
    && hits[TEN_A].clinics > aBefore, `slug=${await pointerSlug(A)} clinics+=${hits[TEN_A].clinics - aBefore}`);

  await ctx.close();
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(JSON.stringify({ results, hits, pageErrors, failed: failed.length }, null, 2));
  process.exit(failed.length || pageErrors.length ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
