const { chromium } = require('playwright'); // T6: devDependency, installed by `npm ci`
const BASE = 'http://127.0.0.1:5212/';
const MASTER = 'https://central-mock.supabase.co';
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext();
  const logs = [];
  await ctx.route(`${MASTER}/**`, async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    logs.push(`${method} ${url.replace(MASTER, '')}`);
    const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
    if (url.includes('/auth/v1/token')) {
      return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({
        access_token: 'mock-master-access-token', token_type: 'bearer', expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r',
        user: { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', email: 'owner@clinic.in',
          email_confirmed_at: '2026-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z',
          app_metadata: { provider: 'email' }, user_metadata: {}, identities: [] } }) });
    }
    if (url.includes('/rpc/my_workspaces')) {
      return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify([{
        id: 'aaaaaaaa-0000-4000-8000-000000000001', clinic_name: 'Sunrise OPD', slug: 'sunrise-opd',
        supabase_url: 'https://sunrise-mock.supabase.co', supabase_anon_key: 'sb_publishable_sunrise_mock_key',
        role: 'admin', is_active: true, tenant_schema_version: 22 }]) });
    }
    if (url.includes('/auth/v1/')) return route.fulfill({ status: 204, headers: CORS });
    return route.fulfill({ status: 200, headers: CORS, body: '[]' });
  });
  await ctx.route('https://sunrise-mock.supabase.co/**', (route) => route.fulfill({
    status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: '{}' }));
  const p = await ctx.newPage();
  p.on('pageerror', (e) => logs.push(`PAGEERROR ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`CONSOLE ${m.type()} ${m.text().slice(0, 200)}`); });
  p.on('requestfailed', (r) => logs.push(`REQFAIL ${r.url().slice(0, 120)} ${r.failure()?.errorText}`));
  await p.goto(`${BASE}#/login`, { waitUntil: 'networkidle' });
  await p.fill('#email', 'owner@clinic.in');
  await p.fill('#password', 'password-one-two-three');
  await p.press('#password', 'Enter');
  await p.waitForTimeout(2500);
  console.log('hash:', await p.evaluate(() => location.hash));
  console.log('root text:', (await p.locator('#root').innerText()).slice(0, 400).replace(/\n/g, ' | '));
  console.log('buttons:', JSON.stringify(await p.locator('button').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') || e.textContent.slice(0, 40)))));
  console.log('pointer:', await p.evaluate(() => sessionStorage.getItem('opd.active.workspace')));
  console.log('network:', logs.join('\n'));
  await b.close();
})();
