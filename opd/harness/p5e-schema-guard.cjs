/**
 * OPD P5e-i acceptance — C9 at the network level: the boot-time tenant schema
 * guard, against a mocked Master and two mocked tenant projects, on the throwaway
 * flag-on build (dist-gate, served :5213).
 *
 * The row gate (`workspaceMountVerdict`) only sees the version Central RECORDED
 * (`tenant_schema_version`, 22 on both rows here). C9's whole point is the drift
 * that record can hide: a tenant project actually still on v21. Only the tenant
 * answering its own `app_schema_version()` probe catches that — and before P5e-i
 * `readTenantSchemaVersion()` had no caller at all, so the probe never ran.
 *
 * Three isolated boots (one browser context each, so no hint/session bleed):
 *   1. Sunrise's probe returns 21 (Central recorded 22) → fails CLOSED: the
 *      "Your clinic needs an update" screen, the tenant is never mounted, and it
 *      serves NO clinical read. The probe count proves it really fired.
 *   2. Riverside's probe returns 22 → mounts normally, even though a stale clinic
 *      shares the same directory.
 *   3. Sunrise's probe ERRORS (500) → fails OPEN: the clinic still mounts, because
 *      the row gate already vouched and one flaky RPC must not brick a clinic.
 */
const { chromium } = require('playwright'); // T6: devDependency, installed by `npm ci`
const BASE = 'http://127.0.0.1:5213/';
const MASTER = 'https://central-mock.supabase.co';
const TEN_A = 'https://sunrise-mock.supabase.co';
const TEN_B = 'https://riverside-mock.supabase.co';
const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
const USER_ID = '11111111-1111-4111-8111-111111111111';

// What each tenant's app_schema_version() probe answers, per scenario.
let schemaVersionFor = { [TEN_A]: 22, [TEN_B]: 22 };
let probeErrorFor = {};

function clinic({ slug, name, clinicId, patientName }) {
  const profile = { id: USER_ID, full_name: 'Owner One', email: 'owner@clinic.in', theme: 'system', active_branch_id: null, branch_scope: 'all' };
  const staffRow = { id: `staff-${slug}`, clinic_id: clinicId, user_id: USER_ID, role: 'owner', full_name: 'Owner One', email: 'owner@clinic.in', phone: '9000000000', created_at: '2026-01-01T00:00:00Z' };
  const clinicRow = { id: clinicId, name, slug, owner_name: 'Owner One', phone: '9000000000', address: '1 Clinic Rd', city: 'Pune', timezone: 'Asia/Kolkata', created_at: '2026-01-01T00:00:00Z' };
  const patient = { id: `pat-${slug}`, clinic_id: clinicId, full_name: patientName, code: `P-${slug.slice(0, 3).toUpperCase()}-1`, phone: '9111111111', email: '', gender: 'female', date_of_birth: '1990-01-01', address: '2 Patient Ln', city: 'Pune', tags: [], allergies: null, notes: '', created_at: '2026-01-02T00:00:00Z', created_by: USER_ID };
  return { profile, staffRow, clinicRow, patients: [patient] };
}
const CLINIC_A = clinic({ slug: 'sunrise-opd', name: 'Sunrise OPD', clinicId: 'cccccccc-0000-4000-8000-00000000000a', patientName: 'Alice Sunrise' });
const CLINIC_B = clinic({ slug: 'riverside-clinic', name: 'Riverside Clinic', clinicId: 'cccccccc-0000-4000-8000-00000000000b', patientName: 'Bob Riverside' });

// Both rows record schema 22, so the ROW gate passes and only the probe can catch
// Sunrise's real v21 — the drift C9 exists for.
const row = (over) => ({ role: 'admin', is_active: true, tenant_schema_version: 22, ...over });
const ROW_A = row({ id: 'aaaaaaaa-0000-4000-8000-000000000001', slug: 'sunrise-opd', clinic_name: 'Sunrise OPD', supabase_url: TEN_A, supabase_anon_key: 'sb_publishable_sunrise_mock_key' });
const ROW_B = row({ id: 'aaaaaaaa-0000-4000-8000-000000000002', slug: 'riverside-clinic', clinic_name: 'Riverside Clinic', supabase_url: TEN_B, supabase_anon_key: 'sb_publishable_riverside_mock_key' });
const directoryRows = [ROW_A, ROW_B];

const hits = { [MASTER]: {}, [TEN_A]: {}, [TEN_B]: {} };
const bump = (host, key) => { hits[host][key] = (hits[host][key] ?? 0) + 1; };
const resetHits = () => { for (const h of Object.keys(hits)) hits[h] = {}; };

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
    const t = (url.match(/\/rest\/v1\/([a-z_]+)/) || [])[1];
    if (t && t !== 'rpc') bump(MASTER, `clinical:${t}`);
    if (url.includes('/rest/v1/')) return json([]);
    return json({});
  });
  for (const [host, data] of [[TEN_A, CLINIC_A], [TEN_B, CLINIC_B]]) {
    await context.route(`${host}/**`, async (route) => {
      const req = route.request();
      const url = req.url();
      const method = req.method();
      const wantsObject = String(req.headers()['accept'] || '').includes('vnd.pgrst.object+json');
      const json = (o) => route.fulfill({ status: 200, headers: CORS, body: JSON.stringify(o) });
      // The C9 probe. Bumped whether it answers or errors, so "did it fire" is provable.
      if (url.includes('/rpc/app_schema_version')) {
        bump(host, 'app_schema_version');
        if (probeErrorFor[host]) return route.fulfill({ status: 500, headers: CORS, body: JSON.stringify({ message: 'probe unavailable' }) });
        return route.fulfill({ status: 200, headers: CORS, body: String(schemaVersionFor[host] ?? 22) });
      }
      if (url.includes('/rpc/license_state')) { bump(host, 'rpc:license_state'); return json({ status: 'active', plan: 'pro', seats: 10, used: 1 }); }
      if (url.includes('/rpc/accept_invite')) { bump(host, 'rpc:accept_invite'); return json(null); }
      const table = (url.match(/\/rest\/v1\/([a-z_]+)/) || [])[1];
      if (method === 'POST' || method === 'PATCH' || method === 'DELETE') {
        if (table) bump(host, `${method}:${table}`);
        let body = {}; try { body = req.postDataJSON(); } catch { /* no body */ }
        const one = Array.isArray(body) ? body[0] : body;
        if (method === 'POST') return json(one);
        if (method === 'PATCH') return json(wantsObject ? one : [one]);
        return json([]);
      }
      if (table) bump(host, table);
      switch (table) {
        case 'profiles': return json(wantsObject ? data.profile : [data.profile]);
        case 'clinics': return json(wantsObject ? data.clinicRow : [data.clinicRow]);
        case 'staff': return json([data.staffRow]);
        case 'patients':
          if (/[?&](client_id|id)=eq\./.test(url)) return json([]);
          return json(data.patients);
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
const has = (text, needle) => text.toLowerCase().includes(needle.toLowerCase());
const pointerSlug = async (page) => {
  const p = await page.evaluate(() => sessionStorage.getItem('opd.active.workspace'));
  try { return JSON.parse(p).slug; } catch { return null; }
};

/** A fresh, isolated boot to the clinic chooser (two rows, no hint → CHOOSE). */
async function bootToChooser(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await mockAll(ctx);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`${BASE}#/login`, { waitUntil: 'networkidle' });
  await page.fill('#email', 'owner@clinic.in');
  await page.fill('#password', 'password-one-two-three');
  await page.press('#password', 'Enter');
  await page.waitForTimeout(1300);
  return { ctx, page, errs };
}
const openClinic = async (page, label) => {
  await page.getByRole('button', { name: new RegExp(`Open ${label}`) }).click();
  await page.waitForTimeout(1800);
};

(async () => {
  const browser = await chromium.launch();

  /* ---- 1. Sunrise's tenant is really on v21 (Central recorded 22) → fail CLOSED ---- */
  schemaVersionFor = { [TEN_A]: 21, [TEN_B]: 22 }; probeErrorFor = {};
  resetHits();
  {
    const { ctx, page, errs } = await bootToChooser(browser);
    await openClinic(page, 'Sunrise OPD');
    const txt = await bodyText(page);
    check('C9: a stale tenant lands on the needs-an-update screen, not in the app',
      (await hash(page)) === '#/no-clinic', await hash(page));
    check('C9: the screen says "Your clinic needs an update"',
      has(txt, 'Your clinic needs an update'), txt.slice(0, 160));
    check('C9: the message names the version it is on and the one it needs',
      has(txt, 'v21') && has(txt, 'needs v22'), txt.replace(/\s+/g, ' ').slice(0, 200));
    check('C9: the stale clinic is named on the screen', has(txt, 'sunrise-opd'), '');
    check('C9: the stale tenant was NEVER mounted (no active-workspace pointer)',
      (await pointerSlug(page)) === null, String(await pointerSlug(page)));
    check('C9: the probe really fired — readTenantSchemaVersion has a production caller now',
      (hits[TEN_A].app_schema_version ?? 0) > 0, JSON.stringify(hits[TEN_A]));
    check('C9: it failed CLOSED before render — the stale tenant served NO clinical read',
      !('clinics' in hits[TEN_A]) && !('patients' in hits[TEN_A]), JSON.stringify(hits[TEN_A]));
    check('C9: the Master served the directory only, never clinical data',
      (hits[MASTER].my_workspaces ?? 0) > 0 && !Object.keys(hits[MASTER]).some((k) => k.startsWith('clinical:')),
      JSON.stringify(hits[MASTER]));
    check('C9: scenario 1 produced no page errors', errs.length === 0, JSON.stringify(errs));
    await ctx.close();
  }

  /* ---- 2. Riverside's tenant is on v22 → mounts normally, stale neighbour notwithstanding ---- */
  schemaVersionFor = { [TEN_A]: 21, [TEN_B]: 22 }; probeErrorFor = {};
  resetHits();
  {
    const { ctx, page, errs } = await bootToChooser(browser);
    await openClinic(page, 'Riverside Clinic');
    check('C9: a current tenant mounts and lands in the app',
      (await hash(page)).startsWith('#/app/') && (await pointerSlug(page)) === 'riverside-clinic',
      `${await hash(page)} slug=${await pointerSlug(page)}`);
    check('C9: the healthy clinic served its own clinical reads',
      (hits[TEN_B].clinics ?? 0) > 0 && (hits[TEN_B].patients ?? 0) > 0, JSON.stringify(hits[TEN_B]));
    check('C9: a stale clinic elsewhere in the directory did not block this one',
      (await pointerSlug(page)) === 'riverside-clinic' && (hits[TEN_A].app_schema_version ?? 0) === 0,
      `sunriseProbe=${hits[TEN_A].app_schema_version ?? 0}`);
    check('C9: scenario 2 produced no page errors', errs.length === 0, JSON.stringify(errs));
    await ctx.close();
  }

  /* ---- 3. Sunrise's probe ERRORS → fail OPEN: the row gate vouched, so it still mounts ---- */
  schemaVersionFor = { [TEN_A]: 22, [TEN_B]: 22 }; probeErrorFor = { [TEN_A]: true };
  resetHits();
  {
    const { ctx, page, errs } = await bootToChooser(browser);
    await openClinic(page, 'Sunrise OPD');
    check('C9: a probe that ERRORS fails OPEN — the clinic still mounts (no brick on one flaky RPC)',
      (await hash(page)).startsWith('#/app/') && (await pointerSlug(page)) === 'sunrise-opd',
      `${await hash(page)} slug=${await pointerSlug(page)}`);
    check('C9: the errored probe was still attempted',
      (hits[TEN_A].app_schema_version ?? 0) > 0, JSON.stringify(hits[TEN_A]));
    check('C9: scenario 3 produced no page errors', errs.length === 0, JSON.stringify(errs));
    await ctx.close();
  }

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(JSON.stringify({ results, hits, failed: failed.length }, null, 2));
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
