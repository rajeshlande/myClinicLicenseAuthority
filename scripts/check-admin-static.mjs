#!/usr/bin/env node
/**
 * P6 · §12.1 item 1 — "Master Admin App contains zero dynamic tenant-switching logic."
 *
 * The brief wrote item 1 for a THIN static admin portal sitting beside a separate
 * Master backend ("exactly 1 createClient; zero supabase_anon_key / my_workspaces /
 * workspaces.select"). This project's App 1 is the Central repository, which is BOTH
 * the admin portal AND the directory authority: it stores each clinic's publishable
 * key at onboarding, defines `my_workspaces()`, and probes tenants (keep-warm, the
 * connection check). Those references are the Master doing its job, not an admin UI
 * switching clinics — so the literal "zero" wording cannot apply to them.
 *
 * Owner decision `p6_item1_admin_static = intent_allowlist`: enforce the INTENT —
 * the admin app never dynamically mounts or switches a tenant client and never reads
 * clinical data — and confine the legitimate directory-authority surface to an
 * allowlist of Master-side modules. A NEW file carrying those terms fails, which is
 * the ratchet's whole point.
 *
 * T5 added the fifth entry: the §14 operator console is the one UI that lists and
 * mutates the directory, so it names these terms by design. Its decisions live in
 * src/lib/workspace-console.mjs, which names none of them and is NOT allowlisted —
 * that split is what keeps the privileged surface at one new file.
 *
 * The four invariants, all mutation-proved in tests/admin-static.test.mjs:
 *   A. exactly ONE `createClient(` in src/ — Central's own Master project client,
 *      fed from `import.meta.env`. A second one means a per-clinic client. (§12.2:
 *      "inject a second createClient in App 1 → item 1 fails".)
 *   B. zero tenant-switch markers — `mountTenant`, `disposeTenant`, a per-slug client
 *      cache, or any `VITE_*TENANT*` build variable. Central has one client, full stop.
 *   C. zero clinical/PHI table reads — `.from('patients')` and the rest of the tenant
 *      clinical surface. Patient data never reaches the admin app; Central's own
 *      Master-side `invoices` (subscription billing) and `workspaces` are NOT clinical
 *      and are deliberately allowed.
 *   D. the directory-authority terms (`supabase_anon_key`, `my_workspaces`,
 *      `workspaces`, `set_clinic_slug`, `tenant_members`) appear ONLY in the
 *      allowlisted Master-side modules.
 * Plus a bundle scan: no tenant project host and no `sb_secret_…` key baked into dist/
 * (§12.3). The Master URL and documentation placeholders are allowed.
 *
 * Run with: npm run check:admin-static   (exported functions are unit-tested directly)
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The tenant CLINICAL/PHI tables the admin app must never read. Source of truth is
 * myClinic's `supabase/tenant/tenant-schema.sql` (the per-clinic template). Central's
 * own `invoices` (subscription billing), `subscriptions`, `workspaces`, `licenses`,
 * `clinic_activity_log`, `admin_license_view` and `activated_machines` are Master-side
 * and intentionally absent from this list.
 */
export const CLINICAL_TABLES = Object.freeze([
  'patients', 'appointments', 'consultations', 'day_closes', 'reminders',
  'profiles', 'staff', 'staff_branches', 'branches', 'invites',
]);

/**
 * The Master-side directory modules. Central IS the directory authority, so these
 * legitimately name a clinic's publishable key and query the `workspaces` table;
 * everywhere else, those terms mean the admin app is reaching into a tenant.
 */
export const DIRECTORY_AUTHORITY_ALLOWLIST = Object.freeze([
  'src/components/entitlements/OnboardingWizard.jsx',
  'src/lib/keep-warm.mjs',
  'src/lib/tenant-connection.mjs',
  'src/pages/SetupPage.jsx',
  'src/pages/WorkspacesPage.jsx',
]);

/** Dynamic per-clinic tenant switching — the exact thing item 1 forbids. */
const TENANT_SWITCH_RE = /\bmountTenant\b|\bdisposeTenant\b|\btenantClient\b|\bclientsBySlug\b|\buseTenantClient\b|VITE_[A-Z0-9_]*TENANT[A-Z0-9_]*/g;

const CREATE_CLIENT_RE = /\bcreateClient\s*\(/g;
const FROM_TABLE_RE = /\.from\(\s*['"]([a-z_]+)['"]\s*\)/g;
const DIRECTORY_TERM_RE = /\bsupabase_anon_key\b|\bmy_workspaces\b|\bworkspaces\b|\bset_clinic_slug\b|\btenant_members\b/g;

/** A real Supabase project host compiled into the bundle. */
const SUPABASE_HOST_RE = /https:\/\/[a-z0-9][a-z0-9-]*\.supabase\.co/gi;
/** Hosts that are documentation, not a project — incl. Supabase's own `project-ref` example. */
const PLACEHOLDER_HOST_RE = /your[-_]|^https:\/\/(abc|xxx|demo|test)\.|abc\.supabase\.co|project-ref|example\.com|placeholder|<[^>]*>/i;
/** A secret-key literal shape (the bare word `service_role` in guard code is not a key). */
const SECRET_KEY_RE = /\bsb_secret_[A-Za-z0-9_-]{16,}|\bservice_role_key['"]?\s*[:=]\s*['"][A-Za-z0-9._-]{16,}/g;

export function isPlaceholderHost(host) {
  return PLACEHOLDER_HOST_RE.test(String(host));
}

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

const SCAN_EXT = /\.(js|jsx|mjs)$/;
function walk(dir, root, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, root, acc);
    else if (SCAN_EXT.test(entry.name)) acc.push(relative(root, full).split('\\').join('/'));
  }
  return acc;
}

/** Every source file under src/, as repo-relative paths. */
export function collectSourceFiles(root) {
  return walk(resolve(root, 'src'), root).sort();
}

/** The built bundle (dist/assets), where a compiled-in credential would land. */
export function collectDistFiles(root) {
  return walk(resolve(root, 'dist', 'assets'), root).sort();
}

/**
 * The four source invariants (A–D). Pure: takes `{file, text}` entries so the
 * mutation test can inject offenders without touching the tree.
 */
export function findAdminStaticViolations(entries, options = {}) {
  const allowlist = options.allowlist ?? DIRECTORY_AUTHORITY_ALLOWLIST;
  const clinical = options.clinicalTables ?? CLINICAL_TABLES;
  const violations = [];
  const push = (file, text, index, rule, detail) =>
    violations.push({ file, line: text ? lineOf(text, index) : 1, rule, detail });

  let createClientCount = 0;
  const createClientFiles = [];

  for (const { file, text } of entries) {
    // A. count every client construction across the whole app.
    const calls = [...text.matchAll(CREATE_CLIENT_RE)];
    if (calls.length) {
      createClientCount += calls.length;
      createClientFiles.push(`${file} (${calls.length})`);
    }

    // B. dynamic tenant switching, anywhere.
    for (const m of text.matchAll(TENANT_SWITCH_RE)) {
      push(file, text, m.index, 'tenant-switch',
        `${m[0]} is dynamic per-clinic tenant switching — the admin app has exactly one Master client`);
    }

    // C. clinical/PHI table reads, anywhere.
    for (const m of text.matchAll(FROM_TABLE_RE)) {
      if (clinical.includes(m[1])) {
        push(file, text, m.index, 'clinical-table',
          `.from('${m[1]}') reads a tenant clinical table — PHI never reaches the admin app`);
      }
    }

    // D. directory-authority terms outside the allowlist.
    if (!allowlist.includes(file)) {
      for (const m of text.matchAll(DIRECTORY_TERM_RE)) {
        push(file, text, m.index, 'directory-authority',
          `${m[0]} belongs to the Master-side directory modules (the allowlist), not to ${file}`);
      }
    }
  }

  // A. the count is a whole-app invariant, decided after the pass.
  if (createClientCount !== 1) {
    violations.push({
      file: createClientFiles.join(', ') || '(none)',
      line: 1,
      rule: 'create-client-count',
      detail: `the admin app must build exactly 1 Supabase client (its own Master project); found ${createClientCount}`,
    });
  }

  return violations;
}

/**
 * The bundle half: no tenant project host and no secret key compiled into dist/.
 * The build-time Master URL and documentation placeholders are allowed — Central
 * bakes no tenant URL by construction (clinic URLs are runtime directory values),
 * so anything else here is a leak.
 */
export function findDistViolations(entries, options = {}) {
  const masterUrls = [options.masterUrl, options.centralUrl]
    .map((u) => String(u ?? '').trim().replace(/\/$/, ''))
    .filter(Boolean);
  const violations = [];
  for (const { file, text } of entries) {
    for (const m of text.matchAll(SUPABASE_HOST_RE)) {
      const host = m[0].replace(/\/$/, '');
      if (masterUrls.includes(host)) continue;
      if (isPlaceholderHost(host)) continue;
      violations.push({ file, line: 1, rule: 'dist-tenant-url', detail: `the bundle contains ${host}, which is not the Master URL` });
    }
    for (const m of text.matchAll(SECRET_KEY_RE)) {
      violations.push({ file, line: 1, rule: 'dist-secret-key', detail: 'the bundle contains a service-role/secret key literal' });
    }
  }
  return violations;
}

/* ----------------------------------------------------------------------- CLI */

function main() {
  const root = resolve(fileURLToPath(import.meta.url), '..', '..');
  const sourceFiles = collectSourceFiles(root);
  const sourceEntries = sourceFiles.map((file) => ({ file, text: readFileSync(resolve(root, file), 'utf8') }));
  const sourceViolations = findAdminStaticViolations(sourceEntries);

  const distFiles = collectDistFiles(root);
  const distEntries = distFiles.map((file) => ({ file, text: readFileSync(resolve(root, file), 'utf8') }));
  const distViolations = findDistViolations(distEntries, {
    masterUrl: process.env.VITE_SUPABASE_URL ?? '',
    centralUrl: process.env.VITE_CENTRAL_SUPABASE_URL ?? '',
  });

  const clientCount = sourceEntries.reduce((n, e) => n + [...e.text.matchAll(CREATE_CLIENT_RE)].length, 0);
  console.log(`admin-static · §12.1 item 1 · ${sourceFiles.length} source files · ${distFiles.length} bundle files`);
  console.log(`  createClient in src/: ${clientCount} (must be exactly 1)`);
  console.log(`  directory-authority allowlist: ${DIRECTORY_AUTHORITY_ALLOWLIST.join(', ')}`);
  if (!distFiles.length) console.log('  dist/ absent: run npm run build first to scan the bundle');

  const all = [...sourceViolations, ...distViolations];
  if (all.length) {
    console.log('');
    for (const v of all) console.log(`  ✗ ${v.file}:${v.line} [${v.rule}] ${v.detail}`);
    console.error(`\n${all.length} violation(s): the admin app must contain zero dynamic tenant-switching logic.`);
    process.exit(1);
  }
  console.log('  ✓ one Master client, no tenant switching, no clinical read, directory authority allowlisted, bundle clean');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
