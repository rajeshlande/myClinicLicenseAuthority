/**
 * OPD P8 rehearsal — §14's three operator actions, proved CLIENT-SIDE in a real
 * browser against a real (mocked) Central directory and real (mocked) tenant
 * projects, on the throwaway flag-on build (myclinic/dist-gate, served :5215).
 *
 * `OPD-PILOT-MIGRATION-RUNBOOK.md` §8.4 lists what an operator must confirm after
 * deactivating a clinic, rotating its publishable key or revoking a member. Until
 * now those items were assertions on paper: Central's SQL suite proves the
 * DATABASE side (§12b–§12i: the row changes, `my_workspaces()` and
 * `public_workspace_by_slug()` stop returning it, anon booking serves the rotated
 * key), but nothing had shown the running app noticing. This is that proof.
 *
 *   1. baseline   — a member of two clinics signs in, chooses Harbour, mounts it,
 *                   and Harbour's project serves the clinical reads.
 *   2. DEACTIVATE — the operator sets is_active=false. A tab-visibility regain
 *                   (R1 §9.2 revalidation, no reload) re-reads the directory: the
 *                   clinic is gone, the mounted session is ejected, the old
 *                   project receives NO further clinical reads, and with one clinic
 *                   left the gate auto-selects it rather than showing a chooser.
 *   3. …and the SAME deactivation darkens the public booking link, while the other
 *      clinic's link still works (deactivation is per clinic, not global).
 *   4. REACTIVATE — both surfaces come back.
 *   5. REVOKE     — the member loses the clinic, and is ejected from it, BUT the
 *      public booking link still resolves and books: revoke ≠ deactivate. The
 *      clinic is live for everyone else; only this member's row went.
 *   6. ROTATE KEY — Central starts returning a new project URL + publishable key
 *      for the same slug. Anonymous booking picks it up at once, and so does a
 *      signed-in remount, because directory-reads.mjs never lets a stored URL or
 *      key reach createClient (F2): only the slug is cached, credentials always
 *      come from the fresh row. The `apikey` header is captured to prove the NEW
 *      key was really sent, not just a new host.
 *   7. REVOKE ALL — an empty directory routes to /no-clinic; the cached slug
 *      cannot resurrect a session.
 *
 * Per-host RPC counters plus the apikey each host saw are the evidence. Playwright
 * is a devDependency (T6) — `npm ci` installs it. Port :5215 is owned by THIS
 * harness — :5211/:5212 belong to the p4 and p5b/p5c harnesses and :5213/:5214 to
 * p5d/p5e, so nothing collides. `npm run test:e2e` builds and serves all of them.
 */
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright'); // T6: devDependency, installed by `npm ci`

const PORT = 5215;
const BASE = `http://127.0.0.1:${PORT}/`;
// Works from myclinic/harness/ (canonical) and from a harness/ beside the repo.
const REPO_ROOT = fs.existsSync(path.resolve(__dirname, '..', 'package.json'))
  ? path.resolve(__dirname, '..')
  : path.resolve(__dirname, '..', 'myclinic');
const DIST = path.join(REPO_ROOT, 'dist-gate');

const MASTER = 'https://central-mock.supabase.co';
const TEN_A = 'https://harbour-mock.supabase.co';          // Harbour before rotation
const TEN_A2 = 'https://harbour-rotated-mock.supabase.co'; // Harbour's new project
const TEN_B = 'https://meridian-mock.supabase.co';
const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
const USER_ID = '11111111-1111-4111-8111-111111111111';

const KEY_A_OLD = 'sb_publishable_harbour_mock_key';
const KEY_A_NEW = 'sb_publishable_harbour_rotated_key';
const KEY_B = 'sb_publishable_meridian_mock_key';

// ── Live operator state ───────────────────────────────────────────────────────
// The mocks read THIS on every request, so a scenario can perform an operator
// action mid-session and the next revalidation sees the new world — which is the
// whole point. `memberOf` is the workspace_members row set (revoke removes one);
// `active` is workspaces.is_active (deactivate clears one); `rotated` swaps the
// slug's stored URL + publishable key.
const state = {
  memberOf: ['harbour-opd', 'meridian-clinic'],
  active: { 'harbour-opd': true, 'meridian-clinic': true },
  rotated: false,
};

const harbourRow = () => ({
  id: 'aaaaaaaa-0000-4000-8000-000000000001',
  slug: 'harbour-opd',
  clinic_name: 'Harbour OPD',
  supabase_url: state.rotated ? TEN_A2 : TEN_A,
  supabase_anon_key: state.rotated ? KEY_A_NEW : KEY_A_OLD,
});
const meridianRow = () => ({
  id: 'aaaaaaaa-0000-4000-8000-000000000002',
  slug: 'meridian-clinic',
  clinic_name: 'Meridian Clinic',
  supabase_url: TEN_B,
  supabase_anon_key: KEY_B,
});
const bySlug = { 'harbour-opd': harbourRow, 'meridian-clinic': meridianRow };

/** What Central's `my_workspaces()` returns: a member row AND is_active, as the SQL does. */
const memberRows = () => state.memberOf
  .filter((slug) => state.active[slug] && bySlug[slug])
  .map((slug) => ({ role: 'admin', is_active: true, tenant_schema_version: 22, ...bySlug[slug]() }));

/** What `public_workspace_by_slug(slug)` returns: is_active only — booking is anonymous. */
const bookingRows = (slug) => (state.active[slug] && bySlug[slug]
  ? [bySlug[slug]()].map(({ clinic_name, supabase_url, supabase_anon_key }) => ({
    slug, clinic_name, supabase_url, supabase_anon_key,
  }))
  : []);

// ── Tenant fixtures ───────────────────────────────────────────────────────────
function clinic({ slug, name, clinicId, patientName }) {
  const profile = { id: USER_ID, full_name: 'Owner One', email: 'owner@clinic.in', theme: 'system', active_branch_id: null, branch_scope: 'all' };
  const staffRow = { id: `staff-${slug}`, clinic_id: clinicId, user_id: USER_ID, role: 'owner', full_name: 'Owner One', email: 'owner@clinic.in', phone: '9000000000', created_at: '2026-01-01T00:00:00Z' };
  const clinicRow = { id: clinicId, name, slug, owner_name: 'Owner One', phone: '9000000000', address: '1 Clinic Rd', city: 'Pune', timezone: 'Asia/Kolkata', created_at: '2026-01-01T00:00:00Z' };
  const patient = { id: `pat-${slug}`, clinic_id: clinicId, full_name: patientName, code: `P-${slug.slice(0, 3).toUpperCase()}-1`, phone: '9111111111', email: '', gender: 'female', date_of_birth: '1990-01-01', address: '2 Patient Ln', city: 'Pune', tags: [], allergies: null, notes: '', created_at: '2026-01-02T00:00:00Z', created_by: USER_ID };
  return { profile, staffRow, clinicRow, patients: [patient] };
}
const CLINIC_A = clinic({ slug: 'harbour-opd', name: 'Harbour OPD', clinicId: 'cccccccc-0000-4000-8000-00000000000a', patientName: 'Alice Harbour' });
const CLINIC_B = clinic({ slug: 'meridian-clinic', name: 'Meridian Clinic', clinicId: 'cccccccc-0000-4000-8000-00000000000b', patientName: 'Bob Meridian' });
const doctor = (id, name, color) => ({
  id, full_name: name, specialty: 'General Medicine', qualification: 'MBBS',
  day_start: '06:00', day_end: '23:00', slot_minutes: 20,
  fee_paise: 50000, follow_up_fee_paise: 30000, color,
});
const bookingProfile = (c, color) => ({
  enabled: true,
  clinic: {
    name: c.clinicRow.name, slug: c.clinicRow.slug, clinic_type: 'OPD Clinic',
    address: c.clinicRow.address, phone: c.clinicRow.phone, brand_color: color,
    booking_note: '', booking_horizon_days: 14,
  },
  doctors: [doctor(`doc-${c.clinicRow.slug}`, `Dr ${c.clinicRow.name.split(' ')[0]}`, color)],
});

// ── Evidence: per-host counters and the apikey each host actually saw ─────────
const hits = { [MASTER]: {}, [TEN_A]: {}, [TEN_A2]: {}, [TEN_B]: {} };
const keysSeen = { [TEN_A]: new Set(), [TEN_A2]: new Set(), [TEN_B]: new Set(), [MASTER]: new Set() };
const bump = (host, key) => { hits[host][key] = (hits[host][key] ?? 0) + 1; };
const n = (host, key) => hits[host][key] ?? 0;
const tenantRpcTotal = (host) => Object.keys(hits[host]).filter((k) => k.startsWith('rpc:') || k === 'clinics' || k === 'patients').reduce((s, k) => s + hits[host][k], 0);
const recordKey = (host, req) => { const k = req.headers()['apikey']; if (k) keysSeen[host].add(k); };

/**
 * The demo clinic's own slug, read from the app rather than hardcoded. `demoProfile()`
 * returns a profile ONLY when the requested slug equals it, so a fixture that reused this
 * slug renders the sample clinic — the first run of this harness did precisely that with
 * 'sunrise-opd', and the fail-open it exposed was real: P8e now makes `bookingApi` refuse
 * an unresolved slug in a live build instead of falling through to the demo workspace.
 * The guard stays anyway, because a colliding fixture still proves nothing here: you
 * cannot tell a refusal from a sample-clinic render without reading the clinic name, and
 * this harness asserts on RPC counts. harness/p5d-booking.cjs scenario 7 is the one that
 * uses the colliding slug ON PURPOSE and asserts the refusal by name.
 */
const DEMO_SLUG = (() => {
  try {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'src', 'lib', 'public-booking.mjs'), 'utf8');
    const m = /BOOKING_SLUG_FALLBACK\s*=\s*'([^']+)'/.exec(src);
    return m ? m[1] : '';
  } catch { return ''; }
})();
const FIXTURE_SLUGS = ['harbour-opd', 'meridian-clinic'];

const results = [];
const observations = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: Boolean(ok), detail }); };

/** Always print what was learned — a mid-run failure must not swallow the evidence. */
function report(pageErrors = []) {
  const failed = results.filter((r) => !r.ok);
  console.log('');
  for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok || !r.detail ? '' : `\n          ${r.detail}`}`);
  if (observations.length) {
    console.log('\n  observations (behaviour seen, not asserted):');
    for (const o of observations) console.log(`    · ${JSON.stringify(o)}`);
  }
  console.log('');
  console.log(`  ${results.length - failed.length} PASS · ${failed.length} FAIL${pageErrors.length ? ` · ${pageErrors.length} page error(s)` : ''}`);
  if (failed.length) console.log(`  failures: ${JSON.stringify(failed.map((f) => ({ name: f.name, detail: f.detail })), null, 2)}`);
  if (pageErrors.length) console.log(`  pageErrors: ${JSON.stringify(pageErrors.slice(0, 6), null, 2)}`);
  console.log(`  keys seen: ${JSON.stringify(Object.fromEntries(Object.entries(keysSeen).map(([k, v]) => [k, [...v]])))}`);
  return failed.length + pageErrors.length;
}

const masterSession = () => ({
  access_token: 'mock-master-access-token', token_type: 'bearer',
  expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
  refresh_token: 'mock-master-refresh-token',
  user: {
    id: USER_ID, aud: 'authenticated', role: 'authenticated', email: 'owner@clinic.in',
    email_confirmed_at: '2026-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z',
    app_metadata: { provider: 'email', role: 'clinic_user' },
    user_metadata: { full_name: 'Owner One' }, identities: [],
  },
});

async function mockAll(context) {
  await context.route(`${MASTER}/**`, async (route) => {
    const req = route.request();
    const url = req.url();
    recordKey(MASTER, req);
    const json = (o) => route.fulfill({ status: 200, headers: CORS, body: JSON.stringify(o) });
    if (url.includes('/auth/v1/token')) return json(masterSession());
    if (url.includes('/auth/v1/logout')) return route.fulfill({ status: 204, headers: CORS });
    if (url.includes('/auth/v1/user')) return json(masterSession().user);
    if (url.includes('/rpc/my_workspaces')) { bump(MASTER, 'my_workspaces'); return json(memberRows()); }
    if (url.includes('/rpc/public_workspace_by_slug')) {
      bump(MASTER, 'rpc:public_workspace_by_slug');
      let body = {}; try { body = req.postDataJSON(); } catch { /* no body */ }
      return json(bookingRows(String(body.p_slug ?? '')));
    }
    const t = (url.match(/\/rest\/v1\/([a-z_]+)/) || [])[1];
    if (t && t !== 'rpc') bump(MASTER, `clinical:${t}`);
    if (url.includes('/rest/v1/')) return json([]);
    return json({});
  });

  // Harbour's new project (post-rotation) serves the same clinic's data: a rotation
  // moves the credentials, not the patients.
  for (const [host, data, color] of [[TEN_A, CLINIC_A, '#e11d48'], [TEN_A2, CLINIC_A, '#e11d48'], [TEN_B, CLINIC_B, '#2563eb']]) {
    await context.route(`${host}/**`, async (route) => {
      const req = route.request();
      const url = req.url();
      const method = req.method();
      recordKey(host, req);
      const wantsObject = String(req.headers()['accept'] || '').includes('vnd.pgrst.object+json');
      const json = (o) => route.fulfill({ status: 200, headers: CORS, body: JSON.stringify(o) });
      if (url.includes('/auth/v1/')) return json({});
      if (url.includes('/rpc/app_schema_version')) { bump(host, 'app_schema_version'); return route.fulfill({ status: 200, headers: CORS, body: '22' }); }
      if (url.includes('/rpc/license_state')) { bump(host, 'rpc:license_state'); return json({ status: 'active', plan: 'pro', seats: 10, used: 1 }); }
      const fn = (url.match(/\/rpc\/([a-z_]+)/) || [])[1];
      let body = {}; try { body = req.postDataJSON(); } catch { /* no body */ }
      // ONLY for real RPC URLs: a `default` here would swallow every /rest/v1/<table>
      // read and hand the store `null`, which reads as "needs onboarding".
      if (fn) {
        bump(host, `rpc:${fn}`);
        switch (fn) {
          case 'public_clinic_profile': return json(bookingProfile(data, color));
          case 'public_booking_busy': return json({ busy: [] });
          case 'public_book': return json({ ref: `BK-${host === TEN_B ? 'RIV' : 'SUN'}999`, iso: body.p_date, at: body.p_time, doctor: 'Dr X', clinic: data.clinicRow.name, minutes: 20 });
          case 'public_booking_lookup': return json({ found: true, ref: body.p_ref, iso: '2026-11-10', at: '10:00', status: 'booked', doctor: 'Dr X', clinic: data.clinicRow.name, phone: data.clinicRow.phone, address: data.clinicRow.address, patient_first: 'Test' });
          case 'public_cancel_booking': return json({ cancelled: true, status: 'cancelled' });
          default: return json(null);
        }
      }
      const table = (url.match(/\/rest\/v1\/([a-z_]+)/) || [])[1];
      if (method === 'POST' || method === 'PATCH' || method === 'DELETE') {
        if (table) bump(host, `${method}:${table}`);
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

// ── Static server for the flag-on build ───────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.map': 'application/json',
  '.webmanifest': 'application/manifest+json',
};
function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const root = DIST;
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      let file = path.join(root, urlPath);
      if (!file.startsWith(root)) { res.writeHead(403); return res.end('forbidden'); }
      fs.stat(file, (err, st) => {
        if (err || !st.isFile()) file = path.join(root, 'index.html');
        fs.readFile(file, (e2, buf) => {
          if (e2) { res.writeHead(404); return res.end('not found'); }
          res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
          res.end(buf);
        });
      });
    });
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

// ── Page helpers ──────────────────────────────────────────────────────────────
const hash = (page) => page.evaluate(() => location.hash);
const bodyText = (page) => page.evaluate(() => document.body.innerText);
const has = (text, needle) => text.toLowerCase().includes(needle.toLowerCase());
const pointerSlug = async (page) => {
  const p = await page.evaluate(() => sessionStorage.getItem('opd.active.workspace'));
  try { return JSON.parse(p).slug; } catch { return null; }
};
/** R1 §9.2 revalidation without a reload: the tab goes away and comes back. */
const regainVisibility = async (page) => {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { get: () => 'hidden', configurable: true });
    Object.defineProperty(document, 'hidden', { get: () => true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
    Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
};
const settle = (page, ms = 1800) => page.waitForTimeout(ms);
const waitForPredicate = (page, fn, arg, timeout = 8000) => page.waitForFunction(fn, arg, { timeout }).catch(() => null);

/**
 * Open a booking page as a STRANGER WOULD: a fresh document. Navigating between
 * `#/book/a` and `#/book/b` is a same-document hash change, so the SPA (and any
 * module-scope resolution it already did) survives — which is not what a click on
 * a shared link does. Dropping to about:blank first forces a real load.
 */
const openBooking = async (page, slug) => {
  await page.goto('about:blank');
  await page.goto(`${BASE}#/book/${slug}`, { waitUntil: 'networkidle' });
  await settle(page, 1000);
};

async function signIn(page) {
  await page.goto(`${BASE}#/login`, { waitUntil: 'networkidle' });
  await page.fill('#email', 'owner@clinic.in');
  await page.fill('#password', 'password-one-two-three');
  await page.press('#password', 'Enter');
  await settle(page, 1400);
}
async function bookFirstSlot(page) {
  await page.locator('button.pub-doctor').first().click();
  await page.waitForTimeout(350);
  await page.locator('button.pub-day:not([disabled])').first().click();
  await page.waitForTimeout(300);
  const slot = page.locator('button.pub-slot').first();
  await slot.waitFor({ state: 'visible', timeout: 4000 });
  await slot.click();
  await page.waitForTimeout(200);
  await page.fill('input[placeholder="Full name"]', 'Test Patient');
  await page.fill('input[inputmode="tel"]', '9820011223');
  await page.locator('button[type="submit"]').click();
  await page.waitForTimeout(1200);
}

let server = null;
let browser = null;

(async () => {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    console.error(`MISSING BUILD: ${DIST}\nBuild it with: npm run test:e2e (or run vite build --outDir dist-gate --emptyOutDir with the directory env).`);
    process.exit(2);
  }
  server = await startServer();
  browser = await chromium.launch();
  const pageErrors = [];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await mockAll(ctx);
  // The stranger booking online has their OWN browser: a separate context, so none of
  // the operator's storage — notably `myclinic.demo.v1`, which demo mode writes — can
  // leak into the public page and mask a fail-closed.
  const anonCtx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  await mockAll(anonCtx);

  const P = await ctx.newPage();
  P.on('pageerror', (e) => pageErrors.push(e.message));
  const anon = await anonCtx.newPage();
  anon.on('pageerror', (e) => pageErrors.push(`anon: ${e.message}`));

  check('fixture slugs cannot collide with the demo clinic slug',
    DEMO_SLUG !== '' && !FIXTURE_SLUGS.includes(DEMO_SLUG), `demo slug=${DEMO_SLUG} fixtures=${FIXTURE_SLUGS.join(',')}`);

  /* ---- 1. baseline: two clinics, choose Harbour, it serves the reads ---- */
  await signIn(P);
  check('a member of two clinics gets the chooser', (await hash(P)) === '#/select', await hash(P));
  check('both clinics are offered', has(await bodyText(P), 'Harbour OPD') && has(await bodyText(P), 'Meridian Clinic'));
  await P.getByRole('button', { name: /Open Harbour OPD/ }).click();
  await settle(P, 2000);
  check('Harbour mounts and the session points at its slug',
    (await hash(P)).startsWith('#/app/') && (await pointerSlug(P)) === 'harbour-opd',
    `${await hash(P)} slug=${await pointerSlug(P)}`);
  check('Harbour\'s own project served the clinical reads', n(TEN_A, 'clinics') > 0 && n(TEN_A, 'patients') > 0, JSON.stringify(hits[TEN_A]));
  check('the pre-rotation project was reached with the ORIGINAL publishable key',
    keysSeen[TEN_A].has(KEY_A_OLD) && !keysSeen[TEN_A].has(KEY_A_NEW), [...keysSeen[TEN_A]].join(','));
  const aReadsBefore = tenantRpcTotal(TEN_A);
  const masterReadsBefore = n(MASTER, 'my_workspaces');

  /* ---- 2. DEACTIVATE the mounted clinic, then a visibility regain ---- */
  state.active['harbour-opd'] = false;                       // ← operator: update … set is_active = false
  await regainVisibility(P);
  await waitForPredicate(P, (u) => sessionStorage.getItem('opd.active.workspace') === null
    || JSON.parse(sessionStorage.getItem('opd.active.workspace') || '{}').slug !== u, 'harbour-opd');
  await settle(P, 2200);
  check('the tab-visibility regain re-read the directory (no reload)',
    n(MASTER, 'my_workspaces') > masterReadsBefore, `${masterReadsBefore} → ${n(MASTER, 'my_workspaces')}`);
  check('§8.4: the deactivated clinic no longer holds the session',
    (await pointerSlug(P)) !== 'harbour-opd', `slug=${await pointerSlug(P)} hash=${await hash(P)}`);
  check('§8.4: with one clinic left the gate auto-selects it instead of showing a chooser',
    (await pointerSlug(P)) === 'meridian-clinic' && (await hash(P)).startsWith('#/app/'),
    `${await hash(P)} slug=${await pointerSlug(P)}`);
  check('the ejected clinic\'s project served NO further clinical reads (the mount was disposed)',
    tenantRpcTotal(TEN_A) === aReadsBefore,
    `before=${aReadsBefore} now=${tenantRpcTotal(TEN_A)} hits=${JSON.stringify(hits[TEN_A])}`);
  check('Meridian served its own reads after the auto-select', n(TEN_B, 'clinics') > 0, JSON.stringify(hits[TEN_B]));

  /* ---- 3. the same deactivation darkens the PUBLIC booking link ---- */
  const aBefore = tenantRpcTotal(TEN_A);
  await openBooking(anon, 'harbour-opd');
  check('§8.4: the deactivated clinic\'s booking link is dark ("not available"), never the demo clinic',
    has(await bodyText(anon), 'Booking is not available') || has(await bodyText(anon), 'does not match a clinic'),
    (await bodyText(anon)).slice(0, 90));
  check('§8.4: the dark link fired NO tenant booking RPC', tenantRpcTotal(TEN_A) === aBefore, `${aBefore} → ${tenantRpcTotal(TEN_A)}`);
  await openBooking(anon, 'meridian-clinic');
  check('deactivation is per clinic: the other clinic\'s link still resolves',
    n(TEN_B, 'rpc:public_clinic_profile') > 0 && has(await bodyText(anon), 'Meridian Clinic'), JSON.stringify(hits[TEN_B]));

  /* ---- 4. REACTIVATE: both surfaces come back ---- */
  state.active['harbour-opd'] = true;                        // ← operator: set is_active = true
  // OBSERVATION, not a requirement: a booking tab that was already open keeps the
  // verdict it resolved before, because a hash-only navigation does not reload the
  // document. Recorded so the runbook can say what a re-load is and is not needed for.
  await anon.goto(`${BASE}#/book/harbour-opd`, { waitUntil: 'networkidle' });
  await settle(anon, 1400);
  observations.push({
    where: 'reactivation seen from an already-open booking tab (hash-only nav, no reload)',
    stillDark: has(await bodyText(anon), 'Booking is not available') || has(await bodyText(anon), 'does not match a clinic'),
    doctorsRendered: await anon.locator('button.pub-doctor').count(),
    text: (await bodyText(anon)).slice(0, 80).replace(/\n/g, ' '),
  });
  await openBooking(anon, 'harbour-opd');                     // a stranger's fresh click
  check('reactivating restores the public booking link at once',
    n(TEN_A, 'rpc:public_clinic_profile') > 0 && has(await bodyText(anon), 'Harbour OPD'), JSON.stringify(hits[TEN_A]));
  await regainVisibility(P);
  await settle(P, 2200);
  if ((await hash(P)) !== '#/select') {
    await P.goto(`${BASE}#/select`, { waitUntil: 'networkidle' });
    await settle(P, 1200);
  }
  check('§8.4: reactivation puts the clinic back in the member\'s directory',
    has(await bodyText(P), 'Harbour OPD') && has(await bodyText(P), 'Meridian Clinic'),
    `${await hash(P)} :: ${(await bodyText(P)).slice(0, 90).replace(/\n/g, ' ')}`);

  /* ---- 5. REVOKE the member (the clinic stays live for everyone else) ---- */
  await P.goto(`${BASE}#/select`, { waitUntil: 'networkidle' });
  await settle(P, 900);
  await P.getByRole('button', { name: /Open Harbour OPD/ }).click();
  await settle(P, 2000);
  check('re-mounted on Harbour before the revocation', (await pointerSlug(P)) === 'harbour-opd', String(await pointerSlug(P)));

  state.memberOf = ['meridian-clinic'];                     // ← operator: delete from workspace_members
  const harbourReadsAtRevoke = tenantRpcTotal(TEN_A);
  await regainVisibility(P);
  await waitForPredicate(P, (u) => JSON.parse(sessionStorage.getItem('opd.active.workspace') || '{}').slug !== u, 'harbour-opd');
  await settle(P, 2200);
  check('§8.4: the revoked member loses the clinic — the cached slug fails revalidation',
    (await pointerSlug(P)) !== 'harbour-opd', `slug=${await pointerSlug(P)} hash=${await hash(P)}`);
  check('the revoked clinic\'s project received no reads after the revocation',
    tenantRpcTotal(TEN_A) === harbourReadsAtRevoke, `${harbourReadsAtRevoke} → ${tenantRpcTotal(TEN_A)}`);
  const bookBefore = n(TEN_A, 'rpc:public_book');
  await openBooking(anon, 'harbour-opd');
  await bookFirstSlot(anon);
  check('REVOKE ≠ DEACTIVATE: the public link still books — the clinic is live for everyone else',
    n(TEN_A, 'rpc:public_book') === bookBefore + 1, `${bookBefore} → ${n(TEN_A, 'rpc:public_book')}`);

  /* ---- 6. ROTATE the publishable key: anon and signed-in both pick it up ---- */
  state.rotated = true;                                      // ← operator: set supabase_anon_key = '<new>'
  const oldProfileCalls = n(TEN_A, 'rpc:public_clinic_profile');
  const oldWrites = n(TEN_A, 'rpc:public_book');
  await openBooking(anon, 'harbour-opd');
  await bookFirstSlot(anon);
  check('§8.4: anon booking picked up the ROTATED project at once (profile served by the new host)',
    n(TEN_A2, 'rpc:public_clinic_profile') > 0, JSON.stringify(hits[TEN_A2]));
  check('§8.4: the rotated booking write landed on the NEW project, never the old one',
    n(TEN_A2, 'rpc:public_book') === 1 && n(TEN_A, 'rpc:public_book') === oldWrites && n(TEN_A, 'rpc:public_clinic_profile') === oldProfileCalls,
    `new=${JSON.stringify(hits[TEN_A2])} old=${JSON.stringify(hits[TEN_A])}`);
  check('§8.4: the NEW publishable key was really sent (apikey header), not just a new host',
    keysSeen[TEN_A2].has(KEY_A_NEW) && !keysSeen[TEN_A2].has(KEY_A_OLD), [...keysSeen[TEN_A2]].join(','));

  // Snapshot BEFORE the member row comes back. R1 §9.2's resolution order puts this
  // tab's session hint first, so the clinic may re-mount on its own without a click:
  // the proof is WHICH PROJECT served the clinical reads, not that a click happened.
  const newHostBefore = n(TEN_A2, 'clinics');
  const oldHostBefore = n(TEN_A, 'clinics');
  state.memberOf = ['harbour-opd', 'meridian-clinic'];      // the member row comes back
  await regainVisibility(P);
  await settle(P, 2400);
  if ((await pointerSlug(P)) !== 'harbour-opd') {
    await P.goto(`${BASE}#/select`, { waitUntil: 'networkidle' });
    await settle(P, 1200);
    await P.getByRole('button', { name: /Open Harbour OPD/ }).click();
    await settle(P, 2600);
  }
  check('F2: after a key rotation the signed-in mount reads clinical data from the NEW project',
    (await pointerSlug(P)) === 'harbour-opd' && n(TEN_A2, 'clinics') > newHostBefore,
    `slug=${await pointerSlug(P)} newHost clinics ${newHostBefore} → ${n(TEN_A2, 'clinics')}`);
  check('F2: the OLD project served no clinical reads after the rotation — no stored URL/key reached createClient',
    n(TEN_A, 'clinics') === oldHostBefore, `oldHost clinics ${oldHostBefore} → ${n(TEN_A, 'clinics')}`);
  check('F2: the remount sent the NEW key to the new project',
    keysSeen[TEN_A2].has(KEY_A_NEW), [...keysSeen[TEN_A2]].join(','));

  /* ---- 7. REVOKE everything: an empty directory routes to /no-clinic ---- */
  state.memberOf = [];                                       // ← operator: the last member row goes
  await regainVisibility(P);
  await waitForPredicate(P, () => location.hash === '#/no-clinic' || location.hash === '#/select');
  await settle(P, 1600);
  check('§8.4: an empty directory routes to /no-clinic — a cached slug cannot resurrect the session',
    (await hash(P)) === '#/no-clinic', `${await hash(P)} slug=${await pointerSlug(P)}`);
  check('the /no-clinic screen is honest (no clinic, no PHI, no demo fallback)',
    has(await bodyText(P), 'clinic') && !has(await bodyText(P), 'Alice Harbour'),
    (await bodyText(P)).slice(0, 120).replace(/\n/g, ' '));

  await ctx.close();
  await anonCtx.close();
  await browser.close();
  server.close();

  process.exit(report(pageErrors) ? 1 : 0);
})().catch((e) => {
  report();
  console.error('HARNESS ERROR', e && e.message ? e.message : e);
  try { if (browser) browser.close(); } catch { /* best effort */ }
  try { if (server) server.close(); } catch { /* best effort */ }
  process.exit(2);
});
