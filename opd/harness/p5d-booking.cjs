/**
 * OPD P5d-ii acceptance — R7 at the network level: a public booking resolves its tenant
 * through Central's `public_workspace_by_slug` and books into the CORRECT tenant project,
 * on the throwaway flag-on build (dist-gate, served :5213).
 *
 * Before P5d-ii a directory build set no VITE_SUPABASE_*, `public-booking.mjs`'s lazy
 * singleton came back null, and EVERY online booking silently fell through to the demo
 * workspace — a stranger's appointment vanished (R7, plan :606). This proves the fix on a
 * real build with a real (mocked) Central and two real (mocked) tenant projects:
 *
 *   1. /book/sunrise-opd  → Central resolves it to Sunrise's project → the public_book
 *      WRITE lands on TEN_A, never TEN_B, never Central.
 *   2. /book/riverside-opd → resolves to TEN_B (slug-namespaced; two clinics, two projects).
 *   3. an INACTIVE slug (gone-clinic) and an UNKNOWN slug → Central returns no rows → the
 *      page fails closed to "Booking is not available" and fires NO tenant booking RPC.
 *   4. the manage flow carries the slug (/booking/:slug/:ref) so lookup resolves to TEN_A;
 *      a bare /booking/:ref asks NO tenant (degrades to demo, never a wrong-clinic read).
 *   5. P8e: Sunrise's slug is ALSO the demo clinic's slug. Deactivate that row and the
 *      slug resolves to no client — the page must refuse ("Booking is not available"),
 *      never render the bookable SAMPLE clinic, and fire no tenant RPC at all.
 *
 * Per-host RPC counters are the proof of WHICH project actually served/received each call.
 * The booking page is public: it boots no auth context and no store, so the only Central
 * call is the directory RPC and the only tenant calls are the anon booking RPCs.
 */
const { chromium } = require('playwright'); // T6: devDependency, installed by `npm ci`
const fs = require('node:fs');
const BASE = 'http://127.0.0.1:5213/';
const MASTER = 'https://central-mock.supabase.co';
const TEN_A = 'https://sunrise-mock.supabase.co';
const TEN_B = 'https://riverside-mock.supabase.co';
const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

// What Central's public_workspace_by_slug returns: ONLY the four connection fields, and
// only for an ACTIVE workspace. gone-clinic is inactive and no-such-clinic never existed,
// so both come back as zero rows — the fail-closed the resolver depends on.
const ROW_A = { clinic_name: 'Sunrise OPD', slug: 'sunrise-opd', supabase_url: TEN_A, supabase_anon_key: 'sb_publishable_sunrise_mock_key' };
const ROW_B = { clinic_name: 'Riverside OPD', slug: 'riverside-opd', supabase_url: TEN_B, supabase_anon_key: 'sb_publishable_riverside_mock_key' };
const DIRECTORY = { 'sunrise-opd': [ROW_A], 'riverside-opd': [ROW_B] }; // anything else → []

// Read the demo clinic's identity out of the app rather than hard-coding it, so this
// harness breaks loudly if the sample data ever moves instead of quietly proving nothing.
// Resolve the app repo from either layout: harness/ inside it (canonical) or
// harness/ beside it (the old workspace layout). No absolute /home/user path.
const HERE = `${__dirname}/..`;
const REPO = fs.existsSync(`${HERE}/package.json`) ? HERE : `${HERE}/myclinic`;
const read = (rel) => fs.readFileSync(`${REPO}/${rel}`, 'utf8');
const pick = (src, re, what) => {
  const m = src.match(re);
  if (!m) { console.error(`HARNESS ERROR: could not read ${what}`); process.exit(2); }
  return m[1];
};
const DEMO_SLUG = pick(read('src/lib/public-booking.mjs'), /BOOKING_SLUG_FALLBACK = '([a-z0-9-]+)'/, 'the demo slug fallback');
const DEMO_NAME = pick(read('src/lib/demo-data.js'), /name: '([^']+)',\n\s*slug: '/, 'the demo clinic name');
const DEMO_CLINIC_SLUG = pick(read('src/lib/demo-data.js'), /name: '[^']+',\n\s*slug: '([a-z0-9-]+)'/, 'the demo clinic slug');
if (DEMO_SLUG !== DEMO_CLINIC_SLUG) { console.error(`HARNESS ERROR: fallback ${DEMO_SLUG} != demo slug ${DEMO_CLINIC_SLUG}`); process.exit(2); }

const doctor = (id, name, color) => ({
  id, full_name: name, specialty: 'General Medicine', qualification: 'MBBS',
  day_start: '06:00', day_end: '23:00', slot_minutes: 20,
  fee_paise: 50000, follow_up_fee_paise: 30000, color,
});
function tenantData({ name, slug, docName, color, phone, address, ref }) {
  return {
    ref,
    profile: {
      enabled: true,
      clinic: {
        name, slug, clinic_type: 'OPD Clinic', address, phone,
        brand_color: color, booking_note: '', booking_horizon_days: 14,
      },
      doctors: [doctor(`doc-${slug}`, docName, color)],
    },
    docName, clinicName: name, phone, address,
  };
}
const DATA_A = tenantData({ name: 'Sunrise OPD', slug: 'sunrise-opd', docName: 'Dr Asha Sunrise', color: '#e11d48', phone: '9000000001', address: '1 Clinic Rd, Pune', ref: 'BK-SUN123' });
const DATA_B = tenantData({ name: 'Riverside OPD', slug: 'riverside-opd', docName: 'Dr Ravi Riverside', color: '#2563eb', phone: '9000000002', address: '9 River Rd, Pune', ref: 'BK-RIV456' });

// Per-host RPC counters: proof of which project served/received what.
const hits = { [MASTER]: {}, [TEN_A]: {}, [TEN_B]: {} };
const bump = (host, key) => { hits[host][key] = (hits[host][key] ?? 0) + 1; };
const n = (host, key) => hits[host][key] ?? 0;
const tenantRpcTotal = (host) => Object.keys(hits[host]).filter((k) => k.startsWith('rpc:')).reduce((s, k) => s + hits[host][k], 0);

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: Boolean(ok), detail }); };

async function mockAll(context) {
  // Central: the anonymous directory RPC, and nothing clinical.
  await context.route(`${MASTER}/**`, async (route) => {
    const req = route.request();
    const url = req.url();
    const json = (o) => route.fulfill({ status: 200, headers: CORS, body: JSON.stringify(o) });
    if (url.includes('/auth/v1/')) return json({}); // anon booking holds no Master session
    if (url.includes('/rpc/public_workspace_by_slug')) {
      bump(MASTER, 'rpc:public_workspace_by_slug');
      let body = {}; try { body = req.postDataJSON(); } catch { /* no body */ }
      return json(DIRECTORY[String(body.p_slug ?? '')] ?? []);
    }
    if (url.includes('/rest/v1/')) { bump(MASTER, `UNEXPECTED:${(url.match(/\/rest\/v1\/([a-z_]+)/) || [])[1]}`); return json([]); }
    return json({});
  });
  // Tenants: the anon-safe booking RPCs only.
  for (const [host, data] of [[TEN_A, DATA_A], [TEN_B, DATA_B]]) {
    await context.route(`${host}/**`, async (route) => {
      const req = route.request();
      const url = req.url();
      const json = (o) => route.fulfill({ status: 200, headers: CORS, body: JSON.stringify(o) });
      if (url.includes('/auth/v1/')) return json({});
      const fn = (url.match(/\/rpc\/([a-z_]+)/) || [])[1];
      let body = {}; try { body = req.postDataJSON(); } catch { /* no body */ }
      if (fn) bump(host, `rpc:${fn}`);
      switch (fn) {
        case 'public_clinic_profile': return json(data.profile);
        case 'public_booking_busy': return json({ busy: [] });
        case 'public_book': return json({ ref: data.ref, iso: body.p_date, at: body.p_time, doctor: data.docName, clinic: data.clinicName, minutes: 20 });
        case 'public_booking_lookup': return json({ found: true, ref: body.p_ref, iso: '2026-11-10', at: '10:00', status: 'booked', doctor: data.docName, clinic: data.clinicName, phone: data.phone, address: data.address, patient_first: 'Test' });
        case 'public_cancel_booking': return json({ cancelled: true, status: 'cancelled' });
        default: return json(null);
      }
    });
  }
}

const hash = (page) => page.evaluate(() => location.hash);
const bodyText = (page) => page.evaluate(() => document.body.innerText);
const has = (text, needle) => text.toLowerCase().includes(needle.toLowerCase());

// Drive the public booking form: first doctor, first day with a free slot, first slot,
// a name and a number, then Confirm. Returns the reference shown on the confirmation.
async function completeBooking(page) {
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
  await page.waitForTimeout(1300);
  const ref = await page.locator('.pub-ref-code').textContent().catch(() => '');
  return String(ref ?? '').trim();
}

(async () => {
  const browser = await chromium.launch();
  const pageErrors = [];
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  await mockAll(ctx);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => pageErrors.push(e.message));

  /* ---- 1. /book/sunrise-opd resolves via Central and books into TEN_A ---- */
  await P.goto(`${BASE}#/book/sunrise-opd`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(900);
  check('Central was asked to resolve the slug', n(MASTER, 'rpc:public_workspace_by_slug') > 0, JSON.stringify(Object.keys(hits[MASTER])));
  check('R7: Sunrise profile served by TEN_A — the resolved tenant, not the singleton',
    n(TEN_A, 'rpc:public_clinic_profile') > 0 && n(TEN_B, 'rpc:public_clinic_profile') === 0,
    `A=${JSON.stringify(hits[TEN_A])} B=${JSON.stringify(hits[TEN_B])}`);
  check('the page shows the resolved clinic (Sunrise OPD)', has(await bodyText(P), 'Sunrise OPD'));

  const refA = await completeBooking(P);
  check('R7: the booking WRITE landed in SUNRISE (TEN_A), the correct tenant',
    n(TEN_A, 'rpc:public_book') === 1, JSON.stringify(hits[TEN_A]));
  check('R7: Riverside received NO booking write', n(TEN_B, 'rpc:public_book') === 0, JSON.stringify(hits[TEN_B]));
  check('R7: Central served the directory ONLY — never a booking RPC or clinical row',
    Object.keys(hits[MASTER]).every((k) => k === 'rpc:public_workspace_by_slug'), JSON.stringify(Object.keys(hits[MASTER])));
  check('a reference was issued on the confirmation', /^BK-/.test(refA), `ref="${refA}"`);

  /* ---- 2. the manage flow carries the slug → lookup resolves to TEN_A ---- */
  await P.getByRole('button', { name: /Manage booking/ }).click();
  await P.waitForTimeout(1100);
  check('manage URL carries the slug (/booking/:slug/:ref)', (await hash(P)) === `#/booking/sunrise-opd/${refA}`, await hash(P));
  check('the manage lookup resolved to TEN_A (the slug named the tenant)',
    n(TEN_A, 'rpc:public_booking_lookup') > 0 && n(TEN_B, 'rpc:public_booking_lookup') === 0, JSON.stringify(hits[TEN_A]));

  /* ---- 3. a bare /booking/:ref (no slug) asks NO tenant — degrades to demo ---- */
  const lookupA = n(TEN_A, 'rpc:public_booking_lookup');
  await P.goto(`${BASE}#/booking/${refA}`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(900);
  check('a bare-ref manage page fires NO tenant lookup (no slug → no tenant to ask)',
    n(TEN_A, 'rpc:public_booking_lookup') === lookupA && n(TEN_B, 'rpc:public_booking_lookup') === 0,
    `TEN_A lookup ${lookupA} → ${n(TEN_A, 'rpc:public_booking_lookup')}`);
  check('the bare-ref page is honest ("No appointment found"), not a wrong-clinic read',
    has(await bodyText(P), 'No appointment found'));

  /* ---- 4. /book/riverside-opd resolves to TEN_B (slug-namespaced) ---- */
  await P.goto(`${BASE}#/book/riverside-opd`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(900);
  check('Riverside profile served by TEN_B', n(TEN_B, 'rpc:public_clinic_profile') > 0, JSON.stringify(hits[TEN_B]));
  check('the page shows the resolved clinic (Riverside OPD)', has(await bodyText(P), 'Riverside OPD'));
  const aBookBefore = n(TEN_A, 'rpc:public_book');
  await completeBooking(P);
  check('R7: the Riverside booking landed in TEN_B, NOT Sunrise',
    n(TEN_B, 'rpc:public_book') === 1 && n(TEN_A, 'rpc:public_book') === aBookBefore,
    `A=${n(TEN_A, 'rpc:public_book')} B=${n(TEN_B, 'rpc:public_book')}`);

  /* ---- 5. an INACTIVE slug fails closed: no tenant, no write ---- */
  const aBefore = tenantRpcTotal(TEN_A), bBefore = tenantRpcTotal(TEN_B);
  await P.goto(`${BASE}#/book/gone-clinic`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(900);
  check('an INACTIVE slug fails closed — "Booking is not available", never the demo clinic',
    has(await bodyText(P), 'Booking is not available') || has(await bodyText(P), 'does not match a clinic'),
    (await bodyText(P)).slice(0, 90));
  check('an INACTIVE slug fired NO tenant booking RPC (Central returned no rows)',
    tenantRpcTotal(TEN_A) === aBefore && tenantRpcTotal(TEN_B) === bBefore,
    `A ${aBefore}→${tenantRpcTotal(TEN_A)} B ${bBefore}→${tenantRpcTotal(TEN_B)}`);
  check('Central WAS asked for the inactive slug (resolution attempted, then refused)',
    n(MASTER, 'rpc:public_workspace_by_slug') >= 3, `count=${n(MASTER, 'rpc:public_workspace_by_slug')}`);

  /* ---- 6. an UNKNOWN slug fails closed the same way ---- */
  const aBefore2 = tenantRpcTotal(TEN_A), bBefore2 = tenantRpcTotal(TEN_B);
  await P.goto(`${BASE}#/book/no-such-clinic`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(900);
  check('an UNKNOWN slug fails closed — "Booking is not available"',
    has(await bodyText(P), 'Booking is not available') || has(await bodyText(P), 'does not match a clinic'),
    (await bodyText(P)).slice(0, 90));
  check('an UNKNOWN slug fired NO tenant booking RPC',
    tenantRpcTotal(TEN_A) === aBefore2 && tenantRpcTotal(TEN_B) === bBefore2,
    `A ${aBefore2}→${tenantRpcTotal(TEN_A)} B ${bBefore2}→${tenantRpcTotal(TEN_B)}`);

  /* ---- 7. P8e: the demo clinic's OWN slug, unresolved, must fail closed ---- */
  // Scenario 1 proved this slug resolves and books into TEN_A. Now deactivate that
  // directory row — which is exactly what an operator does in Central — and the slug
  // resolves to NO client. Before P8e, bookingApi read that as "use the demo workspace",
  // and because the sample clinic is published at this very slug, a stranger got a full,
  // bookable Sunrise Multispecialty OPD and a reference that existed in no project.
  // A live build must refuse.
  delete DIRECTORY[DEMO_SLUG];
  const aBefore3 = tenantRpcTotal(TEN_A), bBefore3 = tenantRpcTotal(TEN_B);
  await P.goto('about:blank');
  await P.goto(`${BASE}#/book/${DEMO_SLUG}`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(900);
  const darkBody = await bodyText(P);
  check('P8e: a deactivated slug that collides with the demo clinic fails CLOSED',
    has(darkBody, 'Booking is not available'), darkBody.slice(0, 90));
  check(`P8e: the SAMPLE clinic (${DEMO_NAME}) is never shown to a stranger`,
    !has(darkBody, DEMO_NAME), darkBody.slice(0, 120));
  check('P8e: no booking flow was offered — no doctor, no day, no slot, no form',
    await P.locator('button.pub-doctor').count() === 0
      && await P.locator('button.pub-day').count() === 0
      && await P.locator('button.pub-slot').count() === 0
      && await P.locator('input[placeholder="Full name"]').count() === 0);
  check('P8e: NO tenant RPC at all — the refusal happened before any booking call',
    tenantRpcTotal(TEN_A) === aBefore3 && tenantRpcTotal(TEN_B) === bBefore3,
    `A ${aBefore3}→${tenantRpcTotal(TEN_A)} B ${bBefore3}→${tenantRpcTotal(TEN_B)}`);
  check('P8e: Central WAS asked (resolution attempted, then refused — not skipped)',
    n(MASTER, 'rpc:public_workspace_by_slug') >= 4, `count=${n(MASTER, 'rpc:public_workspace_by_slug')}`);
  DIRECTORY[DEMO_SLUG] = [ROW_A]; // leave the fixture exactly as it was found

  await ctx.close();
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(JSON.stringify({ results, hits, pageErrors, failed: failed.length }, null, 2));
  process.exit(failed.length || pageErrors.length ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
