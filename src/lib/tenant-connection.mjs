/**
 * Tenant connection validation + the live 5-point check (OPD P2, R2 §6 E3).
 *
 * Every clinic owns its own Supabase project (free tier = 2 active projects per
 * org) and hands Central the URL plus its PUBLISHABLE key during onboarding.
 * That handover is the whole trust boundary for the tenant side, so it is never
 * accepted on faith: this module turns the pasted values into the same
 * `{ id, label, state, detail }` check list myClinic's own readiness probe uses
 * (`configChecks` / `restCheck` / `schemaCheck` / `readiness`), so both sides of
 * the product speak one vocabulary about "is this connection real".
 *
 * The five points, in order — two offline, three live:
 *   1. url-shape            contract `tenant.url_pattern` (https + *.supabase.co)
 *   2. key-publishable      never service_role / sb_secret_ / a secret-shaped JWT
 *   3. rest-reachable       GET  {url}/rest/v1/            → the project answers
 *   4. schema-version       POST {url}/rest/v1/rpc/app_schema_version → == 21
 *   5. anon-clinical-denied GET  {url}/rest/v1/patients    → refused or 0 rows
 *
 * Points 3–5 use nothing but the clinic's publishable key, exactly like the
 * browser client will: if the check passes with that key, the client works with
 * that key. Pure logic and injected `fetchImpl` throughout, so the whole ladder
 * is unit-testable offline.
 */

import {
  assertPublishableAnonKey,
  buildCentralPostgrestHeaders,
} from './auto-sync-client.mjs';
import {
  DIRECTORY_CONTRACT_VERSION,
  FORBIDDEN_TENANT_KEY_PATTERN,
  KEEP_WARM,
  OPD_CLINIC_ENV_VARS,
  OPD_FORBIDDEN_ENV_PATTERN,
  OPD_PAGES,
  OPD_STORAGE_KEYS,
  TENANT_CLINICAL_PROBE_TABLE,
  TENANT_REST_ROOT,
  TENANT_SCHEMA_VERSION,
  TENANT_SUPABASE_URL_PATTERN,
  TENANT_VERSION_PROBE,
  WORKSPACE_SLUG_PATTERN,
} from './workspace-directory.mjs';

export const TENANT_URL_SHAPE = new RegExp(TENANT_SUPABASE_URL_PATTERN, 'i');
export const TENANT_SLUG_SHAPE = new RegExp(WORKSPACE_SLUG_PATTERN);
export const TENANT_KEY_BLOCKED = new RegExp(FORBIDDEN_TENANT_KEY_PATTERN, 'i');
export const FORBIDDEN_ENV_SHAPE = new RegExp(OPD_FORBIDDEN_ENV_PATTERN, 'i');

export const CLINIC_NAME_MIN = 2;
export const CLINIC_NAME_MAX = 120;

/** Suffix used when a clinic name is too short to satisfy the slug pattern. */
const SLUG_MIN_LENGTH = 3;
const SLUG_MAX_LENGTH = 40;
const SHORT_SLUG_SUFFIX = 'opd';

/**
 * The five checks, in the order they run. `live` marks the ones that need the
 * network, so the UI can say "2 of 5 need the clinic's project online".
 */
export const TENANT_CONNECTION_CHECKS = Object.freeze(
  [
    { id: 'url-shape', label: 'Tenant URL shape', live: false },
    { id: 'key-publishable', label: 'Publishable key only', live: false },
    { id: 'rest-reachable', label: 'Tenant REST answers this key', live: true },
    {
      id: 'schema-version',
      label: `Tenant schema v${TENANT_SCHEMA_VERSION}`,
      live: true,
    },
    { id: 'anon-clinical-denied', label: 'Anon clinical read refused', live: true },
  ].map((check) => Object.freeze({ ...check })),
);

const LIVE_CHECK_IDS = Object.freeze(
  TENANT_CONNECTION_CHECKS.filter((c) => c.live).map((c) => c.id),
);

function check(id, state, detail) {
  const meta = TENANT_CONNECTION_CHECKS.find((c) => c.id === id);
  return {
    id,
    label: meta ? meta.label : id,
    state,
    detail,
    live: Boolean(meta?.live),
  };
}

/**
 * `Sharma OPD Clinic` → `sharma-opd-clinic`.
 *
 * The contract slug pattern is `^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$`: 3–40 chars,
 * no leading or trailing hyphen. Returns '' when the name has no alphanumeric
 * content at all, which validation then reports as a real error.
 */
export function slugifyClinicName(name) {
  const base = String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!base) return '';
  let slug = base.slice(0, SLUG_MAX_LENGTH).replace(/-+$/g, '');
  if (slug.length < SLUG_MIN_LENGTH) {
    slug = `${slug}-${SHORT_SLUG_SUFFIX}`.slice(0, SLUG_MAX_LENGTH);
  }
  return TENANT_SLUG_SHAPE.test(slug) ? slug : '';
}

export function normalizeTenantUrl(rawUrl) {
  return String(rawUrl ?? '')
    .trim()
    .replace(/\/+$/, '');
}

/** Show a key as `sb_publishable_ab…wxyz` — the console never prints it whole. */
export function maskTenantKey(rawKey) {
  const key = String(rawKey ?? '').trim();
  if (!key) return '';
  if (key.length <= 12) return `${key.slice(0, 2)}…`;
  return `${key.slice(0, 10)}…${key.slice(-4)}`;
}

export function urlShapeCheck(rawUrl) {
  const url = String(rawUrl ?? '').trim();
  if (!url) {
    return check('url-shape', 'fail', 'Paste the clinic project URL from Supabase → Project Settings → API.');
  }
  if (!/^https:\/\//i.test(url)) {
    return check('url-shape', 'fail', 'Use the https:// project URL — http:// is refused by the directory CHECK constraint.');
  }
  if (!TENANT_URL_SHAPE.test(url)) {
    return check(
      'url-shape',
      'fail',
      'Expected https://<project-ref>.supabase.co. A custom domain or a proxy URL cannot be verified as this clinic\'s project.',
    );
  }
  return check('url-shape', 'pass', `${normalizeTenantUrl(url)} matches the contract URL shape.`);
}

export function keyPublishableCheck(rawKey) {
  const key = String(rawKey ?? '').trim();
  if (!key) {
    return check('key-publishable', 'fail', 'Paste the publishable (anon) key — never the secret key.');
  }
  if (TENANT_KEY_BLOCKED.test(key)) {
    return check(
      'key-publishable',
      'fail',
      'SECURITY BLOCK: this looks like a secret key. Central stores only publishable keys, and the directory CHECK constraint rejects this value.',
    );
  }
  try {
    assertPublishableAnonKey(key);
  } catch (err) {
    return check('key-publishable', 'fail', err?.message ?? 'Key rejected.');
  }
  return check(
    'key-publishable',
    'pass',
    `Publishable key accepted (${key.length} chars, stored as ${maskTenantKey(key)}).`,
  );
}

export function restReachableCheck({ ok, status, message } = {}) {
  if (ok) {
    return check(
      'rest-reachable',
      'pass',
      `PostgREST answered${status ? ` (HTTP ${status})` : ''} with the clinic's publishable key.`,
    );
  }
  const text = String(message ?? '');
  if (status === 401 || status === 403) {
    return check('rest-reachable', 'fail', 'Project reachable but the key was rejected — copy the anon / publishable key again from Project Settings → API.');
  }
  if (status === 404) {
    return check('rest-reachable', 'fail', 'REST root not found at that URL — check the project reference.');
  }
  if (/abort|timeout/i.test(text)) {
    return check('rest-reachable', 'fail', 'Timed out. The project may be paused (free tier pauses after 7 idle days) or the browser blocked the cross-origin probe.');
  }
  return check(
    'rest-reachable',
    'fail',
    `Tenant REST probe failed${status ? ` (HTTP ${status})` : ''}${text ? `: ${text}` : ''}.`,
  );
}

export function tenantSchemaCheck(serverVersion, expected = TENANT_SCHEMA_VERSION) {
  const want = Number(expected);
  if (serverVersion === null || serverVersion === undefined || Number.isNaN(Number(serverVersion))) {
    return check(
      'schema-version',
      'fail',
      `${TENANT_VERSION_PROBE.rpc}() did not answer with a version. The clinic must run its supabase/schema.sql (v${want}) first.`,
    );
  }
  const got = Number(serverVersion);
  if (got === want) {
    return check('schema-version', 'pass', `Tenant reports schema v${want} — matches the contract.`);
  }
  return check(
    'schema-version',
    'fail',
    got < want
      ? `Tenant is schema v${got}; this contract needs v${want}. Re-run the clinic's supabase/schema.sql.`
      : `Tenant is schema v${got} but the contract pins v${want}. Update Central's contract before linking this clinic.`,
  );
}

/**
 * The point that actually matters: with the publishable key in hand, an anon
 * caller must NOT be able to read clinical rows. Refused (401/403) is the ideal
 * answer; RLS filtering to zero rows is acceptable; a returned row is a leak.
 */
export function anonClinicalReadCheck({ status, rowCount, message } = {}) {
  const table = TENANT_CLINICAL_PROBE_TABLE;
  if (status === 401 || status === 403) {
    return check('anon-clinical-denied', 'pass', `anon cannot read ${table} (HTTP ${status}) — tenant RLS holds.`);
  }
  if (Number.isFinite(Number(rowCount))) {
    const rows = Number(rowCount);
    if (rows === 0) {
      return check('anon-clinical-denied', 'pass', `anon read of ${table} returned 0 rows — RLS filters it empty.`);
    }
    return check(
      'anon-clinical-denied',
      'fail',
      `LEAK: anon read ${rows} row(s) from ${table} with the publishable key. Do NOT link this clinic until its RLS is forced.`,
    );
  }
  if (status === 404) {
    return check('anon-clinical-denied', 'warn', `${table} not found — the tenant schema may not be applied yet; re-run the check after setup.`);
  }
  return check(
    'anon-clinical-denied',
    'warn',
    `Could not prove anon is refused on ${table}${status ? ` (HTTP ${status})` : ''}${message ? `: ${message}` : ''}.`,
  );
}

function skipLiveChecks(checks, reason) {
  for (const id of LIVE_CHECK_IDS) {
    if (!checks.some((c) => c.id === id)) {
      checks.push(check(id, 'skip', reason));
    }
  }
  return checks;
}

/**
 * Run the ladder. Stops early and marks the rest `skip` — a bad URL shape says
 * nothing about the tenant's RLS, and firing three doomed requests at a
 * mistyped host is just noise (and rate-limit burn).
 */
export async function runTenantConnectionChecks({
  supabaseUrl,
  supabaseAnonKey,
  expectedSchemaVersion = TENANT_SCHEMA_VERSION,
  clinicalTable = TENANT_CLINICAL_PROBE_TABLE,
  fetchImpl = globalThis.fetch,
  timeoutMs = 12000,
} = {}) {
  const checks = [];
  checks.push(urlShapeCheck(supabaseUrl));
  checks.push(keyPublishableCheck(supabaseAnonKey));
  if (checks.some((c) => c.state === 'fail')) {
    return skipLiveChecks(checks, 'Fix the offline checks first — nothing was sent to the tenant project.');
  }

  const base = normalizeTenantUrl(supabaseUrl);
  const headers = buildCentralPostgrestHeaders(supabaseAnonKey);

  const probe = async (path, init = {}) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${base}${path}`, {
        ...init,
        headers: { ...headers, ...(init.headers ?? {}) },
        signal: controller.signal,
      });
      const text = await res.text().catch(() => '');
      return { res, text, status: res.status };
    } catch (err) {
      return { res: null, text: '', status: 0, message: err?.message ?? String(err) };
    } finally {
      clearTimeout(timer);
    }
  };

  // 3 — REST reachable
  const root = await probe(TENANT_REST_ROOT);
  checks.push(
    restReachableCheck({
      ok: Boolean(root.res) && root.status >= 200 && root.status < 500,
      status: root.status,
      message: root.message,
    }),
  );
  if (!root.res || root.status < 200 || root.status >= 500) {
    return skipLiveChecks(checks, 'Skipped: the tenant REST endpoint did not answer.');
  }

  // 4 — schema version through the probe the contract pins
  const version = await probe(TENANT_VERSION_PROBE.path, {
    method: TENANT_VERSION_PROBE.method,
    body: '{}',
  });
  let serverVersion = null;
  if (version.res?.ok) {
    const parsed = (() => {
      try {
        return JSON.parse(version.text);
      } catch {
        return null;
      }
    })();
    serverVersion = Array.isArray(parsed) ? parsed[0] : parsed;
  }
  checks.push(tenantSchemaCheck(serverVersion, expectedSchemaVersion));

  // 5 — anon clinical read must be refused
  const clinical = await probe(
    `${TENANT_REST_ROOT}${clinicalTable}?select=id&limit=1`,
  );
  let rowCount = null;
  if (clinical.res?.ok) {
    try {
      const parsed = JSON.parse(clinical.text);
      if (Array.isArray(parsed)) rowCount = parsed.length;
    } catch {
      rowCount = null;
    }
  }
  checks.push(
    anonClinicalReadCheck({
      status: clinical.status,
      rowCount,
      message: clinical.message,
    }),
  );

  return checks;
}

/**
 * One headline over the ladder, in myClinic's readiness vocabulary. `linkable`
 * is the bit the wizard gates on: no failures, and every live check actually
 * ran (a skipped probe is not a passed probe).
 */
export function connectionReadiness(checks) {
  const list = (checks ?? []).filter(Boolean);
  const scored = list.filter((c) => c.state !== 'skip');
  const failed = scored.filter((c) => c.state === 'fail').length;
  const warned = scored.filter((c) => c.state === 'warn').length;
  const passed = scored.filter((c) => c.state === 'pass').length;
  const skipped = list.length - scored.length;
  const liveRun = list.filter((c) => c.live && c.state !== 'skip').length;
  const state = failed ? 'fail' : warned ? 'warn' : scored.length ? 'pass' : 'unknown';
  const headline =
    state === 'fail'
      ? `${failed} of ${scored.length} connection checks failed`
      : state === 'warn'
        ? `Reachable — ${warned} check${warned === 1 ? '' : 's'} to confirm`
        : state === 'pass'
          ? 'Tenant connection verified'
          : 'Nothing checked yet';
  return {
    state,
    passed,
    warned,
    failed,
    skipped,
    total: list.length,
    liveRun,
    linkable: state === 'pass' && skipped === 0 && liveRun === LIVE_CHECK_IDS.length,
    headline,
  };
}

/**
 * Offline gate for the wizard's Connection step. `requireEndpoint: false` lets
 * an operator onboard a clinic that has no Supabase project yet — the licence
 * works, the workspace pointer simply stays dark (P1b semantics).
 */
export function validateWorkspaceConnection({
  clinicName = '',
  slug = '',
  supabaseUrl = '',
  supabaseAnonKey = '',
  requireEndpoint = true,
} = {}) {
  const name = String(clinicName ?? '').trim();
  const cleanSlug = String(slug ?? '').trim().toLowerCase();
  const url = normalizeTenantUrl(supabaseUrl);
  const key = String(supabaseAnonKey ?? '').trim();

  const nothingTyped = !name && !cleanSlug && !url && !key;
  if (nothingTyped) {
    return {
      ok: true,
      skipped: true,
      value: null,
      error: null,
    };
  }

  const fail = (field, message, hint) => ({
    ok: false,
    skipped: false,
    value: null,
    error: { field, message, hint },
  });

  if (name.length < CLINIC_NAME_MIN || name.length > CLINIC_NAME_MAX) {
    return fail(
      'clinicName',
      `Clinic name must be ${CLINIC_NAME_MIN}–${CLINIC_NAME_MAX} characters.`,
      'This is the label the clinic sees in its own console.',
    );
  }

  const effectiveSlug = cleanSlug || slugifyClinicName(name);
  if (!TENANT_SLUG_SHAPE.test(effectiveSlug)) {
    return fail(
      'slug',
      'Tenant slug must be 3–40 characters: lowercase letters, digits and single hyphens, not starting or ending with a hyphen.',
      `Try "${slugifyClinicName(name) || 'clinic-name'}" — the slug becomes the tenant_slug claim and the offline storage namespace.`,
    );
  }

  if (!url || !key) {
    if (!requireEndpoint) {
      return {
        ok: true,
        skipped: true,
        value: null,
        error: null,
      };
    }
    return fail(
      'supabaseUrl',
      'Both the tenant project URL and its publishable key are needed to link a workspace.',
      'Leave all four fields empty to onboard without a tenant project — the licence still works.',
    );
  }

  const urlCheck = urlShapeCheck(url);
  if (urlCheck.state !== 'pass') {
    return fail('supabaseUrl', urlCheck.detail, 'Supabase → Project Settings → API → Project URL.');
  }

  const keyCheck = keyPublishableCheck(key);
  if (keyCheck.state !== 'pass') {
    return fail('supabaseAnonKey', keyCheck.detail, 'Copy the anon / publishable key, never the secret key.');
  }

  return {
    ok: true,
    skipped: false,
    value: {
      clinic_name: name,
      slug: effectiveSlug,
      supabase_url: url,
      supabase_anon_key: key,
    },
    error: null,
  };
}

/**
 * Write the verified handover into the directory and point the subscription at
 * it (schema v5 tables, v6 keep-warm stamp).
 *
 * Two deliberate choices:
 *   * select-then-write instead of `upsert(..., { onConflict: 'slug' })` — the
 *     uniqueness is an EXPRESSION index on `lower(slug)`, which PostgREST's
 *     on_conflict cannot target;
 *   * `is_active` is the caller's verdict, and the pointer only goes live when
 *     the 5-point check passed (P1b: a dark workspace is a withdrawn pointer,
 *     not a broken licence).
 *
 * Best-effort by contract: the subscription is already created when this runs,
 * so every failure is reported to the caller as a warning rather than thrown
 * away — except the workspace write itself, which the wizard surfaces.
 */
export async function persistWorkspaceConnection(
  supabase,
  {
    value,
    subscriptionId = null,
    tenantSchemaVersion = 0,
    isActive = false,
    stampKeepWarm = false,
  } = {},
) {
  const warnings = [];
  if (!supabase) throw new Error('Central connection is unavailable.');
  const gate = validateWorkspaceConnection({
    clinicName: value?.clinic_name,
    slug: value?.slug,
    supabaseUrl: value?.supabase_url,
    supabaseAnonKey: value?.supabase_anon_key,
  });
  if (!gate.ok || gate.skipped) {
    throw new Error(gate.error?.message ?? 'Nothing to link: the connection step was skipped.');
  }

  const row = buildWorkspaceRow({
    clinicName: gate.value.clinic_name,
    slug: gate.value.slug,
    supabaseUrl: gate.value.supabase_url,
    supabaseAnonKey: gate.value.supabase_anon_key,
    tenantSchemaVersion,
    isActive,
  });

  const found = await supabase
    .from('workspaces')
    .select('id')
    .eq('slug', row.slug)
    .maybeSingle();
  if (found.error) throw found.error;

  const selecting = 'id, clinic_name, slug, supabase_url, is_active, tenant_schema_version, keep_warm_at';
  let saved;
  if (found.data?.id) {
    const updated = await supabase
      .from('workspaces')
      .update(row)
      .eq('id', found.data.id)
      .select(selecting)
      .single();
    if (updated.error) throw updated.error;
    saved = updated.data;
  } else {
    const inserted = await supabase
      .from('workspaces')
      .insert(row)
      .select(selecting)
      .single();
    if (inserted.error) throw inserted.error;
    saved = inserted.data;
  }

  let linked = false;
  if (subscriptionId) {
    const link = await supabase
      .from('subscriptions')
      .update({ workspace_id: saved.id })
      .eq('id', subscriptionId);
    if (link.error) {
      warnings.push(`Workspace saved, but the subscription could not be linked: ${link.error.message ?? link.error}`);
    } else {
      linked = true;
    }
  }

  // The wizard just probed this project, so it is warm right now: start its
  // keep-warm clock immediately instead of leaving it "never probed".
  let stamped = false;
  if (stampKeepWarm && saved.id) {
    const stamp = await supabase.rpc('stamp_keep_warm', {
      p_workspace: saved.id,
      p_ok: true,
    });
    if (stamp.error) {
      warnings.push(`Workspace linked, but the keep-warm stamp failed: ${stamp.error.message ?? stamp.error}`);
    } else {
      stamped = true;
    }
  }

  return { id: saved.id, workspace: saved, linked, stamped, warnings };
}

/** The `public.workspaces` insert/update payload, in database column names. */
export function buildWorkspaceRow({
  clinicName,
  slug,
  supabaseUrl,
  supabaseAnonKey,
  tenantSchemaVersion = 0,
  isActive = false,
  keepWarmAt = null,
} = {}) {
  return {
    clinic_name: String(clinicName ?? '').trim(),
    slug: String(slug ?? '').trim().toLowerCase(),
    supabase_url: normalizeTenantUrl(supabaseUrl) || null,
    supabase_anon_key: String(supabaseAnonKey ?? '').trim() || null,
    tenant_schema_version: Number(tenantSchemaVersion) || 0,
    is_active: Boolean(isActive),
    keep_warm_at: keepWarmAt ?? null,
  };
}

/**
 * E4 — the one artifact a clinic needs to finish its side, copyable in one
 * click. Note what it deliberately does NOT contain: no `VITE_*TENANT*`
 * variable. The tenant URL and key arrive at runtime through the workspace
 * pointer on `sync_clinic_subscription` (D4′/F1), because the clinic app is one
 * build serving every clinic. The contract's forbidden-env pattern is asserted
 * against the finished text, so a future edit cannot quietly reintroduce it.
 */
export function buildTenantConnectionKit({
  centralUrl = '',
  centralAnonKey = '',
  workspace = null,
  expectedSchemaVersion = TENANT_SCHEMA_VERSION,
} = {}) {
  const central = normalizeTenantUrl(centralUrl) || 'https://YOUR_CENTRAL_PROJECT_REF.supabase.co';
  const centralKey = String(centralAnonKey ?? '').trim() || 'sb_publishable_YOUR_CENTRAL_ANON_KEY';

  const pointer = workspace
    ? {
        clinic_name: workspace.clinic_name ?? workspace.clinicName ?? '',
        slug: workspace.slug ?? '',
        supabase_url: normalizeTenantUrl(workspace.supabase_url ?? workspace.supabaseUrl),
        supabase_anon_key: workspace.supabase_anon_key ?? workspace.supabaseAnonKey ?? '',
        tenant_schema_version: Number(
          workspace.tenant_schema_version ?? workspace.tenantSchemaVersion ?? expectedSchemaVersion,
        ),
        is_active: Boolean(workspace.is_active ?? workspace.isActive ?? false),
      }
    : null;

  const [centralUrlVar, centralKeyVar] = OPD_CLINIC_ENV_VARS;
  const envVars = [
    `${centralUrlVar}="${central}"`,
    `${centralKeyVar}="${centralKey}"`,
  ].join('\n');

  const tenantSql = `-- Run in the CLINIC's own Supabase project (SQL Editor).
-- 1. Prove the version Central's Connection step will read with the publishable key:
select public.${TENANT_VERSION_PROBE.rpc}() as tenant_schema_version;  -- must be ${expectedSchemaVersion}

-- 2. Prove anon cannot read clinical rows (must raise permission denied):
set local role anon;
select id from public.${TENANT_CLINICAL_PROBE_TABLE} limit 1;
reset role;

-- 3. Free tier pauses a project after ${KEEP_WARM.pause_days} idle days. Central's pg_cron keep-warm
--    job touches ${TENANT_REST_ROOT} on every ACTIVE workspace, so keep is_active = true
--    in the Central directory and hand over the publishable key at onboarding.`;

  const kit = {
    kit: 'tenant-connection',
    contract_version: DIRECTORY_CONTRACT_VERSION,
    tenant_schema_version: expectedSchemaVersion,
    central: {
      pages: { ...OPD_PAGES },
      env: {
        [centralUrlVar]: central,
        [centralKeyVar]: centralKey,
      },
      anon_rpc: 'sync_clinic_subscription',
    },
    workspace: pointer,
    tenant_probe: { ...TENANT_VERSION_PROBE, clinical_table: TENANT_CLINICAL_PROBE_TABLE },
    storage_keys: { ...OPD_STORAGE_KEYS },
  };

  const json = JSON.stringify(kit, null, 2);

  const text = [
    `# myClinic tenant connection kit — ${pointer ? pointer.clinic_name : 'clinic'}${pointer ? ` (${pointer.slug})` : ''}`,
    '',
    '## 1. Clinic app build variables (the ONLY two env vars; tenant values arrive at runtime)',
    envVars,
    '',
    '## 2. Tenant project verification SQL (run in the clinic\u2019s own Supabase)',
    tenantSql,
    '',
    '## 3. What Central stores for this workspace',
    pointer
      ? JSON.stringify(
          {
            ...pointer,
            supabase_anon_key: maskTenantKey(pointer.supabase_anon_key),
          },
          null,
          2,
        )
      : '(no workspace linked yet — fill the Connection step in Clinics & Plans → Add Clinic)',
    '',
    '## 4. Machine-readable kit',
    json,
    '',
  ].join('\n');

  // Self-check: the kit must never teach anyone to bake a tenant endpoint into
  // a build variable. Two rules, both from the contract:
  //   1. nothing may match `env.forbidden_env_pattern`;
  //   2. every assignment-shaped VITE_* line must be one of `env.clinic_app`.
  // Fails loudly here rather than shipping a leaked pattern.
  const lines = text.split('\n');
  const forbidden = lines.filter((line) => FORBIDDEN_ENV_SHAPE.test(line));
  const unlisted = lines
    .map((line) => /^\s*(VITE_[A-Z0-9_]+)\s*=/.exec(line)?.[1])
    .filter((name) => name && !OPD_CLINIC_ENV_VARS.includes(name));
  const offenders = [...forbidden, ...unlisted];
  if (offenders.length) {
    throw new Error(
      `Tenant connection kit would emit a forbidden build variable: ${offenders.join(' | ')}`,
    );
  }

  return {
    title: pointer ? `Tenant connection kit — ${pointer.clinic_name}` : 'Tenant connection kit',
    summary: pointer
      ? `${pointer.slug} · tenant schema v${pointer.tenant_schema_version} · ${pointer.is_active ? 'active' : 'inactive (pointer withheld)'}`
      : `Template · tenant schema v${expectedSchemaVersion}`,
    envVars,
    tenantSql,
    json,
    text,
  };
}
