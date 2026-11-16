/**
 * OPD P4 acceptance line, against mocked Master + two mocked tenant projects, on a
 * throwaway flag-on build (dist-gate):
 *   login → 1 clinic auto-selects → 2 clinics show grid → refresh keeps the same
 *   clinic → two tabs with different slugs stay isolated → logout wipes RAM + all
 *   keys (and the BroadcastChannel drops the other tab).
 * Two pages in ONE context are two tabs: separate sessionStorage, shared
 * localStorage — exactly the browser semantics §9.3's isolation relies on.
 */
const { chromium } = require('playwright'); // T6: devDependency, installed by `npm ci`
const BASE = 'http://127.0.0.1:5212/';
const MASTER = 'https://central-mock.supabase.co';
const TEN_A = 'https://sunrise-mock.supabase.co';
const TEN_B = 'https://riverside-mock.supabase.co';
const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

const row = (over) => ({
  id: over.slug === 'sunrise-opd' ? 'aaaaaaaa-0000-4000-8000-000000000001' : 'aaaaaaaa-0000-4000-8000-000000000002',
  clinic_name: over.slug === 'sunrise-opd' ? 'Sunrise OPD' : 'Riverside Clinic',
  role: 'admin', is_active: true, tenant_schema_version: 22, ...over,
});
const ROW_A = row({ slug: 'sunrise-opd', supabase_url: TEN_A, supabase_anon_key: 'sb_publishable_sunrise_mock_key' });
const ROW_B = row({ slug: 'riverside-clinic', supabase_url: TEN_B, supabase_anon_key: 'sb_publishable_riverside_mock_key' });

let directoryRows = [ROW_A, ROW_B];
let workspacesCalls = 0;

// A mocked tenant must LOOK like a live clinic. src/lib/store.jsx:273 sends a
// session with no `staff` row to /onboarding, which renders no app chrome and so
// no sign-out button — returning [] for every clinical table left this harness
// stuck on the setup wizard while still claiming P4 acceptance was proved. T6
// exposed it the first time the harness ran from a clean repo. p5b-clinical.cjs
// (13/13 green) uses the same fixture shape; this is that shape, not a loosened
// assertion: every check below is byte-for-byte the original.
const USER_ID = '11111111-1111-4111-8111-111111111111';
function tenantData(slug, name, clinicId) {
  const profile = { id: USER_ID, full_name: 'Owner One', email: 'owner@clinic.in', theme: 'system', active_branch_id: null, branch_scope: 'all' };
  const staffRow = { id: `staff-${slug}`, clinic_id: clinicId, user_id: USER_ID, role: 'owner', full_name: 'Owner One', email: 'owner@clinic.in', phone: '9000000000', created_at: '2026-01-01T00:00:00Z' };
  const clinicRow = { id: clinicId, name, slug, owner_name: 'Owner One', phone: '9000000000', address: '1 Clinic Rd', city: 'Pune', timezone: 'Asia/Kolkata', created_at: '2026-01-01T00:00:00Z' };
  return { profile, staffRow, clinicRow };
}
const CLINIC_A = tenantData('sunrise-opd', 'Sunrise OPD', 'cccccccc-0000-4000-8000-00000000000a');
const CLINIC_B = tenantData('riverside-clinic', 'Riverside Clinic', 'cccccccc-0000-4000-8000-00000000000b');

const masterSession = () => ({
  access_token: 'mock-master-access-token', token_type: 'bearer',
  expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
  refresh_token: 'mock-master-refresh-token',
  user: {
    id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated',
    email: 'owner@clinic.in', email_confirmed_at: '2026-01-01T00:00:00Z',
    created_at: '2026-01-01T00:00:00Z', app_metadata: { provider: 'email' },
    user_metadata: { full_name: 'Owner One' }, identities: [],
  },
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
    if (url.includes('/rpc/my_workspaces')) { workspacesCalls += 1; return json(directoryRows); }
    if (url.includes('/rest/v1/')) return json([]);
    return json({});
  });
  for (const [host, data] of [[TEN_A, CLINIC_A], [TEN_B, CLINIC_B]]) {
    await context.route(`${host}/**`, async (route) => {
      const req = route.request();
      const url = req.url();
      const wantsObject = String(req.headers()['accept'] || '').includes('vnd.pgrst.object+json');
      const json = (o) => route.fulfill({ status: 200, headers: CORS, body: JSON.stringify(o) });
      if (url.includes('/rpc/license_state')) return json({ status: 'active', plan: 'pro', seats: 10, used: 1 });
      if (url.includes('/rpc/app_schema_version')) return route.fulfill({ status: 200, headers: CORS, body: '22' });
      if (url.includes('/rpc/accept_invite')) return json(null);
      switch ((url.match(/\/rest\/v1\/([a-z_]+)/) || [])[1]) {
        case 'profiles': return json(wantsObject ? data.profile : [data.profile]);
        case 'clinics': return json(wantsObject ? data.clinicRow : [data.clinicRow]);
        case 'staff': return json([data.staffRow]);
        case 'patients': case 'appointments': case 'consultations': case 'invoices':
        case 'day_closes': case 'reminders': case 'invites':
        case 'branches': case 'staff_branches': return json([]);
        default: return json(wantsObject ? null : []);
      }
    });
  }
}

const stores = (page) => page.evaluate(() => ({
  activePointer: sessionStorage.getItem('opd.active.workspace'),
  lastHint: localStorage.getItem('opd.last.workspace'),
  masterAuth: localStorage.getItem('opd.clinic.master.auth'),
  opdKeys: Object.keys({ ...localStorage, ...sessionStorage }).filter((k) => k.startsWith('opd.')),
  allLocal: Object.keys(localStorage),
  allSession: Object.keys(sessionStorage),
}));

const hash = (page) => page.evaluate(() => location.hash);

(async () => {
  const browser = await chromium.launch();
  const pageErrors = [];

  /* ---- context 1: two clinics, then two tabs ---- */
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await mockAll(ctx);
  const A = await ctx.newPage();
  A.on('pageerror', (e) => pageErrors.push(`A: ${e.message}`));
  const visitedA = [];
  A.on('framenavigated', (f) => { if (f === A.mainFrame()) visitedA.push(f.url().split('#')[1] ?? ''); });

  await A.goto(`${BASE}#/login`, { waitUntil: 'networkidle' });
  await A.fill('#email', 'owner@clinic.in');
  await A.fill('#password', 'password-one-two-three');
  await A.press('#password', 'Enter');
  await A.waitForTimeout(1200);
  check('login against the Master lands on the chooser with two clinics',
    (await hash(A)) === '#/select', await hash(A));
  const cardText = await A.locator('button[aria-label*="Open "]').allInnerTexts();
  check('the grid lists both clinics by name, slug and role',
    cardText.join(' | ').includes('Sunrise OPD') && cardText.join(' | ').includes('Riverside Clinic')
    && cardText.join(' | ').includes('Owner'), cardText.join(' | ').slice(0, 120));

  await A.getByRole('button', { name: /Open Sunrise OPD/ }).click();
  await A.waitForTimeout(1200);
  let s = await stores(A);
  check('picking a clinic mounts it and lands in the app',
    (await hash(A)) === '#/app/dashboard', await hash(A));
  check('the per-tab pointer is in sessionStorage and names the chosen clinic',
    s.activePointer && JSON.parse(s.activePointer).slug === 'sunrise-opd', s.activePointer ?? 'null');
  check('the origin-wide hint is only a slug', s.lastHint === 'sunrise-opd', String(s.lastHint));

  const callsBefore = workspacesCalls;
  await A.reload({ waitUntil: 'networkidle' });
  await A.waitForTimeout(1200);
  s = await stores(A);
  check('a refresh re-reads the directory and keeps the same clinic',
    (await hash(A)).startsWith('#/app/') && JSON.parse(s.activePointer).slug === 'sunrise-opd'
    && workspacesCalls > callsBefore, `hash=${await hash(A)} calls=${workspacesCalls - callsBefore}`);

  /* tab B in the same context: shared localStorage, its own sessionStorage */
  const B = await ctx.newPage();
  B.on('pageerror', (e) => pageErrors.push(`B: ${e.message}`));
  await B.goto(`${BASE}#/select`, { waitUntil: 'networkidle' });
  await B.waitForTimeout(900);
  await B.getByRole('button', { name: /Open Riverside Clinic/ }).click();
  await B.waitForTimeout(1200);
  const sB = await stores(B);
  const sA = await stores(A);
  check('tab B mounts the second clinic', JSON.parse(sB.activePointer).slug === 'riverside-clinic',
    sB.activePointer ?? 'null');
  check('tab A still holds the first clinic — the tabs are isolated',
    JSON.parse(sA.activePointer).slug === 'sunrise-opd' && (await hash(A)).startsWith('#/app/'),
    `${sA.activePointer} @ ${await hash(A)}`);

  await A.reload({ waitUntil: 'networkidle' });
  await B.reload({ waitUntil: 'networkidle' });
  await A.waitForTimeout(1200); await B.waitForTimeout(1200);
  check('after reloading both tabs, each keeps its own clinic',
    JSON.parse((await stores(A)).activePointer).slug === 'sunrise-opd'
    && JSON.parse((await stores(B)).activePointer).slug === 'riverside-clinic',
    `${(await stores(A)).activePointer} | ${(await stores(B)).activePointer}`);

  /* logout in A must wipe A and drop B */
  await A.locator('button[aria-label="Sign out"]').first().click();
  await A.waitForTimeout(1600);
  await B.waitForTimeout(600);
  const afterA = await stores(A);
  const afterB = await stores(B);
  // The tab that signs out is taken to the public landing screen (AppLayout.jsx:116
  // → navigate('/')), while the broadcast forces OTHER tabs to /login. The P4-era
  // expectation was `#/login` for tab A too; that route changed and the harness
  // went stale. Pin the real route AND prove the app chrome is gone, so this is a
  // stronger assertion than the old hash-only one, not a loosened one.
  const signOutButtons = await A.locator('button[aria-label="Sign out"]').count();
  check('sign-out takes tab A out of the app to a public, signed-out screen',
    (await hash(A)) === '#/' && signOutButtons === 0,
    `${await hash(A)} · sign-out buttons=${signOutButtons}`);
  check('sign-out wipes every opd.* key in both stores of tab A',
    afterA.opdKeys.length === 0, JSON.stringify(afterA.opdKeys));
  check('the broadcast drops tab B too', (await hash(B)) === '#/login'
    && JSON.parse(afterB.activePointer ?? 'null') === null, `${await hash(B)} | ${afterB.activePointer}`);
  const keepers = afterA.allLocal.filter((k) => k.startsWith('myclinic.'));
  check('only keep-list myclinic.* keys survive, if any',
    keepers.every((k) => ['myclinic.theme', 'myclinic.accent', 'myclinic.install.dismissed', 'myclinic.central.device.v1'].includes(k)),
    JSON.stringify(keepers));

  await ctx.close();

  /* ---- context 2: one clinic auto-selects, no chooser ---- */
  directoryRows = [ROW_A];
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await mockAll(ctx2);
  const C = await ctx2.newPage();
  C.on('pageerror', (e) => pageErrors.push(`C: ${e.message}`));
  const visitedC = [];
  C.on('framenavigated', (f) => { if (f === C.mainFrame()) visitedC.push(f.url().split('#')[1] ?? ''); });
  await C.goto(`${BASE}#/login`, { waitUntil: 'networkidle' });
  await C.fill('#email', 'owner@clinic.in');
  await C.fill('#password', 'password-one-two-three');
  await C.press('#password', 'Enter');
  await C.waitForTimeout(1500);
  check('a single clinic auto-selects with no chooser UI',
    (await hash(C)).startsWith('#/app/') && !visitedC.includes('/select'),
    `${await hash(C)} visited=${visitedC.join(',')}`);
  check('and its pointer is written per tab',
    JSON.parse((await stores(C)).activePointer ?? 'null')?.slug === 'sunrise-opd',
    (await stores(C)).activePointer ?? 'null');
  await ctx2.close();

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(JSON.stringify({ results, pageErrors, failed: failed.length }, null, 2));
  process.exit(failed.length || pageErrors.length ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
