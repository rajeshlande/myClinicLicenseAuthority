import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import {
  CLINIC_NAME_MAX,
  FORBIDDEN_ENV_SHAPE,
  TENANT_CONNECTION_CHECKS,
  anonClinicalReadCheck,
  buildTenantConnectionKit,
  buildWorkspaceRow,
  connectionReadiness,
  keyPublishableCheck,
  maskTenantKey,
  normalizeTenantUrl,
  persistWorkspaceConnection,
  restReachableCheck,
  runTenantConnectionChecks,
  slugifyClinicName,
  tenantSchemaCheck,
  urlShapeCheck,
  validateWorkspaceConnection,
} from '../src/lib/tenant-connection.mjs';
import {
  OPD_CLINIC_ENV_VARS,
  TENANT_CLINICAL_PROBE_TABLE,
  TENANT_SCHEMA_VERSION,
  TENANT_VERSION_PROBE,
} from '../src/lib/workspace-directory.mjs';

const TENANT_URL = 'https://sunriseopd.supabase.co';
const TENANT_KEY = 'sb_publishable_sunrise_0001';

function response(status, body = '') {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

/** Route table → recording fetch, so the ladder is provable offline. */
function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({
      url,
      method: init.method ?? 'GET',
      headers: { ...(init.headers ?? {}) },
      body: init.body ?? null,
    });
    for (const [pattern, make] of routes) {
      const hit =
        typeof pattern === 'string' ? url.includes(pattern) : pattern.test(url);
      if (hit) return make(url, init);
    }
    return response(404, { message: 'not found' });
  };
  return { impl, calls };
}

const HAPPY_ROUTES = [
  [/\/rest\/v1\/rpc\/app_schema_version$/, () => response(200, String(TENANT_SCHEMA_VERSION))],
  [/\/rest\/v1\/patients\?/, () => response(401, { message: 'permission denied for table patients' })],
  [/\/rest\/v1\/$/, () => response(200, { definitions: {} })],
];

test('slugifyClinicName produces contract-shaped slugs', () => {
  assert.equal(slugifyClinicName('Sharma OPD Clinic'), 'sharma-opd-clinic');
  assert.equal(slugifyClinicName('  Dr. Meera\'s Child Care  '), 'dr-meera-s-child-care');
  assert.equal(slugifyClinicName('A'), 'a-opd', 'short names get a suffix, not a rejection');
  assert.equal(slugifyClinicName('ab'), 'ab-opd');
  assert.equal(slugifyClinicName('---'), '');
  assert.equal(slugifyClinicName(''), '');
  // 40-char ceiling from ^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$
  const long = slugifyClinicName('x'.repeat(80));
  assert.equal(long.length, 40);
  for (const slug of ['sharma-opd-clinic', 'a-opd', long]) {
    assert.match(slug, /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/);
  }
});

test('validateWorkspaceConnection accepts a clean handover', () => {
  const res = validateWorkspaceConnection({
    clinicName: 'Sunrise OPD',
    slug: 'sunrise-opd',
    supabaseUrl: `${TENANT_URL}/`,
    supabaseAnonKey: TENANT_KEY,
  });
  assert.equal(res.ok, true);
  assert.equal(res.skipped, false);
  assert.deepEqual(res.value, {
    clinic_name: 'Sunrise OPD',
    slug: 'sunrise-opd',
    supabase_url: TENANT_URL,
    supabase_anon_key: TENANT_KEY,
  });
});

test('validateWorkspaceConnection derives the slug when none is typed', () => {
  const res = validateWorkspaceConnection({
    clinicName: 'Sunrise OPD',
    supabaseUrl: TENANT_URL,
    supabaseAnonKey: TENANT_KEY,
  });
  assert.equal(res.ok, true);
  assert.equal(res.value.slug, 'sunrise-opd');
});

test('validateWorkspaceConnection refuses every bad shape with a field + hint', () => {
  const cases = [
    [{ clinicName: 'S', supabaseUrl: TENANT_URL, supabaseAnonKey: TENANT_KEY }, 'clinicName'],
    [
      { clinicName: 'x'.repeat(CLINIC_NAME_MAX + 1), supabaseUrl: TENANT_URL, supabaseAnonKey: TENANT_KEY },
      'clinicName',
    ],
    [{ clinicName: 'Sunrise OPD', slug: '-bad', supabaseUrl: TENANT_URL, supabaseAnonKey: TENANT_KEY }, 'slug'],
    [{ clinicName: 'Sunrise OPD', slug: 'a'.repeat(41), supabaseUrl: TENANT_URL, supabaseAnonKey: TENANT_KEY }, 'slug'],
    [{ clinicName: 'Sunrise OPD', slug: 'sunrise-opd', supabaseUrl: 'http://sunriseopd.supabase.co', supabaseAnonKey: TENANT_KEY }, 'supabaseUrl'],
    [{ clinicName: 'Sunrise OPD', slug: 'sunrise-opd', supabaseUrl: 'https://clinic.example.com', supabaseAnonKey: TENANT_KEY }, 'supabaseUrl'],
    [{ clinicName: 'Sunrise OPD', slug: 'sunrise-opd', supabaseUrl: TENANT_URL, supabaseAnonKey: '' }, 'supabaseUrl'],
    [{ clinicName: 'Sunrise OPD', slug: 'sunrise-opd', supabaseUrl: TENANT_URL, supabaseAnonKey: 'sb_secret_oh_no' }, 'supabaseAnonKey'],
  ];
  for (const [input, field] of cases) {
    const res = validateWorkspaceConnection(input);
    assert.equal(res.ok, false, `${field}: expected refusal for ${JSON.stringify(input)}`);
    assert.equal(res.error.field, field);
    assert.ok(res.error.message.length > 10);
    assert.ok(res.error.hint.length > 10);
  }
});

test('the Connection step is skippable: a clinic without a project still onboards', () => {
  assert.equal(validateWorkspaceConnection({}).skipped, true, 'all four fields empty');
  assert.equal(validateWorkspaceConnection({ clinicName: '' }).ok, true);
  const partial = validateWorkspaceConnection({
    clinicName: 'Sunrise OPD',
    slug: 'sunrise-opd',
    requireEndpoint: false,
  });
  assert.equal(partial.ok, true);
  assert.equal(partial.skipped, true, 'a name alone is not a connection');
  const forced = validateWorkspaceConnection({
    clinicName: 'Sunrise OPD',
    slug: 'sunrise-opd',
  });
  assert.equal(forced.ok, false);
  assert.equal(forced.error.field, 'supabaseUrl');
});

test('the offline checks name the contract, not a hardcoded pattern', () => {
  assert.equal(urlShapeCheck(TENANT_URL).state, 'pass');
  assert.equal(urlShapeCheck('').state, 'fail');
  assert.equal(urlShapeCheck('https://x.example.com').state, 'fail');
  assert.equal(keyPublishableCheck(TENANT_KEY).state, 'pass');
  assert.equal(keyPublishableCheck('sb_secret_x').state, 'fail');
  assert.match(keyPublishableCheck('sb_secret_x').detail, /SECURITY BLOCK/);
  assert.equal(keyPublishableCheck('').state, 'fail');
  assert.equal(normalizeTenantUrl(`${TENANT_URL}//`), TENANT_URL);
  assert.equal(maskTenantKey(TENANT_KEY), 'sb_publish…0001');
  assert.equal(maskTenantKey('short'), 'sh…');
  assert.equal(maskTenantKey(''), '');
});

test('the ladder is five named checks, two offline and three live', () => {
  assert.equal(TENANT_CONNECTION_CHECKS.length, 5);
  assert.deepEqual(
    TENANT_CONNECTION_CHECKS.map((c) => c.id),
    ['url-shape', 'key-publishable', 'rest-reachable', 'schema-version', 'anon-clinical-denied'],
  );
  assert.deepEqual(
    TENANT_CONNECTION_CHECKS.filter((c) => c.live).map((c) => c.id),
    ['rest-reachable', 'schema-version', 'anon-clinical-denied'],
  );
  assert.ok(Object.isFrozen(TENANT_CONNECTION_CHECKS));
});

test('runTenantConnectionChecks: a healthy tenant passes all five', async () => {
  const { impl, calls } = fakeFetch(HAPPY_ROUTES);
  const checks = await runTenantConnectionChecks({
    supabaseUrl: TENANT_URL,
    supabaseAnonKey: TENANT_KEY,
    fetchImpl: impl,
  });
  assert.deepEqual(
    checks.map((c) => [c.id, c.state]),
    [
      ['url-shape', 'pass'],
      ['key-publishable', 'pass'],
      ['rest-reachable', 'pass'],
      ['schema-version', 'pass'],
      ['anon-clinical-denied', 'pass'],
    ],
  );
  const readiness = connectionReadiness(checks);
  assert.equal(readiness.linkable, true);
  assert.equal(readiness.headline, 'Tenant connection verified');

  // Exactly three requests, all at the TENANT project, all with the tenant key.
  assert.equal(calls.length, 3);
  for (const call of calls) {
    assert.ok(call.url.startsWith(TENANT_URL), `unexpected host: ${call.url}`);
    assert.equal(call.headers.apikey, TENANT_KEY);
  }
  assert.deepEqual(calls.map((c) => c.url), [
    `${TENANT_URL}/rest/v1/`,
    `${TENANT_URL}${TENANT_VERSION_PROBE.path}`,
    `${TENANT_URL}/rest/v1/${TENANT_CLINICAL_PROBE_TABLE}?select=id&limit=1`,
  ]);
  assert.equal(calls[1].method, TENANT_VERSION_PROBE.method);
});

test('runTenantConnectionChecks: a bad URL shape sends nothing at all', async () => {
  const { impl, calls } = fakeFetch(HAPPY_ROUTES);
  const checks = await runTenantConnectionChecks({
    supabaseUrl: 'https://clinic.example.com',
    supabaseAnonKey: TENANT_KEY,
    fetchImpl: impl,
  });
  assert.equal(calls.length, 0, 'no request may leave the browser for an invalid host');
  assert.deepEqual(
    checks.map((c) => [c.id, c.state]),
    [
      ['url-shape', 'fail'],
      ['key-publishable', 'pass'],
      ['rest-reachable', 'skip'],
      ['schema-version', 'skip'],
      ['anon-clinical-denied', 'skip'],
    ],
  );
  const readiness = connectionReadiness(checks);
  assert.equal(readiness.linkable, false);
  assert.equal(readiness.failed, 1);
  assert.equal(readiness.skipped, 3);
});

test('runTenantConnectionChecks: a secret key is refused before any probe', async () => {
  const { impl, calls } = fakeFetch(HAPPY_ROUTES);
  const checks = await runTenantConnectionChecks({
    supabaseUrl: TENANT_URL,
    supabaseAnonKey: 'sb_secret_do_not_store',
    fetchImpl: impl,
  });
  assert.equal(calls.length, 0);
  assert.equal(checks[1].state, 'fail');
  assert.match(checks[1].detail, /SECURITY BLOCK/);
});

test('runTenantConnectionChecks: a behind-schema tenant is not linkable', async () => {
  const { impl } = fakeFetch([
    [/rpc\/app_schema_version$/, () => response(200, '20')],
    [/\/rest\/v1\/patients\?/, () => response(401, {})],
    [/\/rest\/v1\/$/, () => response(200, '{}')],
  ]);
  const checks = await runTenantConnectionChecks({
    supabaseUrl: TENANT_URL,
    supabaseAnonKey: TENANT_KEY,
    fetchImpl: impl,
  });
  const schema = checks.find((c) => c.id === 'schema-version');
  assert.equal(schema.state, 'fail');
  assert.match(schema.detail, /schema v20/);
  assert.match(schema.detail, new RegExp(`v${TENANT_SCHEMA_VERSION}`));
  assert.equal(connectionReadiness(checks).linkable, false);
});

test('runTenantConnectionChecks: an unreachable REST root skips the deep probes', async () => {
  const { impl, calls } = fakeFetch([[/\/rest\/v1\/$/, () => response(540, '')]]);
  const checks = await runTenantConnectionChecks({
    supabaseUrl: TENANT_URL,
    supabaseAnonKey: TENANT_KEY,
    fetchImpl: impl,
  });
  assert.equal(calls.length, 1);
  assert.equal(checks[2].state, 'fail');
  assert.equal(checks[3].state, 'skip');
  assert.equal(checks[4].state, 'skip');
});

test('runTenantConnectionChecks: a network failure is reported, not thrown', async () => {
  const { impl } = fakeFetch([
    [/\/rest\/v1\/$/, () => { throw new Error('Failed to fetch'); }],
  ]);
  const checks = await runTenantConnectionChecks({
    supabaseUrl: TENANT_URL,
    supabaseAnonKey: TENANT_KEY,
    fetchImpl: impl,
  });
  assert.equal(checks[2].state, 'fail');
  assert.match(checks[2].detail, /Failed to fetch/);
});

test('anon clinical read: refused, filtered-empty and leaked are three different verdicts', async () => {
  assert.equal(anonClinicalReadCheck({ status: 401 }).state, 'pass');
  assert.equal(anonClinicalReadCheck({ status: 403 }).state, 'pass');
  assert.equal(anonClinicalReadCheck({ status: 200, rowCount: 0 }).state, 'pass');
  const leak = anonClinicalReadCheck({ status: 200, rowCount: 1 });
  assert.equal(leak.state, 'fail');
  assert.match(leak.detail, /LEAK/);
  assert.equal(anonClinicalReadCheck({ status: 404 }).state, 'warn');

  const leaky = fakeFetch([
    [/rpc\/app_schema_version$/, () => response(200, String(TENANT_SCHEMA_VERSION))],
    [/\/rest\/v1\/patients\?/, () => response(200, [{ id: 'p1' }])],
    [/\/rest\/v1\/$/, () => response(200, '{}')],
  ]);
  const checks = await runTenantConnectionChecks({
    supabaseUrl: TENANT_URL,
    supabaseAnonKey: TENANT_KEY,
    fetchImpl: leaky.impl,
  });
  assert.equal(checks[4].state, 'fail');
  assert.equal(connectionReadiness(checks).linkable, false);
});

test('RLS filtering to zero rows is a pass, not a warning', async () => {
  const { impl } = fakeFetch([
    [/rpc\/app_schema_version$/, () => response(200, `[${TENANT_SCHEMA_VERSION}]`)],
    [/\/rest\/v1\/patients\?/, () => response(200, [])],
    [/\/rest\/v1\/$/, () => response(200, '{}')],
  ]);
  const checks = await runTenantConnectionChecks({
    supabaseUrl: TENANT_URL,
    supabaseAnonKey: TENANT_KEY,
    fetchImpl: impl,
  });
  assert.equal(checks[3].state, 'pass', 'a set-returning shape is also accepted');
  assert.equal(checks[4].state, 'pass');
  assert.equal(connectionReadiness(checks).linkable, true);
});

test('connectionReadiness treats a warn as reachable-but-unconfirmed', () => {
  const checks = [
    urlShapeCheck(TENANT_URL),
    keyPublishableCheck(TENANT_KEY),
    restReachableCheck({ ok: true, status: 200 }),
    tenantSchemaCheck(TENANT_SCHEMA_VERSION),
    anonClinicalReadCheck({ status: 404 }),
  ];
  const readiness = connectionReadiness(checks);
  assert.equal(readiness.state, 'warn');
  assert.equal(readiness.warned, 1);
  assert.equal(readiness.linkable, false, 'a warn is not a verified connection');
  assert.match(readiness.headline, /to confirm/);
  assert.equal(connectionReadiness([]).state, 'unknown');
  assert.equal(connectionReadiness([]).headline, 'Nothing checked yet');
});

test('restReachableCheck explains the three failure modes differently', () => {
  assert.match(restReachableCheck({ ok: false, status: 401 }).detail, /key was rejected/);
  assert.match(restReachableCheck({ ok: false, status: 404 }).detail, /project reference/);
  assert.match(restReachableCheck({ ok: false, status: 0, message: 'The operation was aborted' }).detail, /paused/i);
  assert.match(restReachableCheck({ ok: false, status: 540 }).detail, /HTTP 540/);
  assert.equal(restReachableCheck({ ok: true, status: 200 }).state, 'pass');
});

test('buildWorkspaceRow speaks database column names and defaults to dark', () => {
  const row = buildWorkspaceRow({
    clinicName: ' Sunrise OPD ',
    slug: 'SUNRISE-OPD',
    supabaseUrl: `${TENANT_URL}/`,
    supabaseAnonKey: TENANT_KEY,
    tenantSchemaVersion: TENANT_SCHEMA_VERSION,
    isActive: true,
    keepWarmAt: '2026-11-12T00:00:00.000Z',
  });
  assert.deepEqual(row, {
    clinic_name: 'Sunrise OPD',
    slug: 'sunrise-opd',
    supabase_url: TENANT_URL,
    supabase_anon_key: TENANT_KEY,
    tenant_schema_version: TENANT_SCHEMA_VERSION,
    is_active: true,
    keep_warm_at: '2026-11-12T00:00:00.000Z',
  });
  const empty = buildWorkspaceRow({});
  assert.equal(empty.is_active, false, 'a workspace starts dark until it is verified');
  assert.equal(empty.supabase_url, null);
  assert.equal(empty.supabase_anon_key, null);
  assert.equal(empty.tenant_schema_version, 0);
  assert.equal(empty.keep_warm_at, null);
});

test('buildTenantConnectionKit: the two Central env vars and nothing tenant-shaped', () => {
  const kit = buildTenantConnectionKit({
    centralUrl: 'https://centralref.supabase.co/',
    centralAnonKey: 'sb_publishable_central_0001',
    workspace: buildWorkspaceRow({
      clinicName: 'Sunrise OPD',
      slug: 'sunrise-opd',
      supabaseUrl: TENANT_URL,
      supabaseAnonKey: TENANT_KEY,
      tenantSchemaVersion: TENANT_SCHEMA_VERSION,
      isActive: true,
    }),
  });
  const [urlVar, keyVar] = OPD_CLINIC_ENV_VARS;
  assert.ok(kit.envVars.includes(`${urlVar}="https://centralref.supabase.co"`));
  assert.ok(kit.envVars.includes(`${keyVar}="sb_publishable_central_0001"`));
  assert.equal(kit.envVars.split('\n').length, 2, 'exactly the contract env pair');

  // The tenant probe vocabulary comes from the contract view.
  assert.ok(kit.tenantSql.includes(TENANT_VERSION_PROBE.rpc));
  assert.ok(kit.tenantSql.includes(TENANT_CLINICAL_PROBE_TABLE));
  assert.ok(kit.tenantSql.includes(String(TENANT_SCHEMA_VERSION)));

  // The workspace section masks the key; the machine-readable block carries it.
  assert.ok(kit.text.includes(maskTenantKey(TENANT_KEY)));
  assert.ok(kit.json.includes('sunrise-opd'));
  assert.equal(JSON.parse(kit.json).tenant_schema_version, TENANT_SCHEMA_VERSION);
  assert.equal(JSON.parse(kit.json).central.anon_rpc, 'sync_clinic_subscription');

  // No line may teach anyone to bake a tenant endpoint into a build.
  for (const line of kit.text.split('\n')) {
    assert.equal(FORBIDDEN_ENV_SHAPE.test(line), false, `forbidden env var in kit: ${line}`);
  }
  assert.match(kit.summary, /sunrise-opd/);
});

test('buildTenantConnectionKit works with no workspace linked (the GuidePage case)', () => {
  const kit = buildTenantConnectionKit({});
  assert.ok(kit.envVars.includes('YOUR_CENTRAL_PROJECT_REF'));
  assert.ok(kit.text.includes('no workspace linked yet'));
  assert.equal(JSON.parse(kit.json).workspace, null);
  assert.match(kit.summary, /^Template/);
});

test('the kit refuses to emit a forbidden build variable, even from clinic data', () => {
  assert.throws(
    () =>
      buildTenantConnectionKit({
        workspace: { clinic_name: 'VITE_TENANT_SUPABASE_URL', slug: 'trap-clinic' },
      }),
    /forbidden build variable/,
  );
});

test('definition-site scan: the tenant probe vocabulary lives in the contract view', () => {
  const walk = (dir) =>
    readdirSync(dir).flatMap((entry) => {
      const path = `${dir}/${entry}`;
      return statSync(path).isDirectory() ? walk(path) : [path];
    });
  const allowed = ['tenant-connection.mjs', 'workspace-directory.mjs'];
  const offenders = walk(new URL('../src', import.meta.url).pathname).filter(
    (file) =>
      !allowed.some((name) => file.endsWith(name)) &&
      new RegExp(`${TENANT_VERSION_PROBE.rpc}\\s*\\(`).test(readFileSync(file, 'utf8')),
  );
  assert.deepEqual(
    offenders,
    [],
    'call TENANT_VERSION_PROBE.rpc from the contract view instead of typing the RPC name',
  );
});

// ── Writing the verified handover into the directory ──────────────────────────

/** Chainable recording fake: supabase-js builders are thenables, so is this. */
function fakeSupabaseClient({
  existingWorkspace = null,
  fail = null,
  silentRefusal = null,
} = {}) {
  const calls = [];
  const rpcCalls = [];
  const workspaceRow = {
    id: 'ws-9',
    clinic_name: 'Sunrise OPD',
    slug: 'sunrise-opd',
    supabase_url: TENANT_URL,
    is_active: true,
    tenant_schema_version: TENANT_SCHEMA_VERSION,
    keep_warm_at: null,
  };

  function finish(state) {
    calls.push({ ...state });
    if (state.table === 'workspaces' && state.op === 'select') {
      return { data: existingWorkspace, error: null };
    }
    if (fail === `${state.table}:${state.op}`) {
      return { data: null, error: { message: `refused ${state.table}.${state.op}` } };
    }
    // RLS refusing a non-admin: the statement succeeds, the USING filter matches
    // nothing, and there is no error to catch (schema-tests.sql §12f–§12h).
    if (silentRefusal === `${state.table}:${state.op}`) {
      return { data: [], error: null };
    }
    if (state.table === 'workspaces') {
      return { data: { ...workspaceRow, ...(state.payload ?? {}) }, error: null };
    }
    // A write that asked for its rows back (`.select('id')`, i.e. PostgREST
    // `Prefer: return=representation`) returns the rows it changed; a write
    // without a read-back returns `data: null`, which src/lib/write-verify.mjs
    // treats as "not proven".
    if (state.cols && state.op !== 'select') {
      return { data: [{ id: `${state.table}-row` }], error: null };
    }
    return { data: null, error: null };
  }

  function builder(table) {
    const state = { table, op: null, cols: null, filters: {}, payload: null, terminal: null };
    const api = {
      select(cols) {
        state.op = state.op ?? 'select';
        state.cols = cols;
        return api;
      },
      insert(row) {
        state.op = 'insert';
        state.payload = row;
        return api;
      },
      update(row) {
        state.op = 'update';
        state.payload = row;
        return api;
      },
      eq(column, value) {
        state.filters[column] = value;
        return api;
      },
      maybeSingle() {
        state.terminal = 'maybeSingle';
        return api;
      },
      single() {
        state.terminal = 'single';
        return api;
      },
      then(resolve, reject) {
        return Promise.resolve(finish(state)).then(resolve, reject);
      },
    };
    return api;
  }

  return {
    calls,
    rpcCalls,
    from: (table) => builder(table),
    rpc: async (name, args) => {
      rpcCalls.push({ name, args });
      if (fail === `rpc:${name}`) return { data: null, error: { message: 'rpc refused' } };
      return { data: { ok: true, slug: args?.p_workspace ? 'sunrise-opd' : '', stamped: true }, error: null };
    },
  };
}

const LINK_VALUE = {
  clinic_name: 'Sunrise OPD',
  slug: 'sunrise-opd',
  supabase_url: TENANT_URL,
  supabase_anon_key: TENANT_KEY,
};

test('persistWorkspaceConnection inserts, links the subscription and stamps', async () => {
  const client = fakeSupabaseClient();
  const res = await persistWorkspaceConnection(client, {
    value: LINK_VALUE,
    subscriptionId: 'sub-1',
    tenantSchemaVersion: TENANT_SCHEMA_VERSION,
    isActive: true,
    stampKeepWarm: true,
  });
  assert.equal(res.id, 'ws-9');
  assert.equal(res.linked, true);
  assert.equal(res.stamped, true);
  assert.deepEqual(res.warnings, []);

  // 1) find by slug, 2) insert, 3) link, in that order
  assert.deepEqual(
    client.calls.map((c) => [c.table, c.op, c.terminal]),
    [
      ['workspaces', 'select', 'maybeSingle'],
      ['workspaces', 'insert', 'single'],
      ['subscriptions', 'update', null],
    ],
  );
  assert.equal(client.calls[0].filters.slug, 'sunrise-opd');
  assert.equal(client.calls[1].payload.slug, 'sunrise-opd');
  assert.equal(client.calls[1].payload.is_active, true);
  assert.equal(client.calls[1].payload.supabase_anon_key, TENANT_KEY);
  assert.equal(client.calls[2].payload.workspace_id, 'ws-9');
  assert.equal(client.calls[2].filters.id, 'sub-1');

  assert.deepEqual(client.rpcCalls, [
    { name: 'stamp_keep_warm', args: { p_workspace: 'ws-9', p_ok: true } },
  ]);
});

test('persistWorkspaceConnection updates an existing slug instead of duplicating', async () => {
  const client = fakeSupabaseClient({ existingWorkspace: { id: 'ws-old' } });
  const res = await persistWorkspaceConnection(client, {
    value: LINK_VALUE,
    subscriptionId: 'sub-2',
    isActive: false,
  });
  assert.equal(res.id, 'ws-9');
  assert.equal(res.stamped, false, 'an unverified workspace is not stamped warm');
  assert.deepEqual(
    client.calls.map((c) => [c.table, c.op]),
    [
      ['workspaces', 'select'],
      ['workspaces', 'update'],
      ['subscriptions', 'update'],
    ],
  );
  assert.equal(client.calls[1].filters.id, 'ws-old');
  assert.equal(client.calls[1].payload.is_active, false);
  assert.equal(client.rpcCalls.length, 0);
});

test('persistWorkspaceConnection: a failed link or stamp degrades to a warning', async () => {
  const linkFail = fakeSupabaseClient({ fail: 'subscriptions:update' });
  const a = await persistWorkspaceConnection(linkFail, {
    value: LINK_VALUE,
    subscriptionId: 'sub-3',
    stampKeepWarm: true,
  });
  assert.equal(a.linked, false);
  assert.equal(a.stamped, true);
  assert.equal(a.warnings.length, 1);
  assert.match(a.warnings[0], /could not be linked/);

  const stampFail = fakeSupabaseClient({ fail: 'rpc:stamp_keep_warm' });
  const b = await persistWorkspaceConnection(stampFail, {
    value: LINK_VALUE,
    subscriptionId: 'sub-4',
    isActive: true,
    stampKeepWarm: true,
  });
  assert.equal(b.linked, true);
  assert.equal(b.stamped, false);
  assert.match(b.warnings[0], /keep-warm stamp failed/);
});

test('persistWorkspaceConnection: a SILENTLY refused link is never reported as linked', async () => {
  // `subscriptions` is guarded by `using (is_license_admin())`, so a non-admin's
  // link update succeeds against zero rows with no error. Reading only `.error`
  // would have set linked = true for a row that never changed.
  const silent = fakeSupabaseClient({ silentRefusal: 'subscriptions:update' });
  const res = await persistWorkspaceConnection(silent, {
    value: LINK_VALUE,
    subscriptionId: 'sub-5',
    stampKeepWarm: true,
  });
  assert.equal(res.linked, false);
  assert.equal(res.warnings.length, 1);
  assert.match(res.warnings[0], /could not be linked/);
  assert.match(res.warnings[0], /Row-level security refused it silently/);
  assert.equal(res.id, 'ws-9', 'the directory write itself still landed');
});

test('persistWorkspaceConnection refuses a bad or skipped handover', async () => {
  const client = fakeSupabaseClient();
  await assert.rejects(
    () => persistWorkspaceConnection(client, { value: { ...LINK_VALUE, supabase_anon_key: 'sb_secret_x' } }),
    /SECURITY BLOCK/,
  );
  await assert.rejects(
    () => persistWorkspaceConnection(client, { value: { clinic_name: 'Sunrise OPD', slug: 'sunrise-opd' } }),
    /skipped|needed to link/i,
  );
  await assert.rejects(
    () => persistWorkspaceConnection(null, { value: LINK_VALUE }),
    /Central connection is unavailable/,
  );
  assert.equal(client.calls.length, 0, 'nothing is written before the value is re-validated');
});
