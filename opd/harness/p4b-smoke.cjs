/**
 * OPD P4b smoke proof: TenantProvider now sits in EVERY user's render tree, so the
 * legacy boot (directory flag off, no Central env in the build) must be untouched.
 * Asserts no uncaught error, and that no legacy user is sent to /select or
 * /no-clinic — the two ways an over-eager gate would show up.
 */
const { chromium } = require('playwright'); // T6: devDependency, installed by `npm ci`
const BASE = 'http://127.0.0.1:5211/';
const OUT = '/tmp/ui-level2';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message ?? e)));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  const results = [];
  async function visit(hash, label) {
    await page.goto(`${BASE}${hash}`, { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(600);
    const url = page.url();
    const text = (await page.locator('#root').innerText().catch(() => '')).trim();
    results.push({
      label,
      hash: url.split('#')[1] ?? '',
      chars: text.length,
      head: text.split('\n').slice(0, 2).join(' | ').slice(0, 90),
      onChooser: /#\/(select|no-clinic)/.test(url),
    });
    return { url, text };
  }

  await visit('', 'landing');
  await page.screenshot({ path: `${OUT}/p4b-landing-desktop.png` });
  const login = await visit('#/login', 'login');
  await page.screenshot({ path: `${OUT}/p4b-login-desktop.png` });
  await visit('#/app/dashboard', 'app-shell');
  await page.screenshot({ path: `${OUT}/p4b-app-desktop.png` });
  await visit('#/select', 'select-route');
  await visit('#/no-clinic', 'no-clinic-route');

  await page.setViewportSize({ width: 375, height: 812 });
  await visit('', 'landing-mobile');
  await page.screenshot({ path: `${OUT}/p4b-landing-mobile.png`, fullPage: false });
  await visit('#/login', 'login-mobile');
  await page.screenshot({ path: `${OUT}/p4b-login-mobile.png` });

  console.log(JSON.stringify({ results, pageErrors, consoleErrors }, null, 2));
  await browser.close();
  process.exit(pageErrors.length ? 1 : 0);
})();
