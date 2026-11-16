/**
 * OPD P5e-ii acceptance — the Setup deployment guide documents multi-clinic
 * (directory) mode ALONGSIDE single-project, and is mode-aware without changing
 * the flag-off flow. Two builds, two origins:
 *   :5213 dist-gate  — VITE_WORKSPACE_DIRECTORY=true + VITE_CENTRAL_* (directory)
 *   :5214 dist       — a plain build (single-project, the flag off)
 *
 * Directory build: the badge reads "Multi-clinic mode", the guide OPENS on the
 * Multi-clinic tab, the three variables are documented, and the Environment tab
 * carries a pointer to it. Single-project build: the badge and the default
 * Environment tab are exactly as before, the Environment tab has NO pointer
 * (byte-identical flow), and the Multi-clinic tab is present-but-inactive — the
 * documentation is alongside, never a cutover (owner decision defer_to_p8).
 */
const { chromium } = require('playwright'); // T6: devDependency, installed by `npm ci`
const DIR_BASE = 'http://127.0.0.1:5213/';
const SINGLE_BASE = 'http://127.0.0.1:5214/';
const CENTRAL = 'https://central-mock.supabase.co';

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail });

async function setupState(page) {
  return page.evaluate(() => {
    const text = document.body.innerText;
    const tabs = [...document.querySelectorAll('.tabs button')]
      .map((b) => ({ label: b.textContent.trim(), active: b.classList.contains('active') }));
    const badge = [...document.querySelectorAll('nav *, .mk-nav *')]
      .map((e) => (e.textContent || '').trim())
      .find((t) => /Multi-clinic mode|Multi-clinic — Central not set|Supabase connected|Demo mode/.test(t)) || '';
    const pre = [...document.querySelectorAll('pre')].map((p) => p.textContent).join('\n');
    return { text, tabs, badge, pre, hash: location.hash };
  });
}
const clickTab = (page, hasText) =>
  page.locator('.tabs button', { hasText }).first().click().then(() => page.waitForTimeout(300));

(async () => {
  const browser = await chromium.launch();
  const errs = [];

  /* ---- directory build ---- */
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    // Setup makes no Central call of its own, but the Master client exists in this
    // build; answer its auth endpoints so nothing can hang on an unmocked host.
    await ctx.route(`${CENTRAL}/**`, (route) => route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({}),
    }));
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errs.push(`dir: ${e.message}`));
    await page.goto(`${DIR_BASE}#/setup`, { waitUntil: 'load' });
    await page.waitForTimeout(700);
    let s = await setupState(page);
    check('DIR: lands on #/setup', s.hash.startsWith('#/setup'), s.hash);
    check('DIR: the badge reads "Multi-clinic mode"', /Multi-clinic mode/.test(s.badge), s.badge);
    const dirTab = s.tabs.find((t) => /Multi-clinic/.test(t.label));
    check('DIR: a Multi-clinic tab exists', Boolean(dirTab), JSON.stringify(s.tabs.map((t) => t.label)));
    check('DIR: the guide OPENS on the Multi-clinic tab (mode-aware default)', dirTab?.active === true, JSON.stringify(s.tabs));
    check('DIR: documents VITE_WORKSPACE_DIRECTORY', s.text.includes('VITE_WORKSPACE_DIRECTORY'), '');
    check('DIR: documents VITE_CENTRAL_SUPABASE_URL', s.text.includes('VITE_CENTRAL_SUPABASE_URL'), '');
    check('DIR: documents VITE_CENTRAL_SUPABASE_ANON_KEY', s.text.includes('VITE_CENTRAL_SUPABASE_ANON_KEY'), '');
    check('DIR: the snippet shows the example Central host (a placeholder, never a real project)',
      /your-central-project\.supabase\.co/.test(s.pre), s.pre.slice(0, 140));
    check('DIR: ties the mount to the C9 schema probe ("needs an update")',
      /needs an update/i.test(s.text) && /schema version/i.test(s.text), '');
    check('DIR: warns a service_role/sb_secret key must never be a VITE_ variable',
      /service_role/.test(s.text) && /sb_secret/.test(s.text), '');
    await clickTab(page, 'Environment');
    s = await setupState(page);
    check('DIR: the Environment tab points to multi-clinic mode', /This build is in multi-clinic mode/i.test(s.text), '');
    check('DIR: single-project env is still documented on the Environment tab',
      s.text.includes('VITE_SUPABASE_URL') && s.text.includes('VITE_SUPABASE_ANON_KEY'), '');
    await ctx.close();
  }

  /* ---- single-project build (flag off) ---- */
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errs.push(`single: ${e.message}`));
    await page.goto(`${SINGLE_BASE}#/setup`, { waitUntil: 'load' });
    await page.waitForTimeout(700);
    let s = await setupState(page);
    check('SINGLE: lands on #/setup', s.hash.startsWith('#/setup'), s.hash);
    check('SINGLE: the badge is NOT multi-clinic (flag-off identical)', !/Multi-clinic/.test(s.badge), s.badge);
    check('SINGLE: the badge reads "Demo mode" (no VITE_SUPABASE_* baked into this build)', /Demo mode/.test(s.badge), s.badge);
    const envTab = s.tabs.find((t) => /Environment/.test(t.label));
    const dirTab = s.tabs.find((t) => /Multi-clinic/.test(t.label));
    check('SINGLE: the Environment tab is the default (active) — flow unchanged', envTab?.active === true, JSON.stringify(s.tabs));
    check('SINGLE: the Multi-clinic tab is present but inactive (docs alongside, not a cutover)',
      Boolean(dirTab) && dirTab.active === false, JSON.stringify(s.tabs));
    check('SINGLE: the Environment tab has NO multi-clinic pointer (byte-identical)',
      !/This build is in multi-clinic mode/i.test(s.text), '');
    await clickTab(page, 'Multi-clinic');
    s = await setupState(page);
    check('SINGLE: the multi-clinic guide is still reachable for a deployer considering it',
      s.text.includes('VITE_WORKSPACE_DIRECTORY') && s.text.includes('VITE_CENTRAL_SUPABASE_URL'), '');
    await ctx.close();
  }

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(JSON.stringify({ results, pageErrors: errs, failed: failed.length }, null, 2));
  process.exit(failed.length || errs.length ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
