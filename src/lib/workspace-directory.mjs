import raw from '../../contract/workspace-directory-contract.json' with { type: 'json' };

/**
 * The workspace-directory contract — one versioned file, three consumers.
 *
 * `contract/workspace-directory-contract.json` is the single source of truth
 * for the OPD multi-tenant directory vocabulary (decision record:
 * /home/user/OPD-DECISIONS.md, S8): workspace member roles, the immutable
 * Central Auth metadata roles (D6-A), tenant slug/URL/key/probe shapes,
 * the free-tier keep-warm cadence, the RS256
 * tenant-token claim set and TTLs (D1′), the anon-RPC allowlist (S3), the
 * browser storage keys (R1 §9.3) and the Pages/SW topology (D2′/S9).
 *
 * Like tier-contract.mjs, everything below is a *generated view*: no role,
 * TTL, claim or storage key is typed out in Central code. The companion test
 * pins the file's sha256 (the myClinic repo pins the SAME hash against its
 * vendored copy, so a one-sided edit fails tests in both repositories),
 * asserts the view equals the file, scans definition sites, and re-proves
 * that `sync_clinic_subscription` is still the only RPC granted to anon.
 */

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

export const DIRECTORY_CONTRACT_VERSION = raw.version;

export const DIRECTORY_ROLES = deepFreeze([...raw.roles.workspace_member]);

export const CENTRAL_AUTH_ROLES = deepFreeze([
  ...raw.roles.central_auth_metadata,
]);

export const TENANT_SCHEMA_VERSION = raw.tenant.schema_version;

/**
 * P3: the tenant template's vocabulary. `supabase/tenant/tenant-schema.sql` in
 * myClinic is the implementation and these names are the promise it has to keep,
 * so Central can sync an allowlist and mint a capability token without either
 * side inventing a table, a helper, a policy suffix or a role. `TENANT_ROLE_MAP`
 * is the contract's directory-role → myClinic-staff-role translation
 * (admin→owner, doctor→doctor, staff→frontdesk); a token's `role` claim carries
 * the DIRECTORY side of that pair, never the local one.
 */
export const TENANT_MEMBERS_TABLE = raw.tenant.members_table;

export const TENANT_MEMBER_HELPER = raw.tenant.member_helper;

export const TENANT_META_TABLE = raw.tenant.meta_table;

export const TENANT_GATE_POLICY_SUFFIX = raw.tenant.gate_policy_suffix;

export const TENANT_ADMIT_RPC = raw.tenant.admit_rpc;

export const TENANT_ROLE_MAP = deepFreeze({ ...raw.tenant.role_map });

export const TENANT_SLUG_CLAIM = raw.tenant.slug_claim;

export const TENANT_TOKEN_TTL_SECONDS = raw.auth.tenant_token_ttl_seconds;

export const OFFLINE_LEASE_TTL_SECONDS = raw.auth.offline_lease_ttl_seconds;

export const TENANT_TOKEN_CLAIMS = deepFreeze([...raw.auth.claims]);

export const DIRECTORY_ANON_RPCS = deepFreeze([...raw.rpc.anon_only]);

export const DIRECTORY_DISCOVERY_RPC = raw.rpc.authenticated_discovery;

/**
 * P1b: the pointer that rides the single anon RPC. `null_when` is part of the
 * shape, not a footnote — a jsonb null is NOT SQL NULL, so consumers test the
 * payload (`workspace.slug`), never the key's presence.
 */
export const SYNC_RESPONSE_WORKSPACE = deepFreeze({
  ...raw.rpc.sync_response_workspace,
  fields: [...raw.rpc.sync_response_workspace.fields],
});

export const OPD_STORAGE_KEYS = deepFreeze({ ...raw.storage_keys });

export const WORKSPACE_SLUG_PATTERN = raw.tenant.slug_pattern;

export const TENANT_SUPABASE_URL_PATTERN = raw.tenant.url_pattern;

export const FORBIDDEN_TENANT_KEY_PATTERN = raw.tenant.forbidden_key_pattern;

export const TENANT_REST_ROOT = raw.tenant.rest_root;

/**
 * How Central proves a tenant project sits on the schema the contract expects:
 * `app_schema_version()` is granted to anon ON PURPOSE (it is the tenant's own
 * readiness probe), so the Connection step reads it with nothing but the
 * clinic's publishable key. Pinned here, never typed out in the wizard.
 */
export const TENANT_VERSION_PROBE = deepFreeze({ ...raw.tenant.version_probe });

export const TENANT_CLINICAL_PROBE_TABLE = raw.tenant.clinical_probe_table;

/**
 * Free-tier keep-warm cadence (owner FYI 2026-11-11): a Supabase free project
 * PAUSES after `pause_days` idle, so Central touches every active tenant at
 * least every `target_days`. One number, three consumers: the pg_cron job in
 * supabase/schema.sql, keep-warm.mjs in the console, and myClinic's "project
 * may be paused" wording. A node test cross-checks the SQL against this file.
 */
export const KEEP_WARM = deepFreeze({ ...raw.keep_warm });

export const OPD_PAGES = deepFreeze({ ...raw.pages });

export const OPD_CLINIC_ENV_VARS = deepFreeze([...raw.env.clinic_app]);

/**
 * Build variables that must never exist: the tenant endpoint is discovered at
 * runtime through the workspace pointer, never baked into a clinic build (one
 * build serves every clinic). tenant-connection.mjs asserts the copyable kit
 * against this pattern before handing it to an operator.
 */
export const OPD_FORBIDDEN_ENV_PATTERN = raw.env.forbidden_env_pattern;
