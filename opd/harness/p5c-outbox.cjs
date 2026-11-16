/**
 * OPD P5c acceptance — C7 at the network level: the slug-namespaced outbox replays
 * into the CORRECT tenant, against a mocked Master and two mocked tenant projects,
 * on the throwaway flag-on build (dist-gate, served :5212).
 *
 * P5b proved clinical READS bind to the mounted tenant. This proves the WRITE half:
 * a patient queued offline for Sunrise lands only in `myclinic.outbox.v3.sunrise-opd.*`,
 * survives the clinic switch (the switch-purge SPARES the outbox — owner decision, P5c),
 * is NEVER replayed into Riverside while Riverside is mounted (the exact bug C7 names:
 * the old shared `myclinic.outbox.v2.<userId>` key let one doctor's Clinic-A writes
 * replay into Clinic B), and replays against Sunrise's own project on return.
 *
 * The enqueue-side namespacing (a write goes to the right key) is unit-proven in
 * tests/outbox-namespace.test.mjs; here the outbox is seeded to that proven shape so
 * the browser can prove the replay-BINDING half, which only a live client can show.
 * Request counters per host prove which project actually received the write.
 */
const { chromium } = require('playwright'); // T6: devDependency, installed by `npm ci`
const BASE = 'http://127.0.0.1:5212/';
const MASTER = 'https://central-mock.supabase.co';
const TEN_A = 'https://sunrise-mock.supabase.co';
const TEN_B = 'https://riverside-mock.supabase.co';
const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
const USER_ID = '11111111-1111-4111-8111-111111111111';
const outboxKey = (slug) => `myclinic.outbox.v3.${slug}.${USER_ID}`;

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
const directoryRows = [ROW_A, ROW_B];

// Per-host counters, split reads from writes: proof of WHICH project served/received what.
const hits = { [MASTER]: {}, [TEN_A]: {}, [TEN_B]: {} };
const bump = (host, key) => { hits[host][key] = (hits[host][key] ?? 0) + 1; };
const writesTo = (host) => Object.entries(hits[host]).filter(([k]) => /^(POST|PATCH|DELETE):/.test(k));

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
      if (url.includes('/rpc/app_schema_version')) { bump(host, 'app_schema_version'); return route.fulfill({ status: 200, headers: CORS, body: '22' }); }
      if (url.includes('/rpc/license_state')) { bump(host, 'rpc:license_state'); return json({ status: 'active', plan: 'pro', seats: 10, used: 1 }); }
      if (url.includes('/rpc/accept_invite')) { bump(host, 'rpc:accept_invite'); return json(null); }
      const table = (url.match(/\/rest\/v1\/([a-z_]+)/) || [])[1];

      // WRITES — the outbox replay. Counted per method so a cross-clinic leak is visible.
      if (method === 'POST' || method === 'PATCH' || method === 'DELETE') {
        if (table) bump(host, `${method}:${table}`);
        let body = {}; try { body = req.postDataJSON(); } catch { /* no body */ }
        const one = Array.isArray(body) ? body[0] : body;
        if (method === 'POST') return json(one);              // .insert().select().single()
        if (method === 'PATCH') return json(wantsObject ? one : [one]);
        return json([]);                                       // DELETE
      }

      // READS
      if (table) bump(host, table);
      switch (table) {
        case 'profiles': return json(wantsObject ? data.profile : [data.profile]);
        case 'clinics': return json(wantsObject ? data.clinicRow : [data.clinicRow]);
        case 'staff': return json([data.staffRow]);
        case 'patients':
          // The replay's dedupe probe filters by client_id/id and must find nothing, so
          // the queued create proceeds to INSERT. loadLive filters by clinic_id → the list.
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
// Flip connectivity the way the store reads it: navigator.onLine (flush/create guards)
// AND the online/offline events (the React `online` state that re-runs the flush effect).
// Playwright routes keep serving — this never blocks the mocks, only the app's own logic.
const setConnectivity = (page, online) => page.evaluate((v) => {
  Object.defineProperty(navigator, 'onLine', { get: () => v, configurable: true });
  window.dispatchEvent(new Event(v ? 'online' : 'offline'));
}, online);
const readOutbox = (page, slug) => page.evaluate((k) => {
  try { return JSON.parse(localStorage.getItem(k)) ?? []; } catch { return []; }
}, outboxKey(slug));
const keyExists = (page, slug) => page.evaluate((k) => localStorage.getItem(k) !== null, outboxKey(slug));

// A queued offline create for Sunrise, in the exact shape store.jsx `create` enqueues.
const queuedCreate = {
  op_id: 'op-offline-a1', type: 'create', table: 'patients',
  row: {
    id: 'pat-offline-a1', clinic_id: CLINIC_A.clinicId, full_name: 'Offline Alice', code: 'P-OFF-1',
    phone: '9222222222', email: '', gender: 'female', date_of_birth: '1991-01-01', address: '3 Offline Ln',
    city: 'Pune', tags: [], allergies: null, notes: 'queued offline in Sunrise', created_at: '2026-01-03T00:00:00Z',
    created_by: USER_ID, client_id: 'cid-offline-a1',
  },
  client_id: 'cid-offline-a1', queued_at: '2026-01-03T00:00:00Z',
};

(async () => {
  const browser = await chromium.launch();
  const pageErrors = [];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await mockAll(ctx);

  const A = await ctx.newPage();
  A.on('pageerror', (e) => pageErrors.push(`A: ${e.message}`));

  /* ---- 1. login → mount Sunrise → clinical reads come from TEN_A ---- */
  await A.goto(`${BASE}#/login`, { waitUntil: 'networkidle' });
  await A.fill('#email', 'owner@clinic.in');
  await A.fill('#password', 'password-one-two-three');
  await A.press('#password', 'Enter');
  await A.waitForTimeout(1200);
  await A.getByRole('button', { name: /Open Sunrise OPD/ }).click();
  await A.waitForTimeout(1600);
  check('Sunrise mounts and lands in the app', (await hash(A)).startsWith('#/app/') && (await pointerSlug(A)) === 'sunrise-opd',
    `${await hash(A)} slug=${await pointerSlug(A)}`);
  check('TEN_A served the clinical reads', hits[TEN_A].clinics > 0 && hits[TEN_A].patients > 0, JSON.stringify(hits[TEN_A]));

  /* ---- 2. go offline, queue a create for Sunrise (the proven enqueue shape) ---- */
  await setConnectivity(A, false);
  await A.evaluate(([k, op]) => localStorage.setItem(k, JSON.stringify([op])), [outboxKey('sunrise-opd'), queuedCreate]);
  check('the queued write is in Sunrise\'s v3 outbox', (await readOutbox(A, 'sunrise-opd')).length === 1,
    JSON.stringify((await readOutbox(A, 'sunrise-opd')).map((o) => o.op_id)));
  check('C7: Riverside\'s outbox namespace is empty (no shared key)', (await readOutbox(A, 'riverside-clinic')).length === 0,
    'a write for Sunrise must never sit in Riverside\'s namespace');
  check('no write reached either tenant while offline', writesTo(TEN_A).length === 0 && writesTo(TEN_B).length === 0,
    `A=${JSON.stringify(writesTo(TEN_A))} B=${JSON.stringify(writesTo(TEN_B))}`);

  /* ---- 3. switch to Riverside while offline: the switch-purge SPARES the outbox ---- */
  await A.goto(`${BASE}#/select`, { waitUntil: 'networkidle' });
  await A.waitForTimeout(700);
  await A.getByRole('button', { name: /Open Riverside Clinic/ }).click();
  await A.waitForTimeout(1600);
  check('Riverside is now mounted', (await pointerSlug(A)) === 'riverside-clinic', String(await pointerSlug(A)));
  check('the switch-purge SPARED Sunrise\'s outbox (pending writes survive a switch)',
    await keyExists(A, 'sunrise-opd') && (await readOutbox(A, 'sunrise-opd')).length === 1,
    `key present=${await keyExists(A, 'sunrise-opd')} ops=${(await readOutbox(A, 'sunrise-opd')).length}`);

  /* ---- 4. reconnect in Riverside: its flush must NOT replay Sunrise's write ---- */
  await setConnectivity(A, true);
  await A.waitForTimeout(2000);
  check('C7: reconnecting in Riverside sent NO write to Riverside (Sunrise\'s op did not leak)',
    writesTo(TEN_B).length === 0, JSON.stringify(writesTo(TEN_B)));
  check('C7: Sunrise\'s op is still queued, untouched by Riverside\'s flush',
    (await readOutbox(A, 'sunrise-opd')).length === 1, `ops=${(await readOutbox(A, 'sunrise-opd')).length}`);
  check('Riverside served its own clinical reads (the switch really remounted)',
    hits[TEN_B].clinics > 0 && hits[TEN_B].patients > 0, JSON.stringify(hits[TEN_B]));

  /* ---- 5. switch back to Sunrise (online): the op replays against TEN_A ---- */
  const aWritesBefore = (hits[TEN_A]['POST:patients'] ?? 0);
  await A.goto(`${BASE}#/select`, { waitUntil: 'networkidle' });
  await A.waitForTimeout(700);
  await A.getByRole('button', { name: /Open Sunrise OPD/ }).click();
  await A.waitForTimeout(2500);
  check('Sunrise is mounted again', (await pointerSlug(A)) === 'sunrise-opd', String(await pointerSlug(A)));
  check('C7: the queued write replayed against SUNRISE\'s project (TEN_A), the correct tenant',
    (hits[TEN_A]['POST:patients'] ?? 0) > aWritesBefore, `POST:patients ${aWritesBefore} → ${hits[TEN_A]['POST:patients'] ?? 0}`);
  check('C7: the replay consumed Sunrise\'s outbox (the op is gone)',
    (await readOutbox(A, 'sunrise-opd')).length === 0, `ops left=${(await readOutbox(A, 'sunrise-opd')).length}`);
  check('C7: Riverside still received NO write at any point', writesTo(TEN_B).length === 0, JSON.stringify(writesTo(TEN_B)));
  check('the Master never served or received clinical data', !Object.keys(hits[MASTER]).some((k) => k.startsWith('clinical:') || /^(POST|PATCH|DELETE):/.test(k)),
    JSON.stringify(Object.keys(hits[MASTER])));

  await ctx.close();
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(JSON.stringify({ results, hits, pageErrors, failed: failed.length }, null, 2));
  process.exit(failed.length || pageErrors.length ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
